import { ethers } from "hardhat";

/**
 * Test script to demonstrate and validate the minimum order size update functionality
 * This script shows how to safely test the minimum order size update without actually executing it
 */

const FACTORY_ADDRESS = "0x354f188944eF514eEEf05d8a31E63B33f87f16E0";
const METRIC_ID = "SILVER_V1";

async function testMinimumOrderSizeUpdate() {
  console.log("\n🧪 Testing Minimum Order Size Update Script");
  console.log("==========================================");

  const [signer] = await ethers.getSigners();
  console.log(`👤 Test Account: ${signer.address}`);

  // Connect to factory
  const factory = await ethers.getContractAt("MetricsMarketFactory", FACTORY_ADDRESS, signer);

  try {
    // 1. Test market existence
    console.log("\n1️⃣ Testing market existence...");
    const marketExists = await factory.marketExists(METRIC_ID);
    console.log(`Market "${METRIC_ID}" exists: ${marketExists ? '✅' : '❌'}`);

    if (!marketExists) {
      console.log("📝 Available markets:");
      try {
        const allMarkets = await factory.getAllMarkets();
        console.log(`Total markets: ${allMarkets.length}`);
        
        // Get details for each market
        for (let i = 0; i < Math.min(allMarkets.length, 5); i++) {
          const marketAddress = allMarkets[i];
          const marketContract = await ethers.getContractAt("OrderBook", marketAddress, signer);
          const metricId = await marketContract.getMetricId();
          console.log(`- Market ${i + 1}: ${metricId} (${marketAddress})`);
        }
        
        if (allMarkets.length > 5) {
          console.log(`... and ${allMarkets.length - 5} more markets`);
        }
      } catch (error) {
        console.log("❌ Could not retrieve market list");
      }
      return;
    }

    // 2. Test market configuration retrieval
    console.log("\n2️⃣ Testing configuration retrieval...");
    const config = await factory.getMarketConfig(METRIC_ID);
    console.log("Current configuration:");
    console.log({
      metricId: config.metricId,
      description: config.description,
      decimals: Number(config.decimals),
      minimumOrderSize: config.minimumOrderSize.toString(),
      minimumOrderSizeFormatted: ethers.formatUnits(config.minimumOrderSize, Number(config.decimals)),
      creationFee: config.creationFee.toString(),
      requiresKYC: config.requiresKYC,
      settlementDate: new Date(Number(config.settlementDate) * 1000).toISOString(),
      tradingEndDate: new Date(Number(config.tradingEndDate) * 1000).toISOString()
    });

    // 3. Test parameter update simulation (dry run)
    console.log("\n3️⃣ Testing parameter update (simulation)...");
    const NEW_MIN_ORDER_SIZE = 1n; // 1 wei
    const FIXED_TICK_SIZE = 1n * 10n ** 16n; // 0.01

    try {
      // Estimate gas without executing
      const gasEstimate = await factory.updateMarketParameters.estimateGas(
        METRIC_ID,
        NEW_MIN_ORDER_SIZE,
        FIXED_TICK_SIZE
      );
      console.log(`✅ Gas estimation successful: ${gasEstimate.toString()}`);
      
      // Calculate transaction cost
      const gasPrice = await ethers.provider.getFeeData();
      const estimatedCost = gasEstimate * (gasPrice.gasPrice || 0n);
      console.log(`💰 Estimated transaction cost: ${ethers.formatEther(estimatedCost)} MATIC`);

      // Check if change is needed
      const isAlreadyMinimum = config.minimumOrderSize === NEW_MIN_ORDER_SIZE;
      console.log(`🔄 Update needed: ${isAlreadyMinimum ? 'NO (already at 1 wei)' : 'YES'}`);

    } catch (error: any) {
      console.log("❌ Gas estimation failed:");
      if (error.code === 'CALL_EXCEPTION') {
        console.log("- Likely cause: Caller does not have FACTORY_ADMIN_ROLE");
        console.log("- Current caller:", signer.address);
        
        // Check if caller has admin role
        try {
          const FACTORY_ADMIN_ROLE = await factory.FACTORY_ADMIN_ROLE();
          const hasRole = await factory.hasRole(FACTORY_ADMIN_ROLE, signer.address);
          console.log(`- Has FACTORY_ADMIN_ROLE: ${hasRole ? '✅' : '❌'}`);
        } catch (roleError) {
          console.log("- Could not check admin role");
        }
      } else {
        console.log(`- Error: ${error.message}`);
      }
    }

    // 4. Test market contract direct access
    console.log("\n4️⃣ Testing direct market contract access...");
    const marketAddress = await factory.getMarket(METRIC_ID);
    console.log(`Market contract address: ${marketAddress}`);

    const marketContract = await ethers.getContractAt("OrderBook", marketAddress, signer);
    const [tickSize, minOrderSize, maxOrderSize] = await marketContract.getConfiguration();
    
    console.log("Market contract configuration:");
    console.log({
      tickSize: tickSize.toString(),
      tickSizeFormatted: ethers.formatEther(tickSize),
      minimumOrderSize: minOrderSize.toString(),
      maximumOrderSize: maxOrderSize.toString(),
      isPaused: await marketContract.isPaused(),
      totalOrders: await marketContract.getTotalOrders()
    });

    // 5. Summary and recommendations
    console.log("\n5️⃣ Test Summary and Recommendations");
    console.log("===================================");

    const balance = await ethers.provider.getBalance(signer.address);
    const hasMinimumBalance = balance > ethers.parseEther("0.01"); // 0.01 MATIC minimum

    console.log("✅ Checks passed:");
    console.log(`  - Market exists: ${marketExists}`);
    console.log(`  - Configuration readable: ✅`);
    console.log(`  - Market contract accessible: ✅`);
    console.log(`  - Sufficient balance: ${hasMinimumBalance ? '✅' : '❌'} (${ethers.formatEther(balance)} MATIC)`);

    console.log("\n📋 To execute the actual update:");
    console.log("npx hardhat run scripts/set-minimum-order-size-to-zero.ts --network polygon");
    
    if (config.minimumOrderSize === 1n) {
      console.log("\n💡 Note: Minimum order size is already set to 1 wei (effectively 0)");
    }

  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    
    if (error.code === 'NETWORK_ERROR') {
      console.error("Network connection issue. Check your RPC configuration.");
    } else if (error.code === 'INVALID_ARGUMENT') {
      console.error("Invalid contract address or ABI mismatch.");
    }
  }
}

async function main() {
  await testMinimumOrderSizeUpdate();
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ Test completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Test failed:", error);
      process.exit(1);
    });
}

export { testMinimumOrderSizeUpdate };
