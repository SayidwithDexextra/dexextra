import { ethers } from "hardhat";
import fs from "fs";

/**
 * @title Order Expiration Cleanup Script
 * @dev Demonstrates automated cleanup of expired orders
 * @notice This script can be run periodically to maintain order book hygiene
 */

interface DeploymentData {
  contracts: {
    orderRouter?: string;
    metricsMarketFactory?: string;
  };
}

async function main() {
  console.log("🧹 Starting Order Expiration Cleanup...\n");

  // Load deployment data
  const deploymentPath = "./deployments/deployment.json";
  if (!fs.existsSync(deploymentPath)) {
    console.error("❌ Deployment file not found. Please deploy contracts first.");
    process.exit(1);
  }

  const deploymentData: DeploymentData = JSON.parse(
    fs.readFileSync(deploymentPath, "utf-8")
  );

  if (!deploymentData.contracts.orderRouter) {
    console.error("❌ OrderRouter address not found in deployment data");
    process.exit(1);
  }

  // Get contract instances
  const [deployer, user1, user2] = await ethers.getSigners();
  const orderRouter = await ethers.getContractAt(
    "OrderRouter",
    deploymentData.contracts.orderRouter,
    deployer
  );

  console.log(`📋 OrderRouter address: ${orderRouter.target}`);
  console.log(`👤 Using account: ${deployer.address}\n`);

  // Configuration
  const BATCH_SIZE = 50; // Maximum orders to process in one batch
  const MAX_ITERATIONS = 10; // Prevent infinite loops

  try {
    // 1. Check for orders eligible for expiration across all users
    console.log("🔍 Scanning for orders eligible for expiration...");
    
    const eligibleOrders = await orderRouter.getOrdersEligibleForExpiration(
      ethers.ZeroAddress, // All users
      100 // Limit
    );
    
    console.log(`Found ${eligibleOrders.length} orders eligible for expiration`);

    if (eligibleOrders.length === 0) {
      console.log("✅ No expired orders found. Order book is clean!");
      return;
    }

    // 2. Display expired orders summary
    console.log("\n📊 Expired Orders Summary:");
    console.log("─".repeat(80));
    
    const expirationSummary = new Map<string, number>();
    
    for (const order of eligibleOrders) {
      const trader = order.trader;
      expirationSummary.set(trader, (expirationSummary.get(trader) || 0) + 1);
      
      console.log(`Order ID: ${order.orderId}`);
      console.log(`  Trader: ${trader}`);
      console.log(`  Metric: ${order.metricId}`);
      console.log(`  Side: ${order.side === 0 ? 'BUY' : 'SELL'}`);
      console.log(`  Quantity: ${ethers.formatEther(order.quantity)}`);
      console.log(`  Price: ${ethers.formatEther(order.price)}`);
      console.log(`  Expiry: ${new Date(Number(order.expiryTime) * 1000).toISOString()}`);
      console.log(`  Status: ${getOrderStatusName(order.status)}`);
      console.log("");
    }

    console.log("👥 Expiration Summary by Trader:");
    for (const [trader, count] of expirationSummary.entries()) {
      console.log(`  ${trader}: ${count} expired orders`);
    }

    // 3. Batch expire orders
    console.log("\n🔄 Starting batch expiration process...");
    
    const orderIds = eligibleOrders.map(order => order.orderId);
    let totalExpired = 0;
    let iteration = 0;

    while (orderIds.length > 0 && iteration < MAX_ITERATIONS) {
      iteration++;
      
      // Take batch of order IDs
      const batchIds = orderIds.splice(0, Math.min(BATCH_SIZE, orderIds.length));
      
      console.log(`\n📦 Processing batch ${iteration} with ${batchIds.length} orders...`);
      
      try {
        // Estimate gas for the batch operation
        const gasEstimate = await orderRouter.batchExpireOrders.estimateGas(batchIds);
        console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
        
        // Execute batch expiration
        const tx = await orderRouter.batchExpireOrders(batchIds);
        console.log(`📝 Transaction submitted: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
        
        // Parse events to get actual expired count
        const expiredEvents = receipt.logs.filter(
          (log: any) => log.topics[0] === orderRouter.interface.getEvent("BatchOrdersExpired").topicHash
        );
        
        if (expiredEvents.length > 0) {
          const decodedEvent = orderRouter.interface.parseLog(expiredEvents[0]);
          const expiredInBatch = decodedEvent.args.orderIds.length;
          totalExpired += expiredInBatch;
          
          console.log(`🎯 Expired ${expiredInBatch} orders in this batch`);
        }
        
        // Small delay between batches to avoid overwhelming the network
        if (orderIds.length > 0) {
          console.log("⏳ Waiting 2 seconds before next batch...");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Error processing batch ${iteration}:`, error);
        break;
      }
    }

    console.log(`\n🎉 Cleanup completed! Total orders expired: ${totalExpired}`);

    // 4. Verify cleanup by checking again
    console.log("\n🔍 Verifying cleanup...");
    const remainingExpired = await orderRouter.getOrdersEligibleForExpiration(
      ethers.ZeroAddress,
      100
    );
    
    console.log(`📊 Remaining expired orders: ${remainingExpired.length}`);
    
    if (remainingExpired.length === 0) {
      console.log("✅ All expired orders have been cleaned up successfully!");
    } else {
      console.log(`⚠️  ${remainingExpired.length} expired orders still remain`);
      console.log("This could be due to gas limits or other constraints");
    }

  } catch (error) {
    console.error("❌ Error during cleanup process:", error);
    process.exit(1);
  }

  // 5. Display final statistics
  await displayFinalStatistics(orderRouter);
}

