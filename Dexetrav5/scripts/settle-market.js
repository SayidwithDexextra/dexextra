#!/usr/bin/env node
/**
 * Market Settlement Relayer
 * 
 * Automatically settles markets using the appropriate method:
 * - Regular settlement for small markets (single transaction)
 * - Batch settlement for large markets (multi-transaction)
 * 
 * Usage:
 *   npx hardhat run scripts/settle-market.js --network localhost
 *   npx hardhat run scripts/settle-market.js --network hyperliquid
 */

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
  // Batch sizes for settlement steps
  ORDER_BATCH_SIZE: 200,
  CALC_BATCH_SIZE: 100,
  APPLY_BATCH_SIZE: 50,
  
  // Gas limit for regular settlement attempt
  REGULAR_SETTLEMENT_GAS: 30_000_000,
  
  // Polling interval for batch operations (ms)
  POLL_INTERVAL: 1000,
};

// Colors
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

// ============ Network & Deployment ============

function getDeploymentPath(networkName) {
  const candidates = [
    path.join(__dirname, `../deployments/${networkName}-deployment.json`),
    path.join(__dirname, `../deployments/hyperliquid-deployment.json`),
    path.join(__dirname, `../deployments/localhost-deployment.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function loadDeployment(networkName) {
  const deploymentPath = getDeploymentPath(networkName);
  if (!deploymentPath) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

// ============ Market Discovery ============

async function discoverMarkets(factory, coreVault) {
  const markets = [];
  
  try {
    const filter = factory.filters.FuturesMarketCreated();
    const events = await factory.queryFilter(filter, -50000);
    
    for (const event of events) {
      try {
        const marketId = event.args.marketId;
        const orderBook = event.args.orderBook;
        const symbol = event.args.symbol || "Unknown";
        const isSettled = await coreVault.marketSettled(marketId);
        
        markets.push({ marketId, orderBook, symbol, isSettled });
      } catch (e) {}
    }
  } catch (e) {
    log(`  Could not query factory events: ${e.message}`, c.dim);
  }
  
  return markets;
}

// ============ Regular Settlement ============

async function tryRegularSettlement(obSettlement, finalPrice, gasLimit) {
  try {
    // First estimate gas
    const estimatedGas = await obSettlement.settleMarket.estimateGas(finalPrice);
    logInfo(`Estimated gas: ${estimatedGas.toLocaleString()}`);
    
    if (estimatedGas > BigInt(gasLimit)) {
      logWarn(`Gas estimate exceeds limit (${gasLimit.toLocaleString()})`);
      return { success: false, reason: "gas_exceeded", estimatedGas };
    }
    
    // Try settlement
    const tx = await obSettlement.settleMarket(finalPrice, { gasLimit });
    const receipt = await tx.wait();
    
    return { 
      success: true, 
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed
    };
  } catch (e) {
    return { 
      success: false, 
      reason: "reverted",
      error: e.message?.substring(0, 100) 
    };
  }
}

// ============ Batch Settlement ============

async function runBatchSettlement(obBatchSettlement, obSettlement, finalPrice) {
  const startTime = Date.now();
  let totalGas = 0n;
  let txCount = 0;

  // Phase 0: Initialize
  log("\n  [1/6] Initializing batch settlement...", c.bright);
  let tx = await obBatchSettlement.initBatchSettlement(finalPrice);
  let receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  logSuccess(`Initialized (gas: ${receipt.gasUsed.toLocaleString()})`);

  // Phase 1a: Cancel buy orders
  log("\n  [2/6] Cancelling buy orders...", c.bright);
  let complete = false;
  let batchNum = 0;
  while (!complete) {
    const result = await obBatchSettlement.batchCancelBuyOrders.staticCall(CONFIG.ORDER_BATCH_SIZE);
    tx = await obBatchSettlement.batchCancelBuyOrders(CONFIG.ORDER_BATCH_SIZE);
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    txCount++;
    complete = result[0];
    batchNum++;
    progress(batchNum, batchNum + (complete ? 0 : 1), `Batch ${batchNum}: cancelled ${result[1]} orders`);
  }
  console.log();
  logSuccess(`Buy orders cancelled in ${batchNum} batches`);

  // Phase 1b: Cancel sell orders
  log("\n  [3/6] Cancelling sell orders...", c.bright);
  complete = false;
  batchNum = 0;
  while (!complete) {
    const result = await obBatchSettlement.batchCancelSellOrders.staticCall(CONFIG.ORDER_BATCH_SIZE);
    tx = await obBatchSettlement.batchCancelSellOrders(CONFIG.ORDER_BATCH_SIZE);
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    txCount++;
    complete = result[0];
    batchNum++;
    progress(batchNum, batchNum + (complete ? 0 : 1), `Batch ${batchNum}: cancelled ${result[1]} orders`);
  }
  console.log();
  logSuccess(`Sell orders cancelled in ${batchNum} batches`);

  // Phase 2: Calculate totals
  log("\n  [4/6] Calculating settlement totals...", c.bright);
  complete = false;
  batchNum = 0;
  while (!complete) {
    complete = await obBatchSettlement.runVaultBatchCalculation.staticCall(CONFIG.CALC_BATCH_SIZE);
    tx = await obBatchSettlement.runVaultBatchCalculation(CONFIG.CALC_BATCH_SIZE);
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    txCount++;
    batchNum++;
    
    const [, , , cursor, total] = await obBatchSettlement.getSettlementProgress();
    progress(Number(cursor), Number(total) || batchNum, `Batch ${batchNum}: processed ${cursor}/${total}`);
  }
  console.log();
  logSuccess(`Calculation complete in ${batchNum} batches`);

  // Phase 3: Finalize haircut
  log("\n  [5/6] Finalizing haircut...", c.bright);
  tx = await obBatchSettlement.finalizeVaultHaircut();
  receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  logSuccess(`Haircut finalized (gas: ${receipt.gasUsed.toLocaleString()})`);

  // Phase 4: Apply settlements
  log("\n  [6/6] Applying settlements...", c.bright);
  complete = false;
  batchNum = 0;
  while (!complete) {
    complete = await obBatchSettlement.runVaultBatchApplication.staticCall(CONFIG.APPLY_BATCH_SIZE);
    tx = await obBatchSettlement.runVaultBatchApplication(CONFIG.APPLY_BATCH_SIZE);
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    txCount++;
    batchNum++;
    
    const [, , , cursor, total] = await obBatchSettlement.getSettlementProgress();
    progress(Number(cursor), Number(total) || batchNum, `Batch ${batchNum}: settled ${cursor}/${total}`);
  }
  console.log();
  logSuccess(`Settlements applied in ${batchNum} batches`);

  // Complete
  log("\n  Completing settlement...", c.bright);
  tx = await obBatchSettlement.completeSettlement();
  receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  return {
    success: true,
    txCount,
    totalGas,
    duration
  };
}

// ============ Main ============

async function main() {
  banner("MARKET SETTLEMENT RELAYER", c.cyan);
  
  const networkName = process.env.HARDHAT_NETWORK || "localhost";
  const isMainnet = networkName === "hyperliquid";
  
  logInfo(`Network: ${networkName}`);
  
  if (isMainnet) {
    logWarn("⚠️  MAINNET DETECTED - This will settle real markets!");
    const confirm = await ask(`${c.yellow}  Type 'yes' to continue: ${c.reset}`);
    if (confirm.toLowerCase() !== 'yes') {
      log("  Aborted.", c.red);
      rl.close();
      return;
    }
  }

  // Load deployment
  const deployment = await loadDeployment(networkName);
  const [signer] = await ethers.getSigners();
  
  logInfo(`Signer: ${signer.address}`);
  
  // Load contracts
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    deployment.contracts.FUTURES_MARKET_FACTORY
  );
  const coreVault = await ethers.getContractAt(
    "CoreVault",
    deployment.contracts.CORE_VAULT
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
      });
    }
  }
  
  // Filter to unsettled markets
  const unsettledMarkets = markets.filter(m => !m.isSettled);
  
  if (unsettledMarkets.length === 0) {
    logWarn("No unsettled markets found!");
    rl.close();
    return;
  }
  
  // Display markets
  banner("UNSETTLED MARKETS", c.blue);
  
  unsettledMarkets.forEach((m, i) => {
    log(`  ${i + 1}. ${m.symbol} - ${m.orderBook.substring(0, 20)}...`, c.green);
  });
  
  // Select market
  const selection = await ask(`\n${c.cyan}  Select market to settle (1-${unsettledMarkets.length}): ${c.reset}`);
  const marketIndex = parseInt(selection) - 1;
  
  if (isNaN(marketIndex) || marketIndex < 0 || marketIndex >= unsettledMarkets.length) {
    logError("Invalid selection");
    rl.close();
    return;
  }
  
  const selectedMarket = unsettledMarkets[marketIndex];
  logSuccess(`Selected: ${selectedMarket.symbol}`);
  
  // Load facets
  const obSettlement = await ethers.getContractAt(
    "OBSettlementFacet",
    selectedMarket.orderBook
  );
  
  let obBatchSettlement;
  try {
    obBatchSettlement = await ethers.getContractAt(
      "OBBatchSettlementFacet",
      selectedMarket.orderBook
    );
    await obBatchSettlement.getSettlementProgress(); // Test if installed
  } catch (e) {
    obBatchSettlement = null;
    logWarn("OBBatchSettlementFacet not installed - only regular settlement available");
  }
  
  // Get settlement price
  const priceInput = await ask(`\n${c.cyan}  Enter settlement price (USD, e.g. 2600): ${c.reset}`);
  const finalPrice = ethers.parseUnits(priceInput, 6);
  
  if (finalPrice <= 0n) {
    logError("Invalid price");
    rl.close();
    return;
  }
  
  logInfo(`Settlement price: $${priceInput}`);
  
  // Try regular settlement first
  banner("ATTEMPTING REGULAR SETTLEMENT", c.yellow);
  logInfo(`Gas limit: ${CONFIG.REGULAR_SETTLEMENT_GAS.toLocaleString()}`);
  
  const result = await tryRegularSettlement(obSettlement, finalPrice, CONFIG.REGULAR_SETTLEMENT_GAS);
  
  if (result.success) {
    banner("SETTLEMENT COMPLETE", c.green);
    logSuccess(`Market settled in single transaction`);
    logInfo(`Transaction: ${result.txHash}`);
    logInfo(`Gas used: ${result.gasUsed.toLocaleString()}`);
    rl.close();
    return;
  }
  
  // Regular settlement failed - offer batch fallback
  logWarn(`Regular settlement failed: ${result.reason}`);
  if (result.estimatedGas) logInfo(`Estimated gas: ${result.estimatedGas.toLocaleString()}`);
  if (result.error) logInfo(`Error: ${result.error}`);
  
  if (!obBatchSettlement) {
    logError("Batch settlement not available - cannot proceed");
    logInfo("The OBBatchSettlementFacet needs to be installed on this market.");
    rl.close();
    return;
  }
  
  const fallback = await ask(`\n${c.yellow}  Fall back to batch settlement? (yes/no): ${c.reset}`);
  if (fallback.toLowerCase() !== 'yes') {
    log("  Aborted.", c.red);
    rl.close();
    return;
  }
  
  // Run batch settlement
  banner("RUNNING BATCH SETTLEMENT", c.magenta);
  
  const batchResult = await runBatchSettlement(obBatchSettlement, obSettlement, finalPrice);
  
  if (batchResult.success) {
    banner("BATCH SETTLEMENT COMPLETE", c.green);
    logSuccess(`Market settled successfully`);
    logInfo(`Total transactions: ${batchResult.txCount}`);
    logInfo(`Total gas used: ${batchResult.totalGas.toLocaleString()}`);
    logInfo(`Duration: ${batchResult.duration} seconds`);
  } else {
    logError("Batch settlement failed");
  }
  
  // Verify final state
  const isSettled = await obSettlement.isSettled();
  logInfo(`\nMarket settled: ${isSettled ? "YES ✓" : "NO ✗"}`);
  
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
