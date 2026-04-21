#!/usr/bin/env node
/**
 * Read Facet Registry - displays all facet addresses and their selectors
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

// Known selector mappings for better readability
const KNOWN_SELECTORS = {
  // Admin Facet
  "0x8456cb59": "pause()",
  "0x3f4ba83a": "unpause()",
  "0x5c975abb": "paused()",
  "0xf2fde38b": "transferOwnership(address)",
  "0x8da5cb5b": "owner()",
  
  // Order Placement
  "0x84a7f8d8": "placeOrder(...)",
  "0x514fcac7": "cancelOrder(...)",
  "0xbff782aa": "cancelAllOrders(...)",
  
  // Trade Execution
  "0x4a393149": "matchOrders(...)",
  "0x72ed9f78": "settleTrade(...)",
  
  // Liquidation
  "0x50be6571": "liquidatePosition(...)",
  "0xf5f5ba72": "checkLiquidatable(...)",
  
  // View Functions
  "0x9c56dfc2": "getOrder(...)",
  "0x7e36a2b3": "getOrders(...)",
  "0xe3204d5a": "getPosition(...)",
  "0x7f7e6f69": "getMarketInfo(...)",
  
  // Settlement
  "0x9e7f87b1": "settlePosition(...)",
  
  // Pricing
  "0x41976e09": "getPrice(...)",
  "0x5c08c8b4": "updatePrice(...)",
  
  // Market Lifecycle
  "0x21c0b342": "createMarket(...)",
  "0x7d64bcb4": "resolveMarket(...)",
  
  // Meta Trade
  "0x9b8dba38": "executeMetaTrade(...)",
  
  // Vault
  "0xb6b55f25": "deposit(uint256)",
  "0x2e1a7d4d": "withdraw(uint256)",
};

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                    FACET REGISTRY READER                       ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  const registryAddr = process.env.FACET_REGISTRY_ADDRESS;
  if (!registryAddr) {
    console.error("❌ FACET_REGISTRY_ADDRESS not set in .env.local");
    process.exit(1);
  }

  console.log("📋 Registry Address:", registryAddr);
  console.log("🔗 Network:", (await ethers.provider.getNetwork()).name || "unknown", `(chainId: ${(await ethers.provider.getNetwork()).chainId})`);
  console.log("");

  // Create contract instance with full ABI
  const registry = await ethers.getContractAt(
    [
      "function admin() view returns (address)",
      "function version() view returns (uint256)",
      "function selectorCount() view returns (uint256)",
      "function getAllSelectors() view returns (bytes4[])",
      "function selectorToFacet(bytes4) view returns (address)",
      "function getSelectorsForFacet(address) view returns (bytes4[])"
    ],
    registryAddr
  );

  // Get registry metadata
  const admin = await registry.admin();
  const version = await registry.version();
  const selectorCount = await registry.selectorCount();

  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ REGISTRY METADATA                                               │");
  console.log("├─────────────────────────────────────────────────────────────────┤");
  console.log(`│ Admin:          ${admin}`);
  console.log(`│ Version:        ${version}`);
  console.log(`│ Total Selectors: ${selectorCount}`);
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  // Get all selectors
  const selectors = await registry.getAllSelectors();
  
  // Group selectors by facet address
  const facetToSelectors = new Map();
  
  for (const selector of selectors) {
    const facetAddr = await registry.selectorToFacet(selector);
    
    if (facetAddr === ethers.ZeroAddress) {
      continue; // Skip removed selectors
    }
    
    if (!facetToSelectors.has(facetAddr)) {
      facetToSelectors.set(facetAddr, []);
    }
    facetToSelectors.get(facetAddr).push(selector);
  }

  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log(`│ FACET ADDRESSES (${facetToSelectors.size} unique facets)                           │`);
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  // Compare with known env addresses for naming
  const ENV_FACETS = {
    [process.env.OB_ADMIN_FACET?.toLowerCase()]: "OB_ADMIN_FACET",
    [process.env.OB_PRICING_FACET?.toLowerCase()]: "OB_PRICING_FACET", 
    [process.env.OB_ORDER_PLACEMENT_FACET?.toLowerCase()]: "OB_ORDER_PLACEMENT_FACET",
    [process.env.OB_TRADE_EXECUTION_FACET?.toLowerCase()]: "OB_TRADE_EXECUTION_FACET",
    [process.env.OB_LIQUIDATION_FACET?.toLowerCase()]: "OB_LIQUIDATION_FACET",
    [process.env.OB_VIEW_FACET?.toLowerCase()]: "OB_VIEW_FACET",
    [process.env.OB_SETTLEMENT_FACET?.toLowerCase()]: "OB_SETTLEMENT_FACET",
    [process.env.MARKET_LIFECYCLE_FACET?.toLowerCase()]: "MARKET_LIFECYCLE_FACET",
    [process.env.META_TRADE_FACET?.toLowerCase()]: "META_TRADE_FACET",
    [process.env.ORDERBOOK_VAULT_FACET?.toLowerCase()]: "ORDERBOOK_VAULT_FACET",
    [process.env.ORDER_BOOK_INIT_FACET?.toLowerCase()]: "ORDER_BOOK_INIT_FACET",
  };

  let facetIndex = 1;
  for (const [facetAddr, sels] of facetToSelectors) {
    const envName = ENV_FACETS[facetAddr.toLowerCase()];
    const displayName = envName ? `${envName}` : "UNKNOWN";
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`FACET #${facetIndex}: ${displayName}`);
    console.log(`Address: ${facetAddr}`);
    console.log(`Selectors (${sels.length}):`);
    
    for (const sel of sels) {
      const knownName = KNOWN_SELECTORS[sel.toLowerCase()] || "";
      console.log(`  ${sel} ${knownName ? `→ ${knownName}` : ""}`);
    }
    console.log("");
    facetIndex++;
  }

  // Summary table
  console.log("\n┌────────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ SUMMARY TABLE                                                                                  │");
  console.log("├────────────────────────────────────────────────────────────────────────────────────────────────┤");
  console.log("│ Facet Name                    │ Address                                    │ Selectors │");
  console.log("├────────────────────────────────────────────────────────────────────────────────────────────────┤");
  
  for (const [facetAddr, sels] of facetToSelectors) {
    const envName = ENV_FACETS[facetAddr.toLowerCase()] || "UNKNOWN";
    const name = envName.padEnd(29);
    const addr = facetAddr;
    const count = String(sels.length).padStart(9);
    console.log(`│ ${name} │ ${addr} │ ${count} │`);
  }
  
  console.log("└────────────────────────────────────────────────────────────────────────────────────────────────┘");

  // Check for mismatches with .env.local
  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│ .ENV.LOCAL COMPARISON                                           │");
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  const envChecks = [
    { name: "OB_ADMIN_FACET", addr: process.env.OB_ADMIN_FACET },
    { name: "OB_PRICING_FACET", addr: process.env.OB_PRICING_FACET },
    { name: "OB_ORDER_PLACEMENT_FACET", addr: process.env.OB_ORDER_PLACEMENT_FACET },
    { name: "OB_TRADE_EXECUTION_FACET", addr: process.env.OB_TRADE_EXECUTION_FACET },
    { name: "OB_LIQUIDATION_FACET", addr: process.env.OB_LIQUIDATION_FACET },
    { name: "OB_VIEW_FACET", addr: process.env.OB_VIEW_FACET },
    { name: "OB_SETTLEMENT_FACET", addr: process.env.OB_SETTLEMENT_FACET },
    { name: "MARKET_LIFECYCLE_FACET", addr: process.env.MARKET_LIFECYCLE_FACET },
    { name: "META_TRADE_FACET", addr: process.env.META_TRADE_FACET },
    { name: "ORDERBOOK_VAULT_FACET", addr: process.env.ORDERBOOK_VAULT_FACET },
    { name: "ORDER_BOOK_INIT_FACET", addr: process.env.ORDER_BOOK_INIT_FACET },
  ];

  for (const { name, addr } of envChecks) {
    if (!addr) {
      console.log(`⚠️  ${name.padEnd(28)} NOT SET in .env.local`);
      continue;
    }
    
    const isInRegistry = facetToSelectors.has(addr);
    const status = isInRegistry ? "✅" : "❌";
    console.log(`${status} ${name.padEnd(28)} ${addr} ${isInRegistry ? "(in registry)" : "(NOT IN REGISTRY)"}`);
  }

  console.log("\n✨ Done!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
