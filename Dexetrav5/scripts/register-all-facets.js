#!/usr/bin/env node
/**
 * Register All Facets to FacetRegistry
 * 
 * Registers all function selectors from all facets to the central FacetRegistry.
 * This is required for V2 markets (DiamondRegistry) to work.
 * 
 * Usage:
 *   npx hardhat run scripts/register-all-facets.js --network hyperliquid
 */

const path = require("path");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}

const { ethers } = require("hardhat");

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
};

function getSelectors(contract) {
  const selectors = [];
  for (const fragment of contract.interface.fragments) {
    if (fragment.type === "function") {
      selectors.push(contract.interface.getFunction(fragment.name).selector);
    }
  }
  return selectors;
}

async function main() {
  console.log(`\n${c.cyan}${"═".repeat(60)}${c.reset}`);
  console.log(`${c.bright}${c.cyan}  REGISTER ALL FACETS TO FACET REGISTRY${c.reset}`);
  console.log(`${c.cyan}${"═".repeat(60)}${c.reset}\n`);

  const registryAddr = process.env.FACET_REGISTRY_ADDRESS;
  if (!registryAddr) {
    console.log(`${c.red}  FACET_REGISTRY_ADDRESS not set${c.reset}`);
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  console.log(`${c.dim}  Registry: ${registryAddr}${c.reset}`);
  console.log(`${c.dim}  Signer: ${signer.address}${c.reset}\n`);

  // Get facet addresses from env
  const facets = {
    "OBAdminFacet": process.env.OB_ADMIN_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_FACET,
    "OBPricingFacet": process.env.OB_PRICING_FACET || process.env.NEXT_PUBLIC_OB_PRICING_FACET,
    "OBOrderPlacementFacet": process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET,
    "OBTradeExecutionFacet": process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET,
    "OBLiquidationFacet": process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET,
    "OBViewFacet": process.env.OB_VIEW_FACET || process.env.NEXT_PUBLIC_OB_VIEW_FACET,
    "OBSettlementFacet": process.env.OB_SETTLEMENT_FACET || process.env.NEXT_PUBLIC_OB_SETTLEMENT_FACET,
    "MarketLifecycleFacet": process.env.MARKET_LIFECYCLE_FACET || process.env.NEXT_PUBLIC_MARKET_LIFECYCLE_FACET,
    "MetaTradeFacet": process.env.META_TRADE_FACET || process.env.NEXT_PUBLIC_META_TRADE_FACET,
    "OrderBookVaultAdminFacet": process.env.ORDERBOOK_VAULT_FACET || process.env.NEXT_PUBLIC_ORDERBOOK_VAULT_FACET || process.env.ORDERBOOK_VALUT_FACET,
  };

  // Check which facets are configured
  console.log(`${c.bright}  FACET ADDRESSES:${c.reset}`);
  const validFacets = [];
  for (const [name, addr] of Object.entries(facets)) {
    if (addr && ethers.isAddress(addr)) {
      console.log(`    ${c.green}✓${c.reset} ${name}: ${addr}`);
      validFacets.push({ name, addr });
    } else {
      console.log(`    ${c.yellow}⚠${c.reset} ${name}: not configured`);
    }
  }

  if (validFacets.length === 0) {
    console.log(`\n${c.red}  No facets configured in .env.local${c.reset}`);
    process.exit(1);
  }

  // Get registry
  const registry = await ethers.getContractAt("FacetRegistry", registryAddr);
  
  // Check admin
  const admin = await registry.admin();
  if (admin.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`\n${c.yellow}  WARNING: Signer is not registry admin${c.reset}`);
    console.log(`${c.dim}    Admin: ${admin}${c.reset}`);
    console.log(`${c.dim}    Signer: ${signer.address}${c.reset}`);
  }

  // Collect all selectors and check which are missing
  console.log(`\n${c.bright}  ANALYZING SELECTORS:${c.reset}`);
  
  const allSelectors = [];
  const missingSelectors = [];

  for (const { name, addr } of validFacets) {
    try {
      const facet = await ethers.getContractAt(name, addr);
      const selectors = getSelectors(facet);
      
      let missing = 0;
      for (const sel of selectors) {
        const registered = await registry.getFacet(sel).catch(() => ethers.ZeroAddress);
        if (registered === ethers.ZeroAddress) {
          missing++;
          missingSelectors.push({ selector: sel, facet: addr, name });
        }
        allSelectors.push({ selector: sel, facet: addr, name });
      }
      
      console.log(`    ${name}: ${selectors.length} selectors (${missing} missing)`);
    } catch (e) {
      console.log(`    ${c.red}${name}: error - ${e.message?.substring(0, 50)}${c.reset}`);
    }
  }

  console.log(`\n  Total selectors: ${allSelectors.length}`);
  console.log(`  Missing selectors: ${missingSelectors.length}`);

  if (missingSelectors.length === 0) {
    console.log(`\n${c.green}  ✓ All selectors already registered!${c.reset}`);
    process.exit(0);
  }

  // Group missing selectors by facet for batch registration
  const byFacet = new Map();
  for (const { selector, facet, name } of missingSelectors) {
    if (!byFacet.has(facet)) byFacet.set(facet, { name, selectors: [] });
    byFacet.get(facet).selectors.push(selector);
  }

  // Register missing selectors
  console.log(`\n${c.bright}  REGISTERING MISSING SELECTORS:${c.reset}`);

  for (const [facetAddr, { name, selectors }] of byFacet.entries()) {
    console.log(`\n    ${name} (${facetAddr.substring(0, 10)}...)`);
    console.log(`    ${c.dim}${selectors.length} selectors to register${c.reset}`);

    try {
      const tx = await registry.registerFacet(facetAddr, selectors);
      console.log(`    ${c.dim}TX: ${tx.hash}${c.reset}`);
      const receipt = await tx.wait();
      console.log(`    ${c.green}✓ Registered (block ${receipt.blockNumber})${c.reset}`);
    } catch (e) {
      console.log(`    ${c.red}✗ Failed: ${e.message?.substring(0, 80)}${c.reset}`);
    }
  }

  // Verify
  console.log(`\n${c.bright}  VERIFICATION:${c.reset}`);
  const newCount = await registry.selectorCount();
  console.log(`  Total selectors now: ${newCount.toString()}`);

  // Check key selectors
  const keyChecks = [
    ["settleMarket", "0x6c9c1d9a"],
    ["isSettled", "0x61bc221a"],
    ["placeMarginLimitOrder", "0x5de0398e"],
  ];

  let allOk = true;
  for (const [name, sel] of keyChecks) {
    const facet = await registry.getFacet(sel).catch(() => ethers.ZeroAddress);
    const ok = facet !== ethers.ZeroAddress;
    if (!ok) allOk = false;
    console.log(`  ${ok ? c.green + "✓" : c.red + "✗"} ${name}: ${ok ? facet.substring(0, 15) + "..." : "MISSING"}${c.reset}`);
  }

  console.log(`\n${c.cyan}${"═".repeat(60)}${c.reset}`);
  if (allOk) {
    console.log(`${c.bright}${c.green}  ✓ ALL FACETS REGISTERED${c.reset}`);
  } else {
    console.log(`${c.bright}${c.red}  ✗ SOME SELECTORS STILL MISSING${c.reset}`);
  }
  console.log(`${c.cyan}${"═".repeat(60)}${c.reset}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
