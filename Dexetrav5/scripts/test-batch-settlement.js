#!/usr/bin/env node
/**
 * Interactive Batch Settlement Test
 * 
 * Multi-phase interactive tool:
 *   - LIST MARKETS - Fetch markets from Supabase, check V2 compatibility
 *   - LOAD - Create positions/orders for users, then try regular settlement
 *   - SETTLE - Run batch settlement (if regular failed)
 * 
 * Usage:
 *   npx hardhat run scripts/test-batch-settlement.js --network localhost
 *   npx hardhat run scripts/test-batch-settlement.js --network hyperliquid
 */

// Load environment
try {
  const path = require("path");
  const fs = require("fs");
  const dotenv = require("dotenv");
  const candidates = [
    path.resolve(__dirname, "..", "..", ".env.local"),
    path.resolve(process.cwd(), ".env.local"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch (_) {}

if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

// ============ Configuration ============
const CONFIG = {
  NUM_USERS: 1000,
  // Position: 0.01 token at $2500 = $25 margin needed (100% requirement)
  POSITION_SIZE: ethers.parseUnits("0.01", 18),
  ENTRY_PRICE: ethers.parseUnits("2500", 6),
  // Each user deposits $200 (enough for position + multiple resting orders)
  MARGIN_AMOUNT: ethers.parseUnits("100", 6),
  FINAL_PRICE: ethers.parseUnits("2600", 6),
  
  // Number of resting orders per user (total orders = NUM_USERS * ORDERS_PER_USER)
  ORDERS_PER_USER: 5,
  
  // Hyperliquid-like gas limit (30M)
  REGULAR_SETTLEMENT_GAS: 30_000_000,
  
  // Batch sizes for settlement
  ORDER_BATCH_SIZE: 200,
  CALC_BATCH_SIZE: 100,
  APPLY_BATCH_SIZE: 50,
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
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

// ============ Utilities ============

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

async function loadDeployment() {
  const deploymentPath = path.join(__dirname, "../deployments/localhost-deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("localhost-deployment.json not found. Run deployment first.");
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

// ============ Global State ============
let contracts = {};
let signers = [];
let deployment = {};
let supabase = null;

// ============ Supabase Setup ============
function initSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "short", 
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ============ Phase: LIST MARKETS ============

async function phaseListMarkets() {
  banner("LIST MARKETS FROM SUPABASE", c.cyan);
  
  if (!supabase) {
    logError("Supabase credentials not found in .env.local");
    return null;
  }

  log("\n  Fetching markets...", c.dim);
  
  const { data: markets, error } = await supabase
    .from("markets")
    .select(`
      id,
      market_identifier,
      symbol,
      name,
      category,
      market_address,
      market_id_bytes32,
      market_status,
      created_at,
      network
    `)
    .order("created_at", { ascending: true });

  if (error) {
    logError(`Error fetching markets: ${error.message}`);
    return null;
  }

  if (!markets || markets.length === 0) {
    logWarn("No markets found in database.");
    return null;
  }

  logSuccess(`Found ${markets.length} markets\n`);

  // Display markets table
  console.log(c.bright + "  #    Symbol                    Status      Created              Address" + c.reset);
  console.log("  " + "─".repeat(95));

  markets.forEach((market, index) => {
    const num = String(index + 1).padStart(4);
    const symbol = String(market.symbol || "???").substring(0, 24).padEnd(24);
    const status = String(market.market_status || "UNKNOWN").padEnd(10);
    const created = formatDate(market.created_at).padEnd(20);
    const address = market.market_address ? market.market_address.substring(0, 20) + "..." : "Not deployed";
    
    let statusColor = c.dim;
    if (market.market_status === "ACTIVE") statusColor = c.green;
    else if (market.market_status === "SETTLED") statusColor = c.yellow;
    else if (market.market_status === "PENDING") statusColor = c.blue;

    console.log(`  ${num} ${symbol} ${statusColor}${status}${c.reset} ${created} ${address}`);
  });

  // Summary by status
  banner("SUMMARY", c.magenta);

  const statusCounts = {};
  markets.forEach(m => {
    const status = m.market_status || "UNKNOWN";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  Object.entries(statusCounts).forEach(([status, count]) => {
    let color = c.dim;
    if (status === "ACTIVE") color = c.green;
    else if (status === "SETTLED") color = c.yellow;
    log(`  ${color}${status}${c.reset}: ${count}`, "");
  });

  const deployedMarkets = markets.filter(m => m.market_address);
  log(`\n  Total deployed: ${deployedMarkets.length}`, c.bright);
  log(`  Total in database: ${markets.length}\n`, c.dim);

  // Ask user to select a market to check
  const selection = await ask(`${c.cyan}  Enter market # to check V2 compatibility (or 'q' to quit): ${c.reset}`);
  
  if (selection.toLowerCase() === 'q') {
    return markets;
  }

  const marketNum = parseInt(selection);
  if (isNaN(marketNum) || marketNum < 1 || marketNum > markets.length) {
    logError(`Invalid selection. Enter 1-${markets.length}`);
    return markets;
  }

  const selectedMarket = markets[marketNum - 1];
  await checkSingleMarket(selectedMarket);

  return markets;
}

async function checkSingleMarket(market) {
  banner(`CHECKING: ${market.symbol}`, c.yellow);

  if (!market.market_address) {
    logError("This market has no deployed address");
    return;
  }

  log(`\n  Market Details:`, c.bright);
  logInfo(`Symbol: ${market.symbol}`);
  logInfo(`Address: ${market.market_address}`);
  logInfo(`Status: ${market.market_status}`);
  logInfo(`Created: ${formatDate(market.created_at)}`);
  logInfo(`Market ID: ${market.market_id_bytes32 || "N/A"}`);

  const facetRegistryAddress = process.env.FACET_REGISTRY_ADDRESS;
  log(`\n  FacetRegistry: ${facetRegistryAddress || "NOT SET"}`, c.dim);

  // Get the diamond at the market address
  const diamondAddress = market.market_address;
  
  log(`\n  Running diagnostics on ${diamondAddress}...\n`, c.dim);

  // 1. Check if it's a valid contract
  const code = await ethers.provider.getCode(diamondAddress);
  if (code === "0x") {
    logError("No contract deployed at this address");
    return;
  }
  logSuccess(`Contract exists (${code.length / 2 - 1} bytes)`);

  // 2. Try to call facets() to see if it's a Diamond
  try {
    const diamondLoupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
    const facets = await diamondLoupe.facets();
    logSuccess(`Diamond with ${facets.length} facets attached`);
    
    log(`\n  Facets:`, c.bright);
    for (const facet of facets) {
      log(`    ${facet.facetAddress} (${facet.functionSelectors.length} selectors)`, c.dim);
    }
  } catch (e) {
    logWarn(`Not a standard Diamond or facets() failed: ${e.message?.substring(0, 60)}`);
  }

  // 3. Check for registry() function - V2 diamonds have this
  log(`\n  Checking V2 indicators...`, c.bright);
  
  let hasRegistry = false;
  try {
    const registryABI = ["function registry() view returns (address)"];
    const diamond = new ethers.Contract(diamondAddress, registryABI, ethers.provider);
    const registryAddr = await diamond.registry();
    logSuccess(`V2 Diamond: registry() returns ${registryAddr}`);
    hasRegistry = true;
    
    // Check if registry matches our FacetRegistry
    if (facetRegistryAddress && registryAddr.toLowerCase() === facetRegistryAddress.toLowerCase()) {
      logSuccess(`Registry matches FACET_REGISTRY_ADDRESS`);
    } else if (facetRegistryAddress) {
      logWarn(`Registry differs from FACET_REGISTRY_ADDRESS`);
      logInfo(`  Expected: ${facetRegistryAddress}`);
      logInfo(`  Actual:   ${registryAddr}`);
    }
  } catch (e) {
    logWarn(`No registry() function - likely V1 Diamond`);
  }

  // 4. Try calling getSettlementRequirements()
  log(`\n  Testing getSettlementRequirements()...`, c.bright);
  try {
    const settlement = await ethers.getContractAt("OBSettlementFacet", diamondAddress);
    const result = await settlement.getSettlementRequirements();
    logSuccess(`Function exists and returned data:`);
    logInfo(`  Position count: ${result[0]}`);
    logInfo(`  Buy price levels: ${result[1]}`);
    logInfo(`  Sell price levels: ${result[2]}`);
    logInfo(`  Estimated orders: ${result[3]}`);
    logInfo(`  Requires batch: ${result[4]}`);
  } catch (e) {
    logError(`getSettlementRequirements() failed`);
    logInfo(`  Error: ${e.message?.substring(0, 100)}`);
    
    // Try to understand why
    if (e.message?.includes("CALL_EXCEPTION") || e.message?.includes("missing revert")) {
      logWarn(`Function doesn't exist on this diamond`);
    }
  }

  // 5. Try calling isSettled()
  log(`\n  Testing other settlement functions...`, c.bright);
  try {
    const settlement = await ethers.getContractAt("OBSettlementFacet", diamondAddress);
    const settled = await settlement.isSettled();
    logSuccess(`isSettled(): ${settled}`);
  } catch (e) {
    logError(`isSettled() failed: ${e.message?.substring(0, 60)}`);
  }

  // 6. Try calling settleMarket.selector to see facet address
  if (facetRegistryAddress) {
    log(`\n  Checking FacetRegistry mappings...`, c.bright);
    try {
      const registry = await ethers.getContractAt("FacetRegistry", facetRegistryAddress);
      
      // settleMarket selector
      const settleSelector = "0x6c9c1d9a"; // settleMarket(uint256)
      const settleFacet = await registry.getFacet(settleSelector);
      logInfo(`settleMarket selector -> ${settleFacet}`);
      
      // getSettlementRequirements selector
      const reqSelector = "0xbcfe31ee"; // getSettlementRequirements()
      const reqFacet = await registry.getFacet(reqSelector);
      logInfo(`getSettlementRequirements selector -> ${reqFacet}`);
      
      // Check if they point to the same facet
      if (settleFacet === reqFacet && settleFacet !== ethers.ZeroAddress) {
        logSuccess(`Both selectors point to same OBSettlementFacet`);
      } else if (reqFacet === ethers.ZeroAddress) {
        logError(`getSettlementRequirements not registered in FacetRegistry!`);
      }
    } catch (e) {
      logError(`FacetRegistry check failed: ${e.message?.substring(0, 60)}`);
    }
  }

  // Summary
  banner("DIAGNOSIS", hasRegistry ? c.green : c.yellow);
  
  if (hasRegistry) {
    log(`  This appears to be a V2 Diamond (has registry())`, c.green);
    log(`  If getSettlementRequirements() fails, the FacetRegistry may`, c.dim);
    log(`  not have the updated OBSettlementFacet selectors registered.`, c.dim);
  } else {
    log(`  This appears to be a V1 Diamond (no registry())`, c.yellow);
    log(`  V1 diamonds have facets embedded directly and cannot`, c.dim);
    log(`  automatically receive FacetRegistry upgrades.`, c.dim);
  }
  console.log();
}

// ============ Phase 1: LOAD ============

async function phaseLoad() {
  banner("PHASE 1: LOAD MARKET WITH POSITIONS", c.yellow);
  
  const totalOrders = CONFIG.NUM_USERS * (CONFIG.ORDERS_PER_USER || 5);
  log(`\n  This phase will:`, c.dim);
  log(`  • Create ${CONFIG.NUM_USERS} users with positions`, c.dim);
  log(`  • Place ~${totalOrders.toLocaleString()} resting orders`, c.dim);
  log(`  • Attempt regular settlement with ${(CONFIG.REGULAR_SETTLEMENT_GAS / 1_000_000).toFixed(0)}M gas limit`, c.dim);
  log(`  • Demonstrate that it exceeds gas limits\n`, c.dim);
  
  const answer = await ask(`${c.yellow}  Press ENTER to start Phase 1, or 'skip' to skip: ${c.reset}`);
  if (answer.toLowerCase() === 'skip') {
    logInfo("Skipping Phase 1");
    return;
  }

  const admin = signers[0];
  const { coreVault, mockUSDC, obPlacement, marketId } = contracts;

  // Step 1: Check current state
  log("\n  [1/4] Checking current market state...", c.bright);
  
  const isSettled = await contracts.obSettlement.isSettled();
  if (isSettled) {
    logError("Market is already settled!");
    return;
  }
  logSuccess("Market is open for trading");

  let existingPositions = 0n;
  try {
    existingPositions = await coreVault.getMarketPositionUserCount(marketId);
  } catch (e) {
    existingPositions = 0n;
  }
  logInfo(`Existing positions tracked: ${existingPositions}`);

  // Step 2: Create positions
  log("\n  [2/4] Creating positions for users...", c.bright);
  
  const usersToSetup = Math.min(CONFIG.NUM_USERS, signers.length - 1);
  let createdPositions = 0;
  let createdOrders = 0;

  // Get mintable USDC interface
  const mintable = await ethers.getContractAt(
    ["function mint(address,uint256) external"],
    deployment.contracts.MOCK_USDC
  );

  // First, ensure admin has massive collateral
  // Need enough for: 1000 users * 0.01 token * $2500 = $25k on each side = $50k+ needed
  // Plus buffer for liquidity provision
  log("\n  Funding admin with collateral...", c.dim);
  const adminFunding = ethers.parseUnits("500000", 6); // $500k
  await mintable.connect(admin).mint(admin.address, adminFunding);
  await mockUSDC.connect(admin).approve(contracts.coreVault.target, ethers.MaxUint256);
  await coreVault.connect(admin).depositCollateral(adminFunding);
  logSuccess("Admin funded with $500k USDC collateral");

  // Seed initial liquidity so market orders work
  // Admin places both a buy and sell limit order to establish the spread
  // Need enough for 1000 users * 0.01 token = 10 tokens per side minimum
  log("  Seeding initial liquidity...", c.dim);
  const liquiditySize = ethers.parseUnits("50", 18); // 50 tokens per side (way more than needed)
  await obPlacement.connect(admin).placeMarginLimitOrder(
    CONFIG.ENTRY_PRICE - ethers.parseUnits("1", 6), // Bid at $2499
    liquiditySize,
    true // Buy
  );
  await obPlacement.connect(admin).placeMarginLimitOrder(
    CONFIG.ENTRY_PRICE + ethers.parseUnits("1", 6), // Ask at $2501
    liquiditySize,
    false // Sell
  );
  logSuccess("Initial liquidity seeded (bid/ask spread established)");

  // Create positions: users place market orders against admin's liquidity
  // Then place multiple resting orders per user
  const ordersPerUser = CONFIG.ORDERS_PER_USER || 5;
  
  for (let i = 1; i <= usersToSetup; i++) {
    const user = signers[i];
    
    try {
      // Check if user already has a position
      let hasPosition = false;
      try {
        const [size] = await coreVault.getPositionSummary(user.address, marketId);
        hasPosition = size !== 0n;
      } catch (e) {}

      if (hasPosition) {
        createdPositions++;
        progress(i, usersToSetup, `User ${i}: already has position`);
        continue;
      }

      // Fund user with USDC - need enough for position + multiple orders
      const userFunding = CONFIG.MARGIN_AMOUNT * BigInt(ordersPerUser + 3);
      await mintable.connect(admin).mint(user.address, userFunding);
      await mockUSDC.connect(user).approve(contracts.coreVault.target, ethers.MaxUint256);
      
      // Deposit collateral
      await coreVault.connect(user).depositCollateral(userFunding);

      // Alternate between long and short
      const isBuy = i % 2 === 0;
      
      // User places market order against admin's liquidity to get a position
      await obPlacement.connect(user).placeMarginMarketOrder(
        CONFIG.POSITION_SIZE,
        isBuy
      );
      createdPositions++;
      
      // Place multiple resting limit orders (won't match - outside the spread)
      for (let j = 0; j < ordersPerUser; j++) {
        // Spread orders across different price levels
        const priceOffset = ethers.parseUnits(String(100 + j * 50), 6); // $100, $150, $200, etc.
        const restingPrice = isBuy 
          ? CONFIG.ENTRY_PRICE - priceOffset // Bids below: $2400, $2350, $2300...
          : CONFIG.ENTRY_PRICE + priceOffset; // Asks above: $2600, $2650, $2700...

        await obPlacement.connect(user).placeMarginLimitOrder(
          restingPrice,
          CONFIG.POSITION_SIZE,
          isBuy
        );
        createdOrders++;
      }

      // Log progress every 10 users
      if (i % 10 === 0 || i === usersToSetup) {
        progress(i, usersToSetup, `${i}/${usersToSetup} users (${createdPositions} pos, ${createdOrders} orders)`);
      }
      
    } catch (e) {
      // Log full error on first few failures
      if (createdPositions < 5) {
        console.log(`\n  DEBUG User ${i} error:`, e.message?.substring(0, 300));
      }
      progress(i, usersToSetup, `User ${i}: error`);
    }
  }
  
  console.log(); // New line after progress
  logSuccess(`Created ${createdPositions} positions`);
  logSuccess(`Created ${createdOrders} resting orders`);

  // Step 3: Backfill marketPositionUsers
  log("\n  [3/4] Backfilling position tracking...", c.bright);
  
  const usersToBackfill = [];
  for (let i = 1; i <= usersToSetup; i++) {
    const user = signers[i];
    try {
      const [size] = await coreVault.getPositionSummary(user.address, marketId);
      if (size !== 0n) {
        usersToBackfill.push(user.address);
      }
    } catch (e) {}
  }

  if (usersToBackfill.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < usersToBackfill.length; i += BATCH) {
      const batch = usersToBackfill.slice(i, i + BATCH);
      try {
        await coreVault.connect(admin).backfillMarketPositionUsers(marketId, batch);
      } catch (e) {
        logWarn(`Backfill batch failed: ${e.message?.substring(0, 50)}`);
      }
      progress(Math.min(i + BATCH, usersToBackfill.length), usersToBackfill.length, "Backfilling");
    }
    console.log();
  }
  
  const trackedCount = await coreVault.getMarketPositionUserCount(marketId);
  logSuccess(`Now tracking ${trackedCount} users with positions`);

  // Step 4: Attempt regular settlement
  log("\n  [4/4] Attempting regular settlement...", c.bright);
  logInfo(`Gas limit: ${(CONFIG.REGULAR_SETTLEMENT_GAS / 1_000_000).toFixed(0)}M (Hyperliquid block limit)`);
  
  let regularFailed = false;
  let errorReason = "";
  
  try {
    // Estimate gas first
    logInfo("Estimating gas...");
    let estimatedGas;
    try {
      estimatedGas = await contracts.obSettlement.settleMarket.estimateGas(CONFIG.FINAL_PRICE);
      logInfo(`Estimated gas: ${estimatedGas.toLocaleString()}`);
      
      if (estimatedGas > BigInt(CONFIG.REGULAR_SETTLEMENT_GAS)) {
        logWarn(`Estimated gas EXCEEDS ${CONFIG.REGULAR_SETTLEMENT_GAS / 1_000_000}M limit!`);
        regularFailed = true;
        errorReason = `Gas estimate (${estimatedGas.toLocaleString()}) exceeds block limit`;
      }
    } catch (e) {
      logWarn(`Gas estimation failed: ${e.message?.substring(0, 60)}`);
      regularFailed = true;
      errorReason = "Gas estimation failed (likely exceeds limit)";
    }

    if (!regularFailed) {
      // Try actual settlement
      logInfo("Sending settlement transaction...");
      const tx = await contracts.obSettlement.settleMarket(CONFIG.FINAL_PRICE, {
        gasLimit: CONFIG.REGULAR_SETTLEMENT_GAS
      });
      await tx.wait();
      logSuccess("Regular settlement SUCCEEDED!");
    }
    
  } catch (e) {
    regularFailed = true;
    errorReason = e.message?.substring(0, 80) || "Unknown error";
  }

  // Summary
  banner("PHASE 1 COMPLETE", regularFailed ? c.yellow : c.green);
  
  log(`\n  Market State:`, c.bright);
  logInfo(`Positions: ${trackedCount}`);
  logInfo(`Resting orders: ${createdOrders}`);
  logInfo(`Settlement price: $${ethers.formatUnits(CONFIG.FINAL_PRICE, 6)}`);
  
  if (regularFailed) {
    log(`\n  ${c.bgRed}${c.bright} REGULAR SETTLEMENT FAILED ${c.reset}`, c.red);
    logError(errorReason);
    log(`\n  ${c.yellow}This market requires BATCH SETTLEMENT${c.reset}`);
    log(`  ${c.dim}Run Phase 2 to settle using the batch pipeline${c.reset}\n`);
  } else {
    log(`\n  ${c.bgGreen}${c.bright} SETTLEMENT COMPLETE ${c.reset}`, c.green);
    log(`  ${c.dim}Market was small enough for regular settlement${c.reset}\n`);
  }

  return regularFailed;
}

// ============ Phase 2: SETTLE ============

async function phaseSettle() {
  banner("PHASE 2: BATCH SETTLEMENT", c.magenta);
  
  log(`\n  This phase will:`, c.dim);
  log(`  • Cancel all resting orders in batches`, c.dim);
  log(`  • Calculate settlement totals in batches`, c.dim);
  log(`  • Apply settlements to each user in batches`, c.dim);
  log(`  • Complete the market settlement\n`, c.dim);
  
  const answer = await ask(`${c.magenta}  Press ENTER to start Phase 2: ${c.reset}`);
  
  const { obBatchSettlement, obSettlement, marketId } = contracts;
  const startTime = Date.now();
  let totalGas = 0n;
  let txCount = 0;

  // Check if already settled
  const isSettled = await obSettlement.isSettled();
  if (isSettled) {
    logSuccess("Market is already settled!");
    return;
  }

  // Phase 0: Initialize
  log("\n  [0/5] Initializing batch settlement...", c.bright);
  let tx = await obBatchSettlement.initBatchSettlement(CONFIG.FINAL_PRICE);
  let receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  logSuccess(`Initialized (gas: ${receipt.gasUsed.toLocaleString()})`);

  // Phase 1a: Cancel buy orders
  log("\n  [1/5] Cancelling buy orders...", c.bright);
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
  log("\n  [2/5] Cancelling sell orders...", c.bright);
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
  log("\n  [3/5] Calculating settlement totals...", c.bright);
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
    progress(Number(cursor), Number(total), `Batch ${batchNum}: processed ${cursor}/${total}`);
  }
  console.log();
  logSuccess(`Calculation complete in ${batchNum} batches`);

  // Phase 3: Finalize haircut
  log("\n  [4/5] Finalizing haircut...", c.bright);
  tx = await obBatchSettlement.finalizeVaultHaircut();
  receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  logSuccess(`Haircut finalized (gas: ${receipt.gasUsed.toLocaleString()})`);

  // Phase 4: Apply settlements
  log("\n  [5/5] Applying settlements...", c.bright);
  complete = false;
  batchNum = 0;
  while (!complete) {
    complete = await obBatchSettlement.runVaultBatchApplication.staticCall(CONFIG.APPLY_BATCH_SIZE);
    tx = await obBatchSettlement.runVaultBatchApplication(CONFIG.APPLY_BATCH_SIZE);
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    txCount++;
    batchNum++;
    
    const [, , , cursor2, total2] = await obBatchSettlement.getSettlementProgress();
    progress(Number(cursor2), Number(total2), `Batch ${batchNum}: settled ${cursor2}/${total2}`);
  }
  console.log();
  logSuccess(`Settlements applied in ${batchNum} batches`);

  // Complete
  log("\n  Completing settlement...", c.bright);
  tx = await obBatchSettlement.completeSettlement();
  receipt = await tx.wait();
  totalGas += receipt.gasUsed;
  txCount++;
  logSuccess("Settlement finalized!");

  // Verify
  const finalSettled = await obSettlement.isSettled();
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  banner("BATCH SETTLEMENT COMPLETE", c.green);
  
  log(`\n  ${c.bgGreen}${c.bright} SUCCESS ${c.reset}\n`);
  logInfo(`Market settled: ${finalSettled ? "YES ✓" : "NO ✗"}`);
  logInfo(`Total transactions: ${txCount}`);
  logInfo(`Total gas used: ${totalGas.toLocaleString()}`);
  logInfo(`Duration: ${duration} seconds`);
  console.log();
}

// ============ Main ============

async function main() {
  banner("BATCH SETTLEMENT & MARKET TOOL", c.cyan);
  
  const networkName = process.env.HARDHAT_NETWORK || "localhost";
  logInfo(`Network: ${networkName}`);
  
  // Initialize Supabase
  supabase = initSupabase();
  if (supabase) {
    logSuccess("Supabase connected");
  } else {
    logWarn("Supabase not configured (LIST MARKETS unavailable)");
  }
  
  signers = await ethers.getSigners();
  logInfo(`Signer: ${signers[0].address}`);

  // Main menu
  log("\n  Select operation:", c.bright);
  log("    1. LIST MARKETS  - View all markets from Supabase + check V2");
  log("    2. LOAD TEST     - Create positions & test regular settlement (localhost)");
  log("    3. BATCH SETTLE  - Run batch settlement");
  log("    4. FULL TEST     - Load + Batch settle (localhost)\n");
  
  const choice = await ask(`${c.cyan}  Enter choice (1/2/3/4): ${c.reset}`);

  if (choice === "1") {
    await phaseListMarkets();
    rl.close();
    return;
  }

  // For options 2-4, we need localhost deployment
  if (networkName !== "localhost" && (choice === "2" || choice === "4")) {
    logError("LOAD TEST requires localhost network");
    logInfo("Use: npx hardhat run scripts/test-batch-settlement.js --network localhost");
    rl.close();
    return;
  }

  // Load deployment for test operations
  try {
    deployment = await loadDeployment();
  } catch (e) {
    logError("localhost-deployment.json not found");
    logInfo("Run: npx hardhat run scripts/deploy.js --network localhost");
    rl.close();
    return;
  }
  
  const admin = signers[0];
  const diamond = deployment.contracts.ALUMINUM_ORDERBOOK;
  const marketId = deployment.contracts.ALUMINUM_MARKET_ID;
  
  logInfo(`Diamond: ${diamond}`);
  logInfo(`Market: ${marketId.substring(0, 18)}...`);
  logInfo(`Test users: ${CONFIG.NUM_USERS}`);

  // Load contracts
  contracts = {
    mockUSDC: await ethers.getContractAt("IERC20", deployment.contracts.MOCK_USDC),
    coreVault: await ethers.getContractAt("CoreVault", deployment.contracts.CORE_VAULT),
    obPlacement: await ethers.getContractAt("OBOrderPlacementFacet", diamond),
    obSettlement: await ethers.getContractAt("OBSettlementFacet", diamond),
    marketId,
  };

  // Check if batch settlement facet exists
  try {
    contracts.obBatchSettlement = await ethers.getContractAt("OBBatchSettlementFacet", diamond);
    await contracts.obBatchSettlement.getSettlementProgress();
    logSuccess("OBBatchSettlementFacet is available");
  } catch (e) {
    logError("OBBatchSettlementFacet not found!");
    logInfo("Re-deploy: npx hardhat run scripts/deploy.js --network localhost");
    rl.close();
    return;
  }

  if (choice === "2" || choice === "4") {
    const needsBatch = await phaseLoad();
    
    if (choice === "4" && needsBatch) {
      await phaseSettle();
    }
  } else if (choice === "3") {
    await phaseSettle();
  }

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
