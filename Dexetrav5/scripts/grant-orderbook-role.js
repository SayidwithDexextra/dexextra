const { ethers } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "../.env.local" });

const CORE_VAULT_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function ORDERBOOK_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

const LIQUIDATION_MANAGER_ABI = [
  "function marketToOrderBook(bytes32 marketId) view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using signer:", signer.address);

  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  const liquidationManagerAddress = process.env.LIQUIDATION_MANAGER_ADDRESS;
  
  if (!coreVaultAddress) {
    throw new Error("CORE_VAULT_ADDRESS not set");
  }
  if (!liquidationManagerAddress) {
    throw new Error("LIQUIDATION_MANAGER_ADDRESS not set");
  }

  console.log("\nAddresses:");
  console.log("  CoreVault:", coreVaultAddress);
  console.log("  LiquidationManager:", liquidationManagerAddress);

  const coreVault = new ethers.Contract(coreVaultAddress, CORE_VAULT_ABI, signer);
  const liquidationManager = new ethers.Contract(liquidationManagerAddress, LIQUIDATION_MANAGER_ABI, signer);

  // Get ORDERBOOK_ROLE
  const ORDERBOOK_ROLE = await coreVault.ORDERBOOK_ROLE();
  console.log("\nORDERBOOK_ROLE:", ORDERBOOK_ROLE);

  // Check if we have admin role
  const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  console.log("Signer has DEFAULT_ADMIN_ROLE:", hasAdmin);
  
  if (!hasAdmin) {
    console.error("\n❌ Signer does not have DEFAULT_ADMIN_ROLE on CoreVault");
    console.log("   You need to use an admin account to grant roles.");
    process.exit(1);
  }

  // Query Supabase for markets
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.log("\nNo Supabase credentials, using deployment file markets...");
    // Fallback to known markets from deployment
    const deployment = require("../deployments/hyperliquid-deployment.json");
    await processMarkets(deployment.markets, coreVault, liquidationManager, ORDERBOOK_ROLE);
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log("\n📡 Fetching markets from Supabase...");
  const { data: markets, error } = await supabase
    .from("markets")
    .select("id, symbol, market_id_bytes32, market_address")
    .limit(100);

  if (error) {
    console.error("Supabase error:", error.message);
    console.log("\nFalling back to deployment file...");
    const deployment = require("../deployments/hyperliquid-deployment.json");
    await processMarkets(deployment.markets, coreVault, liquidationManager, ORDERBOOK_ROLE);
    return;
  }

  console.log(`Found ${markets.length} markets in Supabase`);

  // Find the market that starts with 0x385f306b03d7
  const targetPrefix = "385f306b03d7";
  const targetMarket = markets.find(m => {
    const hex = (m.market_id_bytes32 || "").toLowerCase().replace("0x", "");
    return hex.startsWith(targetPrefix);
  });

  if (targetMarket) {
    console.log("\n🎯 Found target market:");
    console.log("  Symbol:", targetMarket.symbol);
    console.log("  Market ID:", targetMarket.market_id_bytes32);
    console.log("  Order Book:", targetMarket.market_address);
    
    const orderBookAddress = targetMarket.market_address;
    if (orderBookAddress) {
      await grantRoleIfNeeded(coreVault, ORDERBOOK_ROLE, orderBookAddress, targetMarket.symbol);
    }
  } else {
    console.log("\n⚠️  Target market 0x385f306b03d7... not found in Supabase");
    console.log("   Checking all markets via LiquidationManager...");
  }

  // Also process all markets from Supabase
  const marketsToProcess = markets.map(m => ({
    symbol: m.symbol,
    marketId: m.market_id_bytes32,
    orderBook: m.market_address
  }));
  
  await processMarkets(marketsToProcess, coreVault, liquidationManager, ORDERBOOK_ROLE);
}

async function processMarkets(markets, coreVault, liquidationManager, ORDERBOOK_ROLE) {
  console.log("\n📋 Processing all markets...\n");
  
  let granted = 0;
  let alreadyHas = 0;
  let errors = 0;

  for (const market of markets) {
    if (!market.marketId || !market.orderBook) {
      continue;
    }

    const symbol = market.symbol || "Unknown";
    const orderBook = market.orderBook;
    
    // Verify order book via LiquidationManager
    let onchainOrderBook;
    try {
      onchainOrderBook = await liquidationManager.marketToOrderBook(market.marketId);
    } catch (e) {
      // Market might not be registered
    }

    const effectiveOrderBook = onchainOrderBook && onchainOrderBook !== ethers.ZeroAddress 
      ? onchainOrderBook 
      : orderBook;

    if (!effectiveOrderBook || effectiveOrderBook === ethers.ZeroAddress) {
      console.log(`⏭️  ${symbol}: No order book found`);
      continue;
    }

    const result = await grantRoleIfNeeded(coreVault, ORDERBOOK_ROLE, effectiveOrderBook, symbol);
    if (result === "granted") granted++;
    else if (result === "exists") alreadyHas++;
    else errors++;
  }

  console.log("\n═══════════════════════════════════════");
  console.log("Summary:");
  console.log(`  ✅ Granted: ${granted}`);
  console.log(`  ⏭️  Already has role: ${alreadyHas}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log("═══════════════════════════════════════");
}

async function grantRoleIfNeeded(coreVault, role, account, label) {
  try {
    const hasRole = await coreVault.hasRole(role, account);
    
    if (hasRole) {
      console.log(`⏭️  ${label}: ${account.slice(0, 10)}... already has ORDERBOOK_ROLE`);
      return "exists";
    }

    console.log(`🔑 ${label}: Granting ORDERBOOK_ROLE to ${account}...`);
    const tx = await coreVault.grantRole(role, account);
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✅ Granted!`);
    return "granted";
  } catch (e) {
    console.error(`❌ ${label}: Error - ${e.message?.slice(0, 80)}`);
    return "error";
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
