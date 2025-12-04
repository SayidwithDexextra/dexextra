#!/usr/bin/env node

/**
 * upgrade-lifecycle-facet.js
 *
 * Replaces existing MarketLifecycleFacet selectors on a target Diamond (OrderBook)
 * with a new facet implementation, using FacetCutAction.Replace for a safe, in-place upgrade.
 *
 * Address resolution:
 * - ORDERBOOK env (preferred)
 * - deployments/<network>-deployment.json defaultMarket.orderBook
 * - deployments.<markets[0]>.orderBook
 *
 * Facet address resolution:
 * - MARKET_LIFECYCLE_FACET env (preferred)
 * - deployments/<network>-deployment.json contracts.MARKET_LIFECYCLE_FACET
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid ORDERBOOK=0x... npx hardhat run Dexetrav5/scripts/upgrade-lifecycle-facet.js --network hyperliquid
 *   or
 *   HARDHAT_NETWORK=hyperliquid npx hardhat run Dexetrav5/scripts/upgrade-lifecycle-facet.js --network hyperliquid
 *   (will pick defaultMarket from deployments)
 */

const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

function readDeployment(networkName) {
  const p = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return null;
}

async function getLifecycleSelectors() {
  const artifact = await artifacts.readArtifact("MarketLifecycleFacet");
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  return fns.map((f) => {
    const sig = `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    return ethers.id(sig).slice(0, 10);
  });
}

async function main() {
  const network = await ethers.provider.getNetwork();
  let networkName = process.env.HARDHAT_NETWORK || "unknown";
  if ((networkName === "hardhat" || networkName === "unknown") && Number(network.chainId) === 31337) {
    networkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    networkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    networkName = "hyperliquid_testnet";
  }
  console.log(`\n🔧 Upgrade Lifecycle Facet on ${networkName} (chainId=${network.chainId})`);

  const deployment = readDeployment(networkName) || {};
  // Resolve ORDERBOOK target
  let orderBook = process.env.ORDERBOOK || "";
  if (!orderBook) {
    orderBook = deployment?.defaultMarket?.orderBook || "";
  }
  if (!orderBook && Array.isArray(deployment.markets) && deployment.markets.length > 0) {
    orderBook = deployment.markets[0]?.orderBook || "";
  }
  if (!orderBook || !/^0x[a-fA-F0-9]{40}$/.test(orderBook)) {
    throw new Error("ORDERBOOK not provided and could not resolve from deployments file.");
  }
  console.log("🎯 Target Diamond (OrderBook):", orderBook);

  // Resolve facet address
  let facetAddress = process.env.MARKET_LIFECYCLE_FACET || "";
  if (!facetAddress) {
    facetAddress = deployment?.contracts?.MARKET_LIFECYCLE_FACET || "";
  }
  if (!facetAddress || !/^0x[a-fA-F0-9]{40}$/.test(facetAddress)) {
    throw new Error("MARKET_LIFECYCLE_FACET not provided and not found in deployments.");
  }
  console.log("🧩 New MarketLifecycleFacet:", facetAddress);

  // Build replace cut
  const selectors = await getLifecycleSelectors();
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw new Error("No selectors built for MarketLifecycleFacet");
  }

  // Determine which selectors exist on target; Replace existing, Add missing
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook
  );
  const addSelectors = [];
  const replaceSelectors = [];
  for (const sel of selectors) {
    try {
      const addr = await loupe.facetAddress(sel);
      if (addr && addr !== ethers.ZeroAddress) replaceSelectors.push(sel);
      else addSelectors.push(sel);
    } catch {
      addSelectors.push(sel);
    }
  }

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];
  if (replaceSelectors.length) {
    cut.push({
      facetAddress,
      action: FacetCutAction.Replace,
      functionSelectors: replaceSelectors,
    });
  }
  if (addSelectors.length) {
    cut.push({
      facetAddress,
      action: FacetCutAction.Add,
      functionSelectors: addSelectors,
    });
  }
  if (!cut.length) {
    console.log("ℹ️  No selectors to replace or add (already up to date).");
    return;
  }

  // diamondCut Replace
  console.log("⏳ Replacing lifecycle selectors via diamondCut...");
  const diamond = await ethers.getContractAt("IDiamondCut", orderBook);
  const tx = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log("   tx:", tx.hash);
  const rc = await tx.wait();
  console.log(`✅ Upgrade complete. Block: ${rc.blockNumber} Gas: ${rc.gasUsed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ upgrade-lifecycle-facet failed:", e?.message || String(e));
    process.exit(1);
  });


