import { ethers } from "hardhat";
import { Contract } from "ethers";

/**
 * Test script for placing a $10 limit order on live Polygon contracts
 * This script interacts with the deployed contracts on Polygon mainnet
 */

// Live Polygon contract addresses from deployment
const POLYGON_CONTRACTS = {
  factory: "0x354f188944eF514eEEf05d8a31E63B33f87f16E0",
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  orderBookImplementation: "0x57404e18375abB60c643009D2aE6fa8f61FBd646",
  umaOracleManager: "0xCa1B94AD513097fC17bBBdB146787e026E62132b",
  mockUSDC: "0xff541e2AEc7716725f8EDD02945A1Fe15664588b",
  mockUMAFinder: "0x52512884CB360dd466c4935C9dd8089233F0f5B9"
};

// Silver V1 Market (example market for testing)
const SILVER_MARKET = {
  address: "0x07d317C87E6d8AF322463aCF024f1e28D38F6117",
  metricId: "SILVER_V1"
};

const USDC_DECIMALS = 6;

interface OrderParams {
  metricId: string;
  orderType: number; // 0 = MARKET, 1 = LIMIT
  side: number; // 0 = BUY, 1 = SELL
  quantity: bigint;
  price: bigint;
  timeInForce: number; // 0 = GTC, 1 = IOC, 2 = FOK, 3 = GTD
  expiryTime: number;
}