async function displayFinalStatistics(orderRouter: any) {
  console.log("\n📈 Final Order Book Statistics:");
  console.log("─".repeat(50));
  
  try {
    // This would require additional view functions to get global statistics
    console.log("Note: Detailed statistics require deployment of additional view functions");
    console.log("Consider implementing a statistics contract for comprehensive metrics");
  } catch (error) {
    console.log("Unable to fetch detailed statistics");
  }
}

function getOrderStatusName(status: number): string {
  const statusNames = [
    "PENDING",
    "PARTIALLY_FILLED", 
    "FILLED",
    "CANCELLED",
    "EXPIRED",
    "REJECTED"
  ];
  return statusNames[status] || "UNKNOWN";
}

// Utility function for specific user cleanup
async function cleanupUserOrders(userAddress: string) {
  console.log(`\n👤 Cleaning up orders for user: ${userAddress}`);
  
  const deploymentData: DeploymentData = JSON.parse(
    fs.readFileSync("./deployments/deployment.json", "utf-8")
  );
  
  const [deployer] = await ethers.getSigners();
  const orderRouter = await ethers.getContractAt(
    "OrderRouter",
    deploymentData.contracts.orderRouter,
    deployer
  );
  
  try {
    const tx = await orderRouter.cleanupUserExpiredOrders(userAddress);
    const receipt = await tx.wait();
    
    console.log(`✅ User cleanup completed: ${receipt.transactionHash}`);
    return receipt;
  } catch (error) {
    console.error(`❌ Error cleaning up user orders:`, error);
    throw error;
  }
}

// Monitoring function that can be called periodically
async function monitorExpiredOrders() {
  console.log("\n🔍 Monitoring for expired orders...");
  
  const deploymentData: DeploymentData = JSON.parse(
    fs.readFileSync("./deployments/deployment.json", "utf-8")
  );
  
  const [deployer] = await ethers.getSigners();
  const orderRouter = await ethers.getContractAt(
    "OrderRouter",
    deploymentData.contracts.orderRouter,
    deployer
  );
  
  const eligibleOrders = await orderRouter.getOrdersEligibleForExpiration(
    ethers.ZeroAddress,
    50
  );
  
  if (eligibleOrders.length > 0) {
    console.log(`⚠️  Found ${eligibleOrders.length} expired orders that need cleanup`);
    return true;
  } else {
    console.log("✅ No expired orders found");
    return false;
  }
}

// Export functions for use in other scripts
export { 
  cleanupUserOrders,
  monitorExpiredOrders
};

// Run main function if script is called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log("\n🎉 Order cleanup script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Order cleanup script failed:", error);
      process.exit(1);
    });
}
