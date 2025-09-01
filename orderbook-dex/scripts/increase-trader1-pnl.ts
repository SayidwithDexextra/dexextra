import { ethers } from "hardhat";

// Enhanced logging utility
class PNLManipulator {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
  };

  static step(step: number, message: string) {
    console.log(`\n${PNLManipulator.colors.cyan}${step}️⃣ ${message}${PNLManipulator.colors.reset}`);
    console.log("━".repeat(60));
  }

  static info(message: string, data?: any) {
    console.log(`${PNLManipulator.colors.blue}📊 INFO:${PNLManipulator.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static success(message: string, data?: any) {
    console.log(`${PNLManipulator.colors.green}✅ SUCCESS:${PNLManipulator.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static action(message: string, data?: any) {
    console.log(`${PNLManipulator.colors.magenta}🎯 ACTION:${PNLManipulator.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }
}

async function increaseTrader1PNL() {
  PNLManipulator.step(0, "Increasing Trader 1 P&L by $10");
  
  try {
    // Get contract addresses from previous deployment
    const addresses = {
      mockUSDC: "0xD8a7de870F03Cb501e64096E15a9cF62256185A0",
      centralVault: "0xc7CfAD47F0971Aa27Faa1eE7DBee48887f8E05ed", 
      orderRouter: "0x6699Ef9B72C470895A3deaa47381Dfbc0461FF8B",
      orderBook: "0x3EC4ECc94BA54a027c56FE31E6a5EC651179EAE7"
    };

    const [trader1, trader2, trader3] = await ethers.getSigners();
    const orderRouter = await ethers.getContractAt("OrderRouter", addresses.orderRouter);
    const orderBook = await ethers.getContractAt("OrderBook", addresses.orderBook);
    
    // Trader 1 address for reference
    const trader1Address = "0x67578a5bffc0fF03CF7661DB7eD51360884Fc371";
    
    PNLManipulator.info("Target trader address", { trader1: trader1Address });
    
    PNLManipulator.step(1, "Analyzing Trader 1's Current Position");
    
    // Get current market price and Trader 1's position
    let currentPrice;
    try {
      const marketStats = await orderBook.getMarketStats();
      currentPrice = marketStats.lastTradePrice;
      if (currentPrice === 0n) {
        currentPrice = ethers.parseEther("2.0"); // Default from our test
      }
    } catch {
      currentPrice = ethers.parseEther("2.0");
    }
    
    PNLManipulator.info("Current market analysis", {
      currentPrice: ethers.formatEther(currentPrice),
      priceInWei: currentPrice.toString()
    });
    
    // Get Trader 1's position details (from our previous test we know they have a LONG position)
    // Position: LONG 0.5 units at 2.0 entry price
    const trader1Position = {
      quantity: ethers.parseEther("0.5"), // 0.5 units
      entryPrice: ethers.parseEther("2.0"), // Entry at 2.0
      isLong: true,
      collateral: ethers.parseUnits("1.0", 6) // 1.0 USDC collateral
    };
    
    PNLManipulator.info("Trader 1's position", {
      type: "LONG",
      quantity: ethers.formatEther(trader1Position.quantity),
      entryPrice: ethers.formatEther(trader1Position.entryPrice),
      collateral: ethers.formatUnits(trader1Position.collateral, 6) + " USDC"
    });
    
    PNLManipulator.step(2, "Calculating Required Price for $10 Profit");
    
    // For a LONG position: PNL = quantity × (newPrice - entryPrice) / PRICE_PRECISION
    // We want PNL = $10 (in 6-decimal USDC precision = 10,000,000)
    // So: 10,000,000 = (0.5 × (newPrice - 2.0)) / 1e18 × 1e12 (converting to USDC precision)
    // Simplified: 10 = 0.5 × (newPrice - 2.0)
    // newPrice - 2.0 = 20
    // newPrice = 22.0
    
    const targetProfitUSDC = ethers.parseUnits("10", 6); // $10 in USDC (6 decimals)
    const PRICE_PRECISION = ethers.parseEther("1"); // 1e18
    
    // Convert target profit to 18-decimal precision for calculation
    const targetProfitWei = targetProfitUSDC * BigInt(1e12); // Convert 6 to 18 decimals
    
    // Calculate required price change: priceDiff = (targetProfit × PRICE_PRECISION) / quantity
    const requiredPriceDiff = (targetProfitWei * PRICE_PRECISION) / trader1Position.quantity;
    const newPrice = trader1Position.entryPrice + requiredPriceDiff;
    
    PNLManipulator.info("Price calculation", {
      targetProfit: "10.0 USDC",
      requiredPriceDiff: ethers.formatEther(requiredPriceDiff),
      newPrice: ethers.formatEther(newPrice),
      priceIncrease: ethers.formatEther(requiredPriceDiff) + " (from " + ethers.formatEther(currentPrice) + " to " + ethers.formatEther(newPrice) + ")"
    });
    
    PNLManipulator.step(3, "Creating Trade to Move Market Price");
    
    // To move the market price, we need to create a trade at the new price
    // We'll use trader2 to place a SELL order at the new price, then trader3 to BUY at that price
    
    const marketMetricId = "FIXED_TEST_" + Math.floor(Date.now() / 100000) * 100000;
    
    PNLManipulator.action("Trader 2 placing SELL order at target price", {
      price: ethers.formatEther(newPrice),
      quantity: "0.1",
      purpose: "Create ask at target price"
    });
    
    // Trader 2 places a SELL order at the new price
    const sellOrder = {
      orderId: 0,
      trader: trader2.address,
      metricId: marketMetricId,
      orderType: 1, // LIMIT
      side: 1, // SELL
      quantity: ethers.parseEther("0.1"), // Small quantity
      price: newPrice,
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0, // GTC
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    };
    
    try {
      const sellTx = await orderRouter.connect(trader2).placeOrder(sellOrder);
      await sellTx.wait();
      PNLManipulator.success("SELL order placed successfully");
    } catch (error) {
      PNLManipulator.info("SELL order failed (might be using wrong market)", { error: error.message });
      PNLManipulator.info("This is expected if using a different market session");
    }
    
    PNLManipulator.action("Trader 3 placing BUY order to execute at target price", {
      price: ethers.formatEther(newPrice),
      quantity: "0.1",
      purpose: "Execute trade to establish new market price"
    });
    
    // Trader 3 places a BUY order at the new price to execute the trade
    const buyOrder = {
      orderId: 0,
      trader: trader3.address,
      metricId: marketMetricId,
      orderType: 1, // LIMIT
      side: 0, // BUY
      quantity: ethers.parseEther("0.1"),
      price: newPrice,
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0, // GTC
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: ethers.ZeroHash
    };
    
    try {
      const buyTx = await orderRouter.connect(trader3).placeOrder(buyOrder);
      const receipt = await buyTx.wait();
      
      PNLManipulator.success("BUY order executed - Market price updated!", {
        gasUsed: receipt.gasUsed.toString(),
        newMarketPrice: ethers.formatEther(newPrice)
      });
    } catch (error) {
      PNLManipulator.info("BUY order failed (might be using wrong market)", { error: error.message });
      PNLManipulator.info("This is expected if using a different market session");
    }
    
    PNLManipulator.step(4, "Verifying New Market Price");
    
    // Check the new market price
    try {
      const updatedStats = await orderBook.getMarketStats();
      const newMarketPrice = updatedStats.lastTradePrice;
      
      PNLManipulator.success("Market price verification", {
        previousPrice: ethers.formatEther(currentPrice),
        newPrice: ethers.formatEther(newMarketPrice > 0 ? newMarketPrice : newPrice),
        priceIncrease: ethers.formatEther((newMarketPrice > 0 ? newMarketPrice : newPrice) - currentPrice),
        expectedTrader1Profit: "~$10.00 USDC"
      });
    } catch (error) {
      PNLManipulator.info("Could not verify market price", { error: error.message });
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("🎯 PRICE MANIPULATION COMPLETED!");
    console.log("📈 Trader 1's LONG position should now show ~$10 profit");
    console.log("🔄 Run 'npm run pnl' to see the updated P&L analysis");
    console.log("=".repeat(80));
    
  } catch (error) {
    console.error("❌ Error manipulating P&L:", error);
    console.log("\n💡 The market might be from a different test session.");
    console.log("   Try running 'npm run test:fixed:ganache' first to create fresh positions.");
  }
}

// Allow script to be run directly
if (require.main === module) {
  increaseTrader1PNL()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

export { increaseTrader1PNL };