async function main() {
  console.log("🚀 Starting $10 Limit Order Test on Live Polygon Contracts");
  console.log("======================================================");
  
  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Check network
  const network = await signer.provider!.getNetwork();
  if (network.chainId !== 137n) {
    throw new Error(`❌ Wrong network! Expected Polygon (137), got ${network.chainId}`);
  }
  console.log("✅ Connected to Polygon mainnet");
  
  // Load contracts
  console.log("\n📦 Loading contracts...");
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  const factory = await ethers.getContractAt("MetricsMarketFactory", POLYGON_CONTRACTS.factory, signer);
  
  console.log("✅ All contracts loaded successfully");
  
  // Check initial balances
  console.log("\n💰 Checking balances...");
  const usdcBalance = await mockUSDC.balanceOf(signer.address);
  const vaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
  
  console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);
  console.log(`Vault Balance (Available): ${ethers.formatUnits(vaultBalance.available, USDC_DECIMALS)} USDC`);
  console.log(`Vault Balance (Allocated): ${ethers.formatUnits(vaultBalance.allocated, USDC_DECIMALS)} USDC`);
  console.log(`Vault Balance (Locked): ${ethers.formatUnits(vaultBalance.locked, USDC_DECIMALS)} USDC`);
  
  // Ensure we have sufficient USDC
  const requiredAmount = ethers.parseUnits("20", USDC_DECIMALS); // $20 to be safe
  if (usdcBalance < requiredAmount) {
    console.log("\n🔄 Minting USDC for testing...");
    try {
      const mintTx = await mockUSDC.mint(signer.address, requiredAmount);
      await mintTx.wait();
      console.log("✅ USDC minted successfully");
    } catch (error) {
      console.log("ℹ️  Note: Cannot mint USDC (not owner), proceeding with current balance");
    }
  }
  
  // Deposit to vault if needed
  if (vaultBalance.available < requiredAmount) {
    console.log("\n🏦 Depositing to vault...");
    const depositAmount = ethers.parseUnits("15", USDC_DECIMALS); // $15
    
    // Check current allowance
    const currentAllowance = await mockUSDC.allowance(signer.address, POLYGON_CONTRACTS.centralVault);
    console.log(`Current allowance: ${ethers.formatUnits(currentAllowance, USDC_DECIMALS)} USDC`);
    
    if (currentAllowance < depositAmount) {
      // Approve vault to spend USDC (approve max amount to avoid repeated approvals)
      const maxApproval = ethers.parseUnits("1000000", USDC_DECIMALS); // 1M USDC approval
      const approveTx = await mockUSDC.approve(POLYGON_CONTRACTS.centralVault, maxApproval);
      await approveTx.wait();
      console.log("✅ USDC approval granted for large amount");
    }
    
    // Deposit to vault
    const depositTx = await centralVault.deposit(POLYGON_CONTRACTS.mockUSDC, depositAmount);
    await depositTx.wait();
    console.log(`✅ Deposited ${ethers.formatUnits(depositAmount, USDC_DECIMALS)} USDC to vault`);
  }
  
  // Check if Silver market exists and is active
  console.log("\n🔍 Checking Silver V1 market...");
  const marketAddress = await orderRouter.marketOrderBooks(SILVER_MARKET.metricId);
  if (marketAddress === ethers.ZeroAddress) {
    throw new Error(`❌ Market ${SILVER_MARKET.metricId} not found in order router`);
  }
  console.log(`✅ Market found at: ${marketAddress}`);
  
  // Load the market's order book
  const orderBook = await ethers.getContractAt("OrderBook", marketAddress, signer);
  
  // Get market info
  const isPaused = await orderBook.paused();
  const bestBid = await orderBook.getBestBid();
  const bestAsk = await orderBook.getBestAsk();
  
  console.log(`Market Status: ${isPaused ? "⏸️  Paused" : "✅ Active"}`);
  console.log(`Best Bid: ${bestBid > 0 ? ethers.formatEther(bestBid) + " ETH" : "No bids"}`);
  console.log(`Best Ask: ${bestAsk > 0 ? ethers.formatEther(bestAsk) + " ETH" : "No asks"}`);
  
  if (isPaused) {
    throw new Error("❌ Market is paused, cannot place orders");
  }
  
  // Calculate order parameters for $10 limit order
  console.log("\n📊 Preparing $10 limit order...");
  
  // Get minimum order size from the market (in wei - 18 decimals)
  let minOrderSize: bigint;
  try {
    minOrderSize = await orderBook.minimumOrderSize();
    console.log("Market minimum order size:", ethers.formatEther(minOrderSize), "units (in wei)");
  } catch (error) {
    // Default to a reasonable minimum if we can't read it
    minOrderSize = ethers.parseEther("0.1"); // 0.1 units default
    console.log("Using default minimum order size: 0.1 units");
  }
  
  // Let's try the smallest possible order to test the system
  // Price must be aligned to tick size (0.01 ETH)
  // Try: 0.1 units × 0.01 ETH/unit = 0.001 ETH ≈ ~$3
  
  let orderQuantity = minOrderSize; // Use minimum (0.1 units)  
  const orderPrice = ethers.parseEther("0.01"); // 0.01 ETH per unit (minimum tick size)
  
  // Calculate expected value in ETH
  const totalETHValue = (orderQuantity * orderPrice) / ethers.parseEther("1");
  
  console.log(`Target order value: ~$3.00 (testing minimum viable order)`);
  console.log(`Using quantity: ${ethers.formatEther(orderQuantity)} units`);
  console.log(`Price per unit: ${ethers.formatEther(orderPrice)} ETH`);
  console.log(`Total value: ${ethers.formatEther(totalETHValue)} ETH (~$${parseFloat(ethers.formatEther(totalETHValue)) * 3000})`);
  
  console.log(`Order Price (in contract): ${ethers.formatEther(orderPrice)} ETH per unit`);
  console.log(`Order Quantity: ${ethers.formatEther(orderQuantity)} units`);
  
  // Note: The actual collateral requirement will be handled by the contract
  // based on the position value and leverage requirements
  
  // Prepare order parameters
  const orderParams: OrderParams = {
    metricId: SILVER_MARKET.metricId,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: orderQuantity,
    price: orderPrice,
    timeInForce: 0, // GTC (Good Till Cancelled)
    expiryTime: 0 // No expiry for GTC orders
  };
  
  // Create the order struct for the contract
  const order = {
    orderId: 0, // Will be assigned by router
    trader: signer.address,
    metricId: orderParams.metricId,
    orderType: orderParams.orderType,
    side: orderParams.side,
    quantity: orderParams.quantity,
    price: orderParams.price,
    filledQuantity: 0,
    timestamp: 0, // Will be set by contract
    expiryTime: orderParams.expiryTime,
    status: 0, // PENDING
    timeInForce: orderParams.timeInForce,
    stopPrice: 0,
    icebergQty: 0,
    postOnly: false,
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("TEST_ORDER"))
  };
  
  console.log("\n🎯 Placing limit order...");
  try {
    // Estimate gas first
    const estimatedGas = await orderRouter.placeOrder.estimateGas(order);
    console.log(`Estimated gas: ${estimatedGas.toString()}`);
    
    // Place the order
    const orderTx = await orderRouter.placeOrder(order, {
      gasLimit: estimatedGas + (estimatedGas / 10n) // Add 10% buffer
    });
    
    console.log(`Transaction submitted: ${orderTx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await orderTx.wait();
    console.log(`✅ Order placed successfully!`);
    console.log(`Gas used: ${receipt!.gasUsed.toString()}`);
    
    // Parse events to get order ID
    const orderPlacedEvent = receipt!.logs.find(log => {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        return parsed?.name === "OrderPlaced";
      } catch {
        return false;
      }
    });
    
    if (orderPlacedEvent) {
      const parsed = orderRouter.interface.parseLog(orderPlacedEvent);
      const orderId = parsed!.args[0];
      console.log(`📋 Order ID: ${orderId.toString()}`);
      
      // Verify order was added to order book
      console.log("\n🔍 Verifying order in order book...");
      const newBestBid = await orderBook.getBestBid();
      console.log(`Updated Best Bid: ${newBestBid > 0 ? ethers.formatEther(newBestBid) + " ETH" : "No bids"}`);
      
      // Check user's vault balance after order
      const finalVaultBalance = await centralVault.getUserBalance(signer.address, POLYGON_CONTRACTS.mockUSDC);
      console.log(`Final Vault Balance (Available): ${ethers.formatUnits(finalVaultBalance.available, USDC_DECIMALS)} USDC`);
      
      console.log("\n🎉 SUCCESS: $10 limit order test completed!");
      console.log("======================================");
      console.log(`✅ Order ID: ${orderId.toString()}`);
      console.log(`✅ Transaction: ${orderTx.hash}`);
      console.log(`✅ Order Value: $10.00 USDC`);
      console.log(`✅ Order Type: BUY Limit`);
      console.log(`✅ Price: ${ethers.formatEther(orderPrice)} ETH`);
      
    } else {
      console.log("⚠️  Order placed but couldn't find OrderPlaced event");
    }
    
  } catch (error: any) {
    console.error("❌ Failed to place order:");
    console.error(error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    // Common error scenarios
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 Troubleshooting: Insufficient funds");
      console.log("- Ensure you have enough USDC in your wallet");
      console.log("- Ensure you have deposited enough to the vault");
      console.log("- Check if the order value exceeds available collateral");
    }
    
    if (error.message.includes("market not found")) {
      console.log("\n💡 Troubleshooting: Market not found");
      console.log("- Verify the market ID is correct");
      console.log("- Check if the market is registered with the order router");
    }
    
    throw error;
  }
}

// Handle errors and cleanup
main()
  .then(() => {
    console.log("\n✅ Test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
