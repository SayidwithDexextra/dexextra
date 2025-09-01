import { ethers } from "hardhat";
import { Contract } from "ethers";

// Enhanced logging utility for PNL display
class PNLLogger {
  private static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  };

  static header(message: string) {
    console.log(`\n${PNLLogger.colors.cyan}${PNLLogger.colors.bright}━━━ ${message} ━━━${PNLLogger.colors.reset}`);
  }

  static trader(traderAddress: string, data?: any) {
    console.log(`\n${PNLLogger.colors.blue}👤 TRADER:${PNLLogger.colors.reset} ${traderAddress}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static position(message: string, data?: any) {
    console.log(`${PNLLogger.colors.magenta}📊 POSITION:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static profit(message: string, data?: any) {
    console.log(`${PNLLogger.colors.green}💰 PROFIT:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static loss(message: string, data?: any) {
    console.log(`${PNLLogger.colors.red}📉 LOSS:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static neutral(message: string, data?: any) {
    console.log(`${PNLLogger.colors.yellow}⚖️  NEUTRAL:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static info(message: string, data?: any) {
    console.log(`${PNLLogger.colors.blue}ℹ️  INFO:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }

  static summary(message: string, data?: any) {
    console.log(`\n${PNLLogger.colors.cyan}${PNLLogger.colors.bright}📈 SUMMARY:${PNLLogger.colors.reset} ${message}`);
    if (data) console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }
}

interface TraderPosition {
  positionId: bigint;
  trader: string;
  isLong: boolean;
  quantity: bigint;
  entryPrice: bigint;
  collateral: bigint;
  isSettled: boolean;
  payout: bigint;
}

interface TraderPNL {
  trader: string;
  totalPositions: number;
  totalCollateralDeposited: bigint;
  totalCollateralAllocated: bigint;
  totalUnrealizedPNL: bigint;
  totalRealizedPNL: bigint;
  positions: {
    positionId: bigint;
    type: string;
    quantity: string;
    entryPrice: string;
    currentPrice: string;
    collateral: string;
    unrealizedPNL: bigint;
    unrealizedPNLFormatted: string;
    pnlPercentage: number;
    status: string;
  }[];
}

async function getContractAddresses(): Promise<{[key: string]: string}> {
  // For this script, we'll use the last deployed addresses from our test
  // In a real application, you'd save these addresses after deployment
  
  // You can either:
  // 1. Pass contract addresses as parameters
  // 2. Read from a deployment file
  // 3. Use a contract registry
  
  console.log("🔍 Looking for deployed contracts...");
  console.log("💡 For this demo, please run the test first to deploy contracts:");
  console.log("   npm run test:fixed:ganache");
  console.log("");
  
  // These would be the addresses from your latest deployment
  // Replace with actual addresses or implement a proper contract registry
  const addresses = {
    mockUSDC: "0x837b1D6e9C47c082A8B6C681a3E1eD38f399F945",
    centralVault: "0x99Ff865799EA8f5F5493F13Ad607cd70236fD12E", 
    orderRouter: "0x41B822c2DB096063e659FF95163852926eEc63fB",
    orderBook: "0xFD3F0160c49a8791340cC8B992B247a3Af6B743b"
  };

  return addresses;
}

async function getAllPositions(orderBook: Contract): Promise<TraderPosition[]> {
  PNLLogger.info("Fetching all positions from OrderBook...");
  
  try {
    // Get all positions - this assumes the contract has a way to enumerate positions
    // If not available, we'll need to use events to reconstruct positions
    const allPositions = await orderBook.getAllPositions();
    
    return allPositions.map((pos: any, index: number) => ({
      positionId: BigInt(index + 1),
      trader: pos.trader,
      isLong: pos.isLong,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      collateral: pos.collateral,
      isSettled: pos.isSettled,
      payout: pos.payout
    }));
  } catch (error) {
    // If getAllPositions doesn't exist, try to get positions via events
    PNLLogger.info("getAllPositions not available, fetching via events...");
    return await getPositionsFromEvents(orderBook);
  }
}

async function getPositionsFromEvents(orderBook: Contract): Promise<TraderPosition[]> {
  try {
    // Get PositionCreated events to reconstruct positions
    const filter = orderBook.filters.PositionCreated();
    const events = await orderBook.queryFilter(filter);
    
    const positions: TraderPosition[] = [];
    
    for (const event of events) {
      const parsedEvent = orderBook.interface.parseLog(event);
      if (parsedEvent) {
        positions.push({
          positionId: parsedEvent.args.positionId,
          trader: parsedEvent.args.trader,
          isLong: parsedEvent.args.isLong,
          quantity: parsedEvent.args.quantity,
          entryPrice: parsedEvent.args.entryPrice,
          collateral: parsedEvent.args.collateral,
          isSettled: false, // Assume not settled unless we have settlement events
          payout: BigInt(0)
        });
      }
    }
    
    return positions;
  } catch (error) {
    PNLLogger.info("Could not fetch positions from events", { error: error.message });
    return [];
  }
}

async function getCurrentMarketPrice(orderBook: Contract): Promise<bigint> {
  try {
    // Try to get the last trade price or current market price
    const marketStats = await orderBook.getMarketStats();
    const lastTradePrice = marketStats.lastTradePrice;
    
    if (lastTradePrice > 0) {
      return lastTradePrice;
    }
    
    // If no trades, try to get mid-market price from best bid/ask
    const bestBid = await orderBook.getBestBid();
    const bestAsk = await orderBook.getBestAsk();
    
    if (bestBid > 0 && bestAsk > 0) {
      return (bestBid + bestAsk) / BigInt(2);
    }
    
    if (bestBid > 0) return bestBid;
    if (bestAsk > 0) return bestAsk;
    
    // Default to the high price we established (22.0) if no market data
    return ethers.parseEther("22.0");
    
  } catch (error) {
    PNLLogger.info("Could not get current market price, using high price from trade", { error: error.message });
    return ethers.parseEther("22.0");
  }
}

function calculatePNL(position: TraderPosition, currentPrice: bigint): {
  unrealizedPNL: bigint;
  pnlPercentage: number;
} {
  const { isLong, quantity, entryPrice, collateral } = position;
  
  // PNL calculation:
  // For LONG: PNL = quantity * (currentPrice - entryPrice) / PRICE_PRECISION
  // For SHORT: PNL = quantity * (entryPrice - currentPrice) / PRICE_PRECISION
  
  const PRICE_PRECISION = ethers.parseEther("1");
  
  let unrealizedPNL: bigint;
  
  if (isLong) {
    // Long position: profit when price goes up
    const priceDiff = currentPrice - entryPrice;
    unrealizedPNL = (quantity * priceDiff) / PRICE_PRECISION;
  } else {
    // Short position: profit when price goes down
    const priceDiff = entryPrice - currentPrice;
    unrealizedPNL = (quantity * priceDiff) / PRICE_PRECISION;
  }
  
  // Calculate percentage relative to collateral
  let pnlPercentage = 0;
  if (collateral > 0) {
    // Convert to same precision for percentage calculation
    const pnlInCollateralPrecision = unrealizedPNL / BigInt(1e12); // Convert 18 to 6 decimals
    pnlPercentage = Number(pnlInCollateralPrecision * BigInt(100)) / Number(collateral);
  }
  
  return { unrealizedPNL, pnlPercentage };
}

async function getTraderVaultBalance(centralVault: Contract, trader: string, tokenAddress: string) {
  try {
    const balance = await centralVault.getUserBalance(trader, tokenAddress);
    return {
      available: balance.available,
      allocated: balance.allocated,
      locked: balance.locked
    };
  } catch (error) {
    return {
      available: BigInt(0),
      allocated: BigInt(0),
      locked: BigInt(0)
    };
  }
}

async function viewTraderPNL() {
  PNLLogger.header("TRADER PNL ANALYSIS DASHBOARD");
  
  try {
    // Get contract addresses
    const addresses = await getContractAddresses();
    
    // Connect to contracts
    const orderBook = await ethers.getContractAt("OrderBook", addresses.orderBook);
    const centralVault = await ethers.getContractAt("CentralVault", addresses.centralVault);
    
    PNLLogger.info("Connected to contracts", {
      orderBook: addresses.orderBook,
      centralVault: addresses.centralVault,
      mockUSDC: addresses.mockUSDC
    });
    
    // Get current market price
    const currentPrice = await getCurrentMarketPrice(orderBook);
    PNLLogger.info("Current market price", {
      price: ethers.formatEther(currentPrice),
      priceWei: currentPrice.toString()
    });
    
    // Get all positions
    const allPositions = await getAllPositions(orderBook);
    
    if (allPositions.length === 0) {
      PNLLogger.info("No positions found. Run a trading test first to create positions.");
      return;
    }
    
    PNLLogger.info(`Found ${allPositions.length} total position(s)`);
    
    // Group positions by trader
    const traderPositions = new Map<string, TraderPosition[]>();
    
    for (const position of allPositions) {
      if (!traderPositions.has(position.trader)) {
        traderPositions.set(position.trader, []);
      }
      traderPositions.get(position.trader)!.push(position);
    }
    
    // Calculate PNL for each trader
    const traderPNLs: TraderPNL[] = [];
    
    for (const [traderAddress, positions] of traderPositions) {
      PNLLogger.trader(traderAddress);
      
      // Get vault balance
      const vaultBalance = await getTraderVaultBalance(centralVault, traderAddress, addresses.mockUSDC);
      
      let totalUnrealizedPNL = BigInt(0);
      const positionDetails = [];
      
      for (const position of positions) {
        const { unrealizedPNL, pnlPercentage } = calculatePNL(position, currentPrice);
        totalUnrealizedPNL += unrealizedPNL;
        
        const pnlFormatted = ethers.formatUnits(unrealizedPNL / BigInt(1e12), 6); // Convert to USDC precision
        const status = position.isSettled ? "SETTLED" : "OPEN";
        
        positionDetails.push({
          positionId: position.positionId,
          type: position.isLong ? "LONG" : "SHORT",
          quantity: ethers.formatEther(position.quantity),
          entryPrice: ethers.formatEther(position.entryPrice),
          currentPrice: ethers.formatEther(currentPrice),
          collateral: ethers.formatUnits(position.collateral, 6) + " USDC",
          unrealizedPNL,
          unrealizedPNLFormatted: pnlFormatted + " USDC",
          pnlPercentage: Math.round(pnlPercentage * 100) / 100,
          status
        });
        
        // Log individual position
        let logFunc;
        if (unrealizedPNL > 0) {
          logFunc = PNLLogger.profit;
        } else if (unrealizedPNL < 0) {
          logFunc = PNLLogger.loss;
        } else {
          logFunc = PNLLogger.neutral;
        }
        
        logFunc(`Position #${position.positionId}`, {
          type: position.isLong ? "LONG" : "SHORT",
          quantity: ethers.formatEther(position.quantity),
          entryPrice: ethers.formatEther(position.entryPrice),
          currentPrice: ethers.formatEther(currentPrice),
          collateral: ethers.formatUnits(position.collateral, 6) + " USDC",
          unrealizedPNL: pnlFormatted + " USDC",
          pnlPercentage: `${Math.round(pnlPercentage * 100) / 100}%`,
          status
        });
      }
      
      const traderPNL: TraderPNL = {
        trader: traderAddress,
        totalPositions: positions.length,
        totalCollateralDeposited: vaultBalance.available + vaultBalance.allocated + vaultBalance.locked,
        totalCollateralAllocated: vaultBalance.allocated,
        totalUnrealizedPNL,
        totalRealizedPNL: BigInt(0), // Would need to calculate from settled positions
        positions: positionDetails
      };
      
      traderPNLs.push(traderPNL);
      
      // Log trader summary
      const totalPnlFormatted = ethers.formatUnits(totalUnrealizedPNL / BigInt(1e12), 6);
      let totalLogFunc;
      if (totalUnrealizedPNL > 0) {
        totalLogFunc = PNLLogger.profit;
      } else if (totalUnrealizedPNL < 0) {
        totalLogFunc = PNLLogger.loss;
      } else {
        totalLogFunc = PNLLogger.neutral;
      }
      
      totalLogFunc(`Total PNL for ${traderAddress}`, {
        totalPositions: positions.length,
        totalDeposited: ethers.formatUnits(traderPNL.totalCollateralDeposited, 6) + " USDC",
        totalAllocated: ethers.formatUnits(traderPNL.totalCollateralAllocated, 6) + " USDC",
        totalUnrealizedPNL: totalPnlFormatted + " USDC",
        vaultBalance: {
          available: ethers.formatUnits(vaultBalance.available, 6) + " USDC",
          allocated: ethers.formatUnits(vaultBalance.allocated, 6) + " USDC",
          locked: ethers.formatUnits(vaultBalance.locked, 6) + " USDC"
        }
      });
    }
    
    // Overall market summary
    const totalPositions = allPositions.length;
    const totalUnrealizedPNL = traderPNLs.reduce((sum, trader) => sum + trader.totalUnrealizedPNL, BigInt(0));
    const totalVolume = traderPNLs.reduce((sum, trader) => 
      sum + trader.positions.reduce((posSum, pos) => 
        posSum + BigInt(Math.round(parseFloat(pos.quantity) * parseFloat(pos.entryPrice) * 1e18)), BigInt(0)), BigInt(0));
    
    PNLLogger.summary("MARKET OVERVIEW", {
      currentPrice: ethers.formatEther(currentPrice),
      totalPositions,
      totalTraders: traderPNLs.length,
      totalUnrealizedPNL: ethers.formatUnits(totalUnrealizedPNL / BigInt(1e12), 6) + " USDC",
      estimatedVolume: ethers.formatEther(totalVolume),
      timestamp: new Date().toISOString()
    });
    
    console.log("\n" + "=".repeat(80));
    console.log("💡 TIP: Run this script periodically to monitor trader performance!");
    console.log("🔄 To update positions, execute more trades and re-run this script.");
    console.log("=".repeat(80));
    
  } catch (error) {
    console.error("❌ Error analyzing trader PNL:", error);
    console.log("\n💡 Make sure you have deployed contracts and created some positions first:");
    console.log("   npm run test:fixed:ganache");
  }
}

// Allow script to be run directly
if (require.main === module) {
  viewTraderPNL()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

export { viewTraderPNL, TraderPNL };
