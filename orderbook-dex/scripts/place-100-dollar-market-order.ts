import { ethers } from "hardhat";

/**
 * Script to place a $100 market order to fill existing limit orders
 * 
 * This script will:
 * 1. Check existing limit orders in the orderbook
 * 2. Calculate the quantity needed for a $100 market order
 * 3. Place a market order that will execute against existing limit orders
 * 4. Analyze the market impact and position creation
 */

// Live Polygon contract addresses
const POLYGON_CONTRACTS = {
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  mockUSDC: "0xff541e2AEc7716725f8EDD02945A1Fe15664588b",
  factory: "0x354f188944eF514eEEf05d8a31E63B33f87f16E0"
};

const SILVER_MARKET = {
  metricId: "SILVER_V1"
};

const USDC_DECIMALS = 6;
const PRICE_PRECISION = ethers.parseEther("1"); // 1e18

async function main() {
  console.log("🎯 Placing $100 Market Order to Fill Existing Limit Orders");
  console.log("========================================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Account:", signer.address);
  
  // Load contracts
  const mockUSDC = await ethers.getContractAt("MockUSDC", POLYGON_CONTRACTS.mockUSDC, signer);
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  const factory = await ethers.getContractAt("MetricsMarketFactory", POLYGON_CONTRACTS.factory, signer);
  
  console.log("\n📊 Checking market state before order...");
  
  // Get orderbook address for SILVER_V1
  const orderbookAddress = await factory.getMarket(SILVER_MARKET.metricId);
  console.log(`OrderBook address: ${orderbookAddress}`);
  
  if (orderbookAddress === ethers.ZeroAddress) {
    console.log("❌ Market not found. Creating market first...");
    return;
  }
  
  const orderBook = await ethers.getContractAt("OrderBook", orderbookAddress, signer);
  
  // Check current market state
  const [longInterest, shortInterest] = await orderBook.getOpenInterest();
  const marketStats = await orderBook.getMarketStats();
  
  console.log("\n📈 Current Market State:");
  console.log(`  Long Interest: ${ethers.formatEther(longInterest)} units`);
  console.log(`  Short Interest: ${ethers.formatEther(shortInterest)} units`);
  console.log(`  Last Trade Price: ${ethers.formatEther(marketStats.lastPrice)} ETH`);
  console.log(`  Total Trades: ${marketStats.totalTrades.toString()}`);
  console.log(`  24h Volume: ${ethers.formatUnits(marketStats.volume24h, USDC_DECIMALS)} USDC`);
  
  // Check current orderbook depth
  const bestBid = await orderBook.getBestBid();
  const bestAsk = await orderBook.getBestAsk();
  
  console.log("\n📚 Current Orderbook:");
  console.log(`  Best Bid: ${bestBid > 0 ? ethers.formatEther(bestBid) + " ETH" : "No bids"}`);
  console.log(`  Best Ask: ${bestAsk > 0 ? ethers.formatEther(bestAsk) + " ETH" : "No asks"}`);
  
  console.log("\n💰 Setting up collateral for market order...");
  
  // Check existing vault balance first
  let vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Current vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  // Calculate required collateral for a $100 order (with 20% safety buffer)
  const baseRequirement = ethers.parseUnits("100", USDC_DECIMALS); // $100 for the order
  const safetyBuffer = ethers.parseUnits("20", USDC_DECIMALS); // $20 safety buffer
  const totalRequired = baseRequirement + safetyBuffer; // $120 total
  
  console.log(`Required collateral: ${ethers.formatUnits(totalRequired, USDC_DECIMALS)} USDC (includes $20 safety buffer)`);
  
  // Only mint and deposit if we need more USDC
  if (vaultBalance[0] < totalRequired) {
    const shortfall = totalRequired - vaultBalance[0];
    console.log(`Shortfall: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
    
    try {
      await mockUSDC.mint(signer.address, shortfall);
      console.log(`✅ Minted only what's needed: ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
      
      // Approve and deposit the minted amount
      const vaultAddress = await centralVault.getAddress();
      await mockUSDC.approve(vaultAddress, ethers.MaxUint256);
      console.log("✅ Approved USDC allowance");
      
      await centralVault.depositPrimaryCollateral(shortfall);
      console.log(`✅ Deposited ${ethers.formatUnits(shortfall, USDC_DECIMALS)} USDC`);
      
    } catch (error) {
      console.log("❌ Failed to mint additional USDC");
      console.log("ℹ️  Proceeding with existing balance...");
    }
  } else {
    console.log("✅ Sufficient balance already available - no minting needed!");
  }
  
  // Get updated vault balance
  vaultBalance = await centralVault.getPrimaryCollateralBalance(signer.address);
  console.log(`Final vault balance: ${ethers.formatUnits(vaultBalance[0], USDC_DECIMALS)} USDC available`);
  
  console.log("\n🧮 Calculating $100 Market Order Parameters");
  console.log("==========================================");
  
  // For a market order, we need to calculate quantity based on the best ask price
  // If there are no asks, we'll place at a reasonable price that should execute
  
  let executionPrice: bigint;
  
  if (bestAsk > 0) {
    // Market buy will execute at the best ask price
    executionPrice = bestAsk;
    console.log(`Market order will execute at best ask: ${ethers.formatEther(executionPrice)} ETH`);
  } else {
    // No asks available, use a price slightly above last trade or minimum tick
    executionPrice = marketStats.lastPrice > 0 ? marketStats.lastPrice + ethers.parseEther("0.01") : ethers.parseEther("0.02");
    console.log(`No asks available. Using execution price: ${ethers.formatEther(executionPrice)} ETH`);
  }
  
  // Calculate quantity for $100 order
  // Formula: requiredCollateral = (quantity * price) / PRICE_PRECISION
  // Rearranged: quantity = (requiredCollateral * PRICE_PRECISION) / price
  const targetCollateralUSDC = ethers.parseUnits("100", USDC_DECIMALS); // $100
  const calculatedQuantity = (targetCollateralUSDC * PRICE_PRECISION) / executionPrice;
  
  console.log(`🔍 Market Order Analysis:`);
  console.log(`  Target Order Value: $100 USDC`);
  console.log(`  Execution Price: ${ethers.formatEther(executionPrice)} ETH`);
  console.log(`  Calculated Quantity: ${ethers.formatEther(calculatedQuantity)} units`);
  console.log(`  Quantity (raw): ${calculatedQuantity.toString()}`);
  
  // Verify calculation
  const verifyCollateral = (calculatedQuantity * executionPrice) / PRICE_PRECISION;
  console.log(`  Verification: ${ethers.formatUnits(verifyCollateral, USDC_DECIMALS)} USDC`);
  
  const hasSufficientBalance = verifyCollateral <= vaultBalance[0];
  console.log(`  Sufficient Balance: ${hasSufficientBalance ? "✅" : "❌"}`);
  
  if (!hasSufficientBalance) {
    console.log(`❌ Insufficient balance: need ${ethers.formatUnits(verifyCollateral, USDC_DECIMALS)} USDC`);
    return;
  }
  
  console.log("\n🎯 Placing $100 Market Order...");
  
  // Create market order (OrderType.MARKET = 0)
  const marketOrder = {
    orderId: 0, // Will be assigned by router
    trader: signer.address,
    metricId: SILVER_MARKET.metricId,
    orderType: 0, // MARKET
    side: 0, // BUY
    quantity: calculatedQuantity,
    price: executionPrice, // Market orders still need a price for execution
    filledQuantity: 0,
    timestamp: 0,
    expiryTime: 0,
    status: 0, // PENDING
    timeInForce: 1, // IOC (Immediate or Cancel) for market orders
    stopPrice: 0,
    icebergQty: 0,
    postOnly: false, // Market orders should execute immediately
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("MARKET_ORDER_100USD"))
  };
  
  try {
    console.log("\n⚡ Estimating gas for market order...");
    const gasEstimate = await orderRouter.placeOrder.estimateGas(marketOrder);
    console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);
    
    console.log("\n📤 Submitting market order...");
    const tx = await orderRouter.placeOrder(marketOrder, {
      gasLimit: gasEstimate + (gasEstimate / 10n) // 10% buffer
    });
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("🎉 MARKET ORDER EXECUTED!");
    
    // Parse events to get execution details
    let orderPlacedDetails = null;
    let executionDetails = null;
    
    for (const log of receipt!.logs) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed?.name === "OrderPlaced") {
          orderPlacedDetails = {
            orderId: parsed.args[0].toString(),
            trader: parsed.args[1],
            metricId: parsed.args[2],
            orderType: parsed.args[3],
            side: parsed.args[4],
            quantity: parsed.args[5],
            price: parsed.args[6]
          };
        } else if (parsed?.name === "OrderExecuted") {
          executionDetails = {
            orderId: parsed.args[0].toString(),
            trader: parsed.args[1],
            executedQuantity: parsed.args[2],
            executedPrice: parsed.args[3],
            timestamp: parsed.args[4]
          };
        }
      } catch (error) {
        // Try parsing with orderbook interface
        try {
          const parsedOB = orderBook.interface.parseLog(log);
          if (parsedOB?.name === "OrderMatched") {
            console.log(`📋 Order Matched Event Found`);
            console.log(`  Buy Order ID: ${parsedOB.args[0]}`);
            console.log(`  Sell Order ID: ${parsedOB.args[1]}`);
            console.log(`  Match Price: ${ethers.formatEther(parsedOB.args[2])} ETH`);
            console.log(`  Match Quantity: ${ethers.formatEther(parsedOB.args[3])} units`);
          } else if (parsedOB?.name === "PositionCreated") {
            console.log(`📋 Position Created Event Found`);
            console.log(`  Position ID: ${parsedOB.args[0]}`);
            console.log(`  Trader: ${parsedOB.args[1]}`);
            console.log(`  Is Long: ${parsedOB.args[2]}`);
            console.log(`  Quantity: ${ethers.formatEther(parsedOB.args[3])} units`);
            console.log(`  Entry Price: ${ethers.formatEther(parsedOB.args[4])} ETH`);
            console.log(`  Collateral: ${ethers.formatUnits(parsedOB.args[5], USDC_DECIMALS)} USDC`);
          }
        } catch (error2) {
          // Ignore parsing errors for other events
        }
      }
    }
    
    console.log("\n📋 Market Order Execution Details:");
    if (orderPlacedDetails) {
      console.log(`  Order ID: ${orderPlacedDetails.orderId}`);
      console.log(`  Type: ${orderPlacedDetails.orderType === 0 ? "MARKET" : "OTHER"}`);
      console.log(`  Side: ${orderPlacedDetails.side === 0 ? "BUY" : "SELL"}`);
      console.log(`  Quantity: ${ethers.formatEther(orderPlacedDetails.quantity)} units`);
      console.log(`  Price: ${ethers.formatEther(orderPlacedDetails.price)} ETH`);
    }
    
    if (executionDetails) {
      console.log(`\n📊 Execution Results:`);
      console.log(`  Executed Quantity: ${ethers.formatEther(executionDetails.executedQuantity)} units`);
      console.log(`  Executed Price: ${ethers.formatEther(executionDetails.executedPrice)} ETH`);
      
      const actualValue = (executionDetails.executedQuantity * executionDetails.executedPrice) / PRICE_PRECISION;
      console.log(`  Actual Order Value: $${ethers.formatUnits(actualValue, USDC_DECIMALS)} USDC`);
    }
    
    console.log("\n📈 Checking Market State After Execution...");
    
    // Get updated market state
    const [newLongInterest, newShortInterest] = await orderBook.getOpenInterest();
    const newMarketStats = await orderBook.getMarketStats();
    
    console.log("\n📊 Updated Market State:");
    console.log(`  Long Interest: ${ethers.formatEther(newLongInterest)} units (was ${ethers.formatEther(longInterest)})`);
    console.log(`  Short Interest: ${ethers.formatEther(newShortInterest)} units (was ${ethers.formatEther(shortInterest)})`);
    console.log(`  Last Trade Price: ${ethers.formatEther(newMarketStats.lastPrice)} ETH (was ${ethers.formatEther(marketStats.lastPrice)})`);
    console.log(`  Total Trades: ${newMarketStats.totalTrades.toString()} (was ${marketStats.totalTrades.toString()})`);
    console.log(`  24h Volume: ${ethers.formatUnits(newMarketStats.volume24h, USDC_DECIMALS)} USDC (was ${ethers.formatUnits(marketStats.volume24h, USDC_DECIMALS)})`);
    
    // Calculate changes
    const longInterestChange = newLongInterest - longInterest;
    const volumeChange = newMarketStats.volume24h - marketStats.volume24h;
    const tradesChange = newMarketStats.totalTrades - marketStats.totalTrades;
    
    console.log("\n📈 Market Impact Analysis:");
    console.log(`  Long Interest Change: +${ethers.formatEther(longInterestChange)} units`);
    console.log(`  Volume Change: +$${ethers.formatUnits(volumeChange, USDC_DECIMALS)} USDC`);
    console.log(`  New Trades: +${tradesChange.toString()}`);
    
    if (newLongInterest > 0 && longInterest === 0n) {
      console.log(`  Market Cap Created: $${ethers.formatUnits(newMarketStats.volume24h, USDC_DECIMALS)} USDC (from $0)`);
    }
    
    console.log("\n🎉 SUCCESS: Market Order Execution Complete!");
    console.log("===============================================");
    console.log(`✅ Transaction: ${tx.hash}`);
    console.log(`✅ Gas used: ${receipt!.gasUsed.toString()}`);
    console.log(`✅ Order Value: ~$100 USD`);
    console.log(`✅ Order Type: Market Buy`);
    console.log(`✅ Market: ${SILVER_MARKET.metricId}`);
    console.log(`✅ Impact: Created new market positions and volume`);
    
    console.log(`\n🔗 View on Polygonscan: https://polygonscan.com/tx/${tx.hash}`);
    
  } catch (error: any) {
    console.error("\n❌ Market order execution failed:");
    console.error("Error:", error.message);
    
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    
    console.log("\n🔍 Possible causes:");
    console.log("- No existing limit orders to fill");
    console.log("- Insufficient collateral balance");
    console.log("- Market order validation failed");
    console.log("- Price/quantity calculation error");
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Script failed:", error);
      process.exit(1);
    });
}

export { main };
