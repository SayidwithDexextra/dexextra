#!/usr/bin/env node
/**
 * Load Market Orders - Multi-Wallet Mainnet Compatible
 * 
 * Loads orders and positions onto a selected market using wallets from CSV.
 * Works on Hyperliquid mainnet/testnet with real funded wallets.
 * 
 * Usage:
 *   npx hardhat run scripts/load-market-orders.js --network hyperliquid
 *   npx hardhat run scripts/load-market-orders.js --network hyperliquid_testnet
 *   npx hardhat run scripts/load-market-orders.js --network localhost
 */

// Load environment
const path = require("path");
const fs = require("fs");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");
const readline = require("readline");

// ============ Configuration ============
const CONFIG = {
  // Wallets CSV path (relative to project root)
  WALLETS_CSV: path.resolve(__dirname, "../../AdvancedMarketAutomation/wallets.csv"),
  
  // Order parameters per user
  ORDERS_PER_USER: 5,       // Resting orders per user
  ORDER_SIZE: ethers.parseUnits("0.01", 18), // Size per order (0.01 tokens)
  POSITION_SIZE: ethers.parseUnits("0.01", 18), // Position size per user
  
  // Price spread (orders placed across this range below/above current price)
  BUY_SPREAD_PERCENT: 30,   // Buy orders from -1% to -30% below mark
  SELL_SPREAD_PERCENT: 30,  // Sell orders from +1% to +30% above mark
  
  // Safety limits
  MIN_COLLATERAL_PER_USER: ethers.parseUnits("50", 6), // Minimum $50 collateral
  
  // Whether to create positions (requires liquidity)
  CREATE_POSITIONS: true,
  
  // For localhost: fund users automatically
  AUTO_FUND_LOCALHOST: true,
  LOCALHOST_FUND_AMOUNT: ethers.parseUnits("1000", 6), // $1000 per user on localhost
};

// Colors for terminal output
const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function log(msg, color = "") {
  console.log(`${color}${msg}${c.reset}`);
}

function banner(title, color = c.cyan) {
  const line = "═".repeat(60);
  log("\n" + line, color);
  log("  " + title, c.bright + color);
  log(line, color);
}

function logSuccess(msg) { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function logError(msg) { console.log(`  ${c.red}✗${c.reset} ${msg}`); }
function logInfo(msg) { console.log(`  ${c.blue}ℹ${c.reset} ${msg}`); }
function logWarn(msg) { console.log(`  ${c.yellow}⚠${c.reset} ${msg}`); }

function progress(current, total, msg) {
  const pct = Math.round((current / total) * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${c.yellow}[${bar}]${c.reset} ${pct}% - ${msg}        `);
}

// ============ Wallet Loading ============

function loadWalletsFromCSV(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Wallets CSV not found: ${csvPath}`);
  }
  
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  
  const wallets = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim());
    if (values.length >= 3 && values[2]) {
      wallets.push({
        nickname: values[0],
        address: values[1],
        privateKey: values[2],
      });
    }
  }
  
  return wallets;
}

function createSignersFromWallets(wallets, provider) {
  return wallets.map(w => new ethers.Wallet(w.privateKey, provider));
}

// ============ Network Detection ============

