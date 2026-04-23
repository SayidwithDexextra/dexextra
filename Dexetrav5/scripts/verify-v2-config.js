#!/usr/bin/env node
/**
 * Verify V2 Configuration
 * Checks that factory and facet registry are properly configured for V2 markets.
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

async function main() {
  console.log(`\n${c.cyan}${"═".repeat(60)}${c.reset}`);
  console.log(`${c.bright}${c.cyan}  V2 CONFIGURATION VERIFICATION${c.reset}`);
  console.log(`${c.cyan}${"═".repeat(60)}${c.reset}\n`);

  const factoryAddr = process.env.FUTURES_MARKET_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
  const registryAddr = process.env.FACET_REGISTRY_ADDRESS;
  const initFacetEnv = process.env.ORDER_BOOK_INIT_FACET || process.env.NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;

  console.log(`${c.dim}  Factory: ${factoryAddr}${c.reset}`);
  console.log(`${c.dim}  FacetRegistry: ${registryAddr}${c.reset}`);
  console.log(`${c.dim}  InitFacet (env): ${initFacetEnv}${c.reset}\n`);

  let allOk = true;

  // Check Factory
  console.log(`${c.bright}  FACTORY CONFIG:${c.reset}`);
  const factory = await ethers.getContractAt([
    "function facetRegistry() view returns (address)",
    "function initFacetAddress() view returns (address)",
    "function admin() view returns (address)"
  ], factoryAddr);

  const [factoryReg, factoryInit, factoryAdmin] = await Promise.all([
    factory.facetRegistry().catch(() => ethers.ZeroAddress),
    factory.initFacetAddress().catch(() => ethers.ZeroAddress),
    factory.admin().catch(() => "unknown")
  ]);

  const regOk = factoryReg !== ethers.ZeroAddress;
  const initOk = factoryInit !== ethers.ZeroAddress;
  const regMatch = factoryReg.toLowerCase() === registryAddr?.toLowerCase();

  console.log(`    facetRegistry: ${factoryReg} ${regOk ? c.green + "✓" : c.red + "✗"}${c.reset}`);
  console.log(`    initFacetAddress: ${factoryInit} ${initOk ? c.green + "✓" : c.red + "✗"}${c.reset}`);
  console.log(`    admin: ${factoryAdmin}`);
  console.log(`    Registry matches env: ${regMatch ? c.green + "✓" : c.yellow + "⚠ mismatch"}${c.reset}`);

  if (!regOk || !initOk) allOk = false;

  // Check FacetRegistry
  console.log(`\n${c.bright}  FACET REGISTRY:${c.reset}`);
  const registry = await ethers.getContractAt([
    "function selectorCount() view returns (uint256)",
    "function getFacet(bytes4) view returns (address)",
    "function getAllSelectors() view returns (bytes4[])",
    "function admin() view returns (address)"
  ], registryAddr);

  const [selectorCount, regAdmin] = await Promise.all([
    registry.selectorCount(),
    registry.admin().catch(() => "unknown")
  ]);

  console.log(`    Registered selectors: ${selectorCount.toString()} ${Number(selectorCount) > 0 ? c.green + "✓" : c.red + "✗"}${c.reset}`);
  console.log(`    admin: ${regAdmin}`);

  // Get all registered selectors and group by facet
  console.log(`\n${c.bright}  REGISTERED FACETS:${c.reset}`);
  
  const allSelectors = await registry.getAllSelectors().catch(() => []);
  const facetMap = new Map();
  
  for (const sel of allSelectors) {
    const facet = await registry.getFacet(sel).catch(() => ethers.ZeroAddress);
    if (facet !== ethers.ZeroAddress) {
      if (!facetMap.has(facet)) facetMap.set(facet, []);
      facetMap.get(facet).push(sel);
    }
  }
  
  for (const [facet, sels] of facetMap.entries()) {
    console.log(`    ${facet}: ${sels.length} selectors`);
  }

  // Check key selectors (compute dynamically, don't hardcode!)
  console.log(`\n${c.bright}  KEY SELECTOR CHECK:${c.reset}`);
  const keyFunctions = [
    "settleMarket(uint256)",
    "isSettled()",
    "placeMarginLimitOrder(uint256,uint256,bool)",
    "placeMarginMarketOrder(uint256,bool)",
    "cancelOrder(uint256)",
    "initBatchSettlement(uint256)",
  ];

  let missingCount = 0;
  for (const fn of keyFunctions) {
    const sel = ethers.id(fn).substring(0, 10);
    const facet = await registry.getFacet(sel).catch(() => ethers.ZeroAddress);
    const ok = facet !== ethers.ZeroAddress;
    if (!ok) missingCount++;
    console.log(`    ${ok ? c.green + "✓" : c.red + "✗"} ${fn.padEnd(45)} ${sel} -> ${ok ? facet.substring(0,10) + "..." : "MISSING"}${c.reset}`);
  }
  
  if (missingCount > 0) {
    console.log(`\n${c.yellow}  ⚠ ${missingCount} key selectors missing from FacetRegistry!${c.reset}`);
    console.log(`${c.dim}    V2 markets won't work until all selectors are registered.${c.reset}`);
    allOk = false;
  }

  // Summary
  console.log(`\n${c.cyan}${"═".repeat(60)}${c.reset}`);
  if (allOk && Number(selectorCount) > 0) {
    console.log(`${c.bright}${c.green}  ✓ V2 CONFIGURATION COMPLETE${c.reset}`);
    console.log(`${c.dim}  All new markets will use DiamondRegistry${c.reset}`);
  } else {
    console.log(`${c.bright}${c.red}  ✗ V2 CONFIGURATION INCOMPLETE${c.reset}`);
    if (!regOk) console.log(`${c.red}    - Factory missing facetRegistry${c.reset}`);
    if (!initOk) console.log(`${c.red}    - Factory missing initFacetAddress${c.reset}`);
  }
  console.log(`${c.cyan}${"═".repeat(60)}${c.reset}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