function getDeploymentPath(networkName) {
  const candidates = [
    path.join(__dirname, `../deployments/${networkName}-deployment.json`),
    path.join(__dirname, `../deployments/hyperliquid-deployment.json`),
    path.join(__dirname, `../deployments/localhost-deployment.json`),
  ];
  
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

async function loadDeployment(networkName) {
  const deploymentPath = getDeploymentPath(networkName);
  if (!deploymentPath) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }
  log(`  Loading deployment from: ${path.basename(deploymentPath)}`, c.dim);
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

// ============ Market Discovery ============

async function discoverMarkets(factory, coreVault) {
  const markets = [];
  
  try {
    const filter = factory.filters.FuturesMarketCreated();
    const events = await factory.queryFilter(filter, -10000);
    
    for (const event of events) {
      try {
        const marketId = event.args.marketId;
        const orderBook = event.args.orderBook;
        const symbol = event.args.symbol || "Unknown";
        const isSettled = await coreVault.marketSettled(marketId);
        
        markets.push({ marketId, orderBook, symbol, isSettled, blockNumber: event.blockNumber });
      } catch (e) {}
    }
  } catch (e) {
    log(`  Could not query factory events: ${e.message}`, c.dim);
  }
  
  return markets;
}

// ============ Main Script ============

async function main() {
  banner("LOAD MARKET ORDERS (Multi-Wallet)", c.cyan);
  
  const networkName = process.env.HARDHAT_NETWORK || "localhost";
  const isMainnet = networkName === "hyperliquid";
  const isLocalhost = networkName === "localhost";
  
  logInfo(`Network: ${networkName}`);
  
  if (isMainnet) {
    logWarn("⚠️  MAINNET DETECTED - Real funds will be used!");
    const confirm = await ask(`${c.yellow}  Type 'yes' to continue on mainnet: ${c.reset}`);
    if (confirm.toLowerCase() !== 'yes') {
      log("  Aborted.", c.red);
      rl.close();
      return;
    }
  }

  // Load wallets from CSV
  banner("LOADING WALLETS", c.blue);
  
  let walletData;
  try {
    walletData = loadWalletsFromCSV(CONFIG.WALLETS_CSV);
    logSuccess(`Loaded ${walletData.length} wallets from CSV`);
  } catch (e) {
    logError(`Failed to load wallets: ${e.message}`);
    rl.close();
    return;
  }
  
  // Create signers from wallets
  const userSigners = createSignersFromWallets(walletData, ethers.provider);
  logInfo(`Created ${userSigners.length} signers`);
  
  // Also get the deployer/admin signer
  const [adminSigner] = await ethers.getSigners();
  logInfo(`Admin: ${adminSigner.address}`);

  // Load deployment
  const deployment = await loadDeployment(networkName);
  
  // Load contracts
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    deployment.contracts.FUTURES_MARKET_FACTORY
  );
  const coreVault = await ethers.getContractAt(
    "CoreVault",
    deployment.contracts.CORE_VAULT
  );
  const mockUSDC = await ethers.getContractAt(
    "IERC20",
    deployment.contracts.MOCK_USDC
  );
  
  // Discover markets
  log("\n  Discovering markets...", c.dim);
  const markets = await discoverMarkets(factory, coreVault);
  
  // Add known market from deployment
  if (deployment.contracts.ALUMINUM_ORDERBOOK) {
    const exists = markets.some(m => 
      m.orderBook.toLowerCase() === deployment.contracts.ALUMINUM_ORDERBOOK.toLowerCase()
    );
    if (!exists) {
      const marketId = deployment.contracts.ALUMINUM_MARKET_ID;
      const isSettled = await coreVault.marketSettled(marketId);
      markets.push({
        marketId,
        orderBook: deployment.contracts.ALUMINUM_ORDERBOOK,
        symbol: "ALU-USD",
        isSettled,
        blockNumber: 0,
      });
    }
  }
  
  if (markets.length === 0) {
    logError("No markets found!");
    rl.close();
    return;
  }
  
  // Display markets
  banner("AVAILABLE MARKETS", c.blue);
  
  const activeMarkets = markets.filter(m => !m.isSettled);
  
  log("\n  Active Markets:", c.bright);
  activeMarkets.forEach((m, i) => {
    log(`    ${i + 1}. ${m.symbol} - ${m.orderBook.substring(0, 18)}...`, c.green);
  });
  
  if (activeMarkets.length === 0) {
    logError("No active markets to load orders onto!");
    rl.close();
    return;
  }
  
  // Select market
  const selection = await ask(`\n${c.cyan}  Select market (1-${activeMarkets.length}): ${c.reset}`);
  const marketIndex = parseInt(selection) - 1;
  
  if (isNaN(marketIndex) || marketIndex < 0 || marketIndex >= activeMarkets.length) {
    logError("Invalid selection");
    rl.close();
    return;
  }
  
  const selectedMarket = activeMarkets[marketIndex];
  logSuccess(`Selected: ${selectedMarket.symbol}`);
  
  // Load order book contracts
  const obPlacement = await ethers.getContractAt(
    "OBOrderPlacementFacet",
    selectedMarket.orderBook
  );
  const obView = await ethers.getContractAt(
    "OBViewFacet",
    selectedMarket.orderBook
  );
  const obPricing = await ethers.getContractAt(
    "OBPricingFacet",
    selectedMarket.orderBook
  );
  
  // Get current market state
  banner("MARKET STATE", c.blue);
  
  let markPrice;
  try {
    markPrice = await obPricing.getMarkPrice();
  } catch (e) {
    try {
      markPrice = await coreVault.getMarkPrice(selectedMarket.marketId);
    } catch (e2) {
      markPrice = ethers.parseUnits("2500", 6);
    }
  }
  
  const bestBid = await obView.bestBid();
  const bestAsk = await obView.bestAsk();
  
  logInfo(`Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
  logInfo(`Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
  logInfo(`Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);
  
  // Check all wallet balances
  banner("WALLET BALANCE CHECK", c.yellow);
  
  log("  Checking balances for all wallets...", c.dim);
  
  const walletBalances = [];
  let totalWalletUSDC = 0n;
  let totalDepositedCollateral = 0n;
  let totalAvailableCollateral = 0n;
  let fundedWallets = 0;
  let unfundedWallets = 0;
  
  for (let i = 0; i < userSigners.length; i++) {
    const user = userSigners[i];
    const nickname = walletData[i].nickname;
    
    try {
      const walletBalance = await mockUSDC.balanceOf(user.address);
      const depositedCollateral = await coreVault.userCollateral(user.address);
      const availableCollateral = await coreVault.getAvailableCollateral(user.address);
      
      walletBalances.push({
        nickname,
        address: user.address,
        walletUSDC: walletBalance,
        deposited: depositedCollateral,
        available: availableCollateral,
      });
      
      totalWalletUSDC += walletBalance;
      totalDepositedCollateral += depositedCollateral;
      totalAvailableCollateral += availableCollateral;
      
      if (availableCollateral >= CONFIG.MIN_COLLATERAL_PER_USER) {
        fundedWallets++;
      } else {
        unfundedWallets++;
      }
      
      if ((i + 1) % 20 === 0) {
        progress(i + 1, userSigners.length, `Checked ${i + 1}/${userSigners.length} wallets`);
      }
    } catch (e) {
      walletBalances.push({
        nickname,
        address: user.address,
        walletUSDC: 0n,
        deposited: 0n,
        available: 0n,
        error: e.message,
      });
      unfundedWallets++;
    }
  }
  console.log();
  
  // Display summary
  log("\n  Balance Summary:", c.bright);
  logInfo(`Total wallets: ${userSigners.length}`);
  logInfo(`Funded (>=$${ethers.formatUnits(CONFIG.MIN_COLLATERAL_PER_USER, 6)} available): ${fundedWallets}`);
  if (unfundedWallets > 0) {
    logWarn(`Unfunded/Insufficient: ${unfundedWallets}`);
  }
  log("");
  logInfo(`Total USDC in wallets: $${ethers.formatUnits(totalWalletUSDC, 6)}`);
  logInfo(`Total deposited collateral: $${ethers.formatUnits(totalDepositedCollateral, 6)}`);
  logInfo(`Total available collateral: $${ethers.formatUnits(totalAvailableCollateral, 6)}`);
  
  // Show top 5 and bottom 5 wallets by available collateral
  const sortedByAvailable = [...walletBalances].sort((a, b) => 
    Number(b.available - a.available)
  );
  
  if (sortedByAvailable.length > 0) {
    log("\n  Top 5 funded wallets:", c.dim);
    sortedByAvailable.slice(0, 5).forEach((w, i) => {
      log(`    ${i + 1}. ${w.nickname}: $${ethers.formatUnits(w.available, 6)} available`, c.green);
    });
    
    const unfundedList = sortedByAvailable.filter(w => w.available < CONFIG.MIN_COLLATERAL_PER_USER);
    if (unfundedList.length > 0 && unfundedList.length <= 10) {
      log("\n  Unfunded wallets:", c.dim);
      unfundedList.forEach((w) => {
        log(`    - ${w.nickname}: $${ethers.formatUnits(w.available, 6)} available`, c.red);
      });
    } else if (unfundedList.length > 10) {
      log(`\n  ${unfundedList.length} wallets need funding (showing first 5):`, c.dim);
      unfundedList.slice(0, 5).forEach((w) => {
        log(`    - ${w.nickname}: $${ethers.formatUnits(w.available, 6)} available`, c.red);
      });
    }
  }
  
  // Calculate what we can do with current balances
  const marginPerPosition = (markPrice * CONFIG.POSITION_SIZE) / ethers.parseUnits("1", 18);
  const marginPerOrder = (markPrice * CONFIG.ORDER_SIZE) / ethers.parseUnits("1", 18);
  const marginPerUser = marginPerPosition + (marginPerOrder * BigInt(CONFIG.ORDERS_PER_USER));
  
  log("\n  Estimated margin requirements:", c.dim);
  logInfo(`Per position: ~$${ethers.formatUnits(marginPerPosition, 6)}`);
  logInfo(`Per order: ~$${ethers.formatUnits(marginPerOrder, 6)}`);
  logInfo(`Per user (1 pos + ${CONFIG.ORDERS_PER_USER} orders): ~$${ethers.formatUnits(marginPerUser, 6)}`);
  
  const affordableUsers = Number(totalAvailableCollateral / marginPerUser);
  logInfo(`Wallets that can afford full load: ~${Math.min(affordableUsers, fundedWallets)}`);
  
  // Ask what to do
  log("\n  Options:", c.bright);
  log("    1. Proceed with funded wallets only");
  log("    2. Fund unfunded wallets first (localhost only)");
  log("    3. Abort");
  
  const actionChoice = await ask(`\n${c.yellow}  Select option (1/2/3): ${c.reset}`);
  
  if (actionChoice === "3") {
    log("  Aborted.", c.red);
    rl.close();
    return;
  }
  
  // Option 2: Fund unfunded wallets (localhost only)
  if (actionChoice === "2") {
    if (!isLocalhost) {
      logError("Auto-funding only available on localhost!");
      rl.close();
      return;
    }
    
    banner("FUNDING WALLETS (Localhost)", c.yellow);
    
    const mintable = await ethers.getContractAt(
      ["function mint(address,uint256) external"],
      deployment.contracts.MOCK_USDC
    );
    
    // Fund admin first for liquidity
    log("  Funding admin for liquidity...", c.dim);
    await mintable.connect(adminSigner).mint(adminSigner.address, ethers.parseUnits("1000000", 6));
    await mockUSDC.connect(adminSigner).approve(coreVault.target, ethers.MaxUint256);
    await coreVault.connect(adminSigner).depositCollateral(ethers.parseUnits("500000", 6));
    logSuccess("Admin funded with $500k collateral");
    
    // Seed liquidity if needed
    const currentBid = await obView.bestBid();
    const currentAsk = await obView.bestAsk();
    if (currentBid === 0n || currentAsk === 0n) {
      log("  Seeding market liquidity...", c.dim);
      const liquiditySize = ethers.parseUnits("100", 18);
      await obPlacement.connect(adminSigner).placeMarginLimitOrder(
        markPrice - ethers.parseUnits("1", 6),
        liquiditySize,
        true
      );
      await obPlacement.connect(adminSigner).placeMarginLimitOrder(
        markPrice + ethers.parseUnits("1", 6),
        liquiditySize,
        false
      );
      logSuccess("Liquidity seeded (bid/ask spread)");
    }
    
    // Fund unfunded users
    const unfundedUsers = walletBalances.filter(w => w.available < CONFIG.MIN_COLLATERAL_PER_USER);
    log(`  Funding ${unfundedUsers.length} unfunded wallets...`, c.dim);
    
    let fundedCount = 0;
    for (let i = 0; i < unfundedUsers.length; i++) {
      const walletInfo = unfundedUsers[i];
      const userIndex = walletBalances.findIndex(w => w.address === walletInfo.address);
      const user = userSigners[userIndex];
      
      try {
        await mintable.connect(adminSigner).mint(user.address, CONFIG.LOCALHOST_FUND_AMOUNT);
        await mockUSDC.connect(user).approve(coreVault.target, ethers.MaxUint256);
        await coreVault.connect(user).depositCollateral(CONFIG.LOCALHOST_FUND_AMOUNT);
        
        // Update balance tracking
        walletBalances[userIndex].available = CONFIG.LOCALHOST_FUND_AMOUNT;
        fundedCount++;
        
        if ((i + 1) % 10 === 0 || i === unfundedUsers.length - 1) {
          progress(i + 1, unfundedUsers.length, `${fundedCount}/${unfundedUsers.length} funded`);
        }
      } catch (e) {
        // Skip failed funding
      }
    }
    console.log();
    logSuccess(`Funded ${fundedCount} wallets with $${ethers.formatUnits(CONFIG.LOCALHOST_FUND_AMOUNT, 6)} each`);
    
    // Recalculate funded count
    fundedWallets = walletBalances.filter(w => w.available >= CONFIG.MIN_COLLATERAL_PER_USER).length;
  }
  
  // Seed liquidity if needed (for option 1 on localhost)
  if (actionChoice === "1" && isLocalhost) {
    const currentBid = await obView.bestBid();
    const currentAsk = await obView.bestAsk();
    if (currentBid === 0n || currentAsk === 0n) {
      banner("SEEDING LIQUIDITY", c.yellow);
      
      const mintable = await ethers.getContractAt(
        ["function mint(address,uint256) external"],
        deployment.contracts.MOCK_USDC
      );
      
      // Check admin collateral
      const adminAvailable = await coreVault.getAvailableCollateral(adminSigner.address);
      if (adminAvailable < ethers.parseUnits("100000", 6)) {
        log("  Funding admin for liquidity...", c.dim);
        await mintable.connect(adminSigner).mint(adminSigner.address, ethers.parseUnits("500000", 6));
        await mockUSDC.connect(adminSigner).approve(coreVault.target, ethers.MaxUint256);
        await coreVault.connect(adminSigner).depositCollateral(ethers.parseUnits("500000", 6));
      }
      
      log("  Seeding market liquidity...", c.dim);
      const liquiditySize = ethers.parseUnits("100", 18);
      await obPlacement.connect(adminSigner).placeMarginLimitOrder(
        markPrice - ethers.parseUnits("1", 6),
        liquiditySize,
        true
      );
      await obPlacement.connect(adminSigner).placeMarginLimitOrder(
        markPrice + ethers.parseUnits("1", 6),
        liquiditySize,
        false
      );
      logSuccess("Liquidity seeded (bid/ask spread)");
    }
  }
  
  // Check liquidity for non-localhost
  if (!isLocalhost) {
    const currentBid = await obView.bestBid();
    const currentAsk = await obView.bestAsk();
    if ((currentBid === 0n || currentAsk === 0n) && CONFIG.CREATE_POSITIONS) {
      logWarn("No liquidity in order book - positions cannot be created");
      logInfo("Only resting orders will be placed");
      CONFIG.CREATE_POSITIONS = false;
    }
  }
  
  // Final confirmation
  logInfo(`\nReady to load ${fundedWallets} wallets`);
  const finalConfirm = await ask(`${c.yellow}  Continue? (yes/no): ${c.reset}`);
  if (finalConfirm.toLowerCase() !== 'yes') {
    log("  Aborted.", c.red);
    rl.close();
    return;
  }
  
  // Load orders and positions for each user
  banner("LOADING ORDERS & POSITIONS", c.green);
  
  let totalPositions = 0;
  let totalOrders = 0;
  let skippedUsers = 0;
  let failedUsers = 0;
  
  for (let i = 0; i < userSigners.length; i++) {
    const user = userSigners[i];
    const nickname = walletData[i].nickname;
    const isBuySide = i % 2 === 0; // Alternate buy/sell
    const walletInfo = walletBalances[i];
    
    try {
      // Skip wallets with insufficient collateral (already checked)
      if (walletInfo.available < CONFIG.MIN_COLLATERAL_PER_USER) {
        skippedUsers++;
        continue;
      }
      
      // Create position if enabled and liquidity exists
      if (CONFIG.CREATE_POSITIONS) {
        const currentBid = await obView.bestBid();
        const currentAsk = await obView.bestAsk();
        
        if ((isBuySide && currentAsk > 0n) || (!isBuySide && currentBid > 0n)) {
          try {
            await obPlacement.connect(user).placeMarginMarketOrder(
              CONFIG.POSITION_SIZE,
              isBuySide
            );
            totalPositions++;
          } catch (e) {
            // Position failed, continue with orders
          }
        }
      }
      
      // Place resting orders spread across price levels
      const userOrders = CONFIG.ORDERS_PER_USER;
      const spreadPercent = isBuySide ? CONFIG.BUY_SPREAD_PERCENT : CONFIG.SELL_SPREAD_PERCENT;
      const priceStep = (markPrice * BigInt(spreadPercent)) / (BigInt(userOrders) * 100n);
      
      for (let j = 0; j < userOrders; j++) {
        try {
          const offset = priceStep * BigInt(j + 1);
          const price = isBuySide ? markPrice - offset : markPrice + offset;
          
          if (price <= 0n) continue;
          
          await obPlacement.connect(user).placeMarginLimitOrder(
            price,
            CONFIG.ORDER_SIZE,
            isBuySide
          );
          totalOrders++;
        } catch (e) {
          // Order failed, continue
        }
      }
      
      if ((i + 1) % 5 === 0 || i === userSigners.length - 1) {
        progress(i + 1, userSigners.length, `${nickname}: ${totalPositions} pos, ${totalOrders} orders`);
      }
      
    } catch (e) {
      failedUsers++;
      if (failedUsers <= 3) {
        console.log(`\n  ${nickname} error: ${e.message?.substring(0, 80)}`);
      }
    }
  }
  console.log();
  
  // Summary
  banner("LOAD COMPLETE", c.green);
  
  const finalBid = await obView.bestBid();
  const finalAsk = await obView.bestAsk();
  const positionCount = await coreVault.getMarketPositionUserCount(selectedMarket.marketId);
  
  const processedUsers = userSigners.length - skippedUsers - failedUsers;
  logSuccess(`Users processed: ${processedUsers}/${userSigners.length}`);
  logSuccess(`Positions created: ${totalPositions}`);
  logSuccess(`Orders placed: ${totalOrders}`);
  logInfo(`Tracked positions in market: ${positionCount}`);
  logInfo(`Final Best Bid: $${ethers.formatUnits(finalBid, 6)}`);
  logInfo(`Final Best Ask: $${ethers.formatUnits(finalAsk, 6)}`);
  
  if (skippedUsers > 0) {
    logInfo(`Skipped (insufficient collateral): ${skippedUsers}`);
  }
  if (failedUsers > 0) {
    logWarn(`Failed during loading: ${failedUsers}`);
  }
  
  log(`\n  Market ${selectedMarket.symbol} is now loaded!`, c.bright);
  log(`  Total: ${totalPositions} positions + ${totalOrders} resting orders`, c.dim);
  log(`  Use batch settlement to settle this market.\n`, c.dim);
  
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
