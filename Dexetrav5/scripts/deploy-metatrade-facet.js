#!/usr/bin/env node

/**
 * deploy-metatrade-facet.js
 *
 * Deploys MetaTradeFacet and records the address in deployments/<network>-deployment.json.
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid npx hardhat run Dexetrav5/scripts/deploy-metatrade-facet.js --network hyperliquid
 *
 * After deploy, upgrade an OrderBook diamond to use this facet with:
 *   HARDHAT_NETWORK=hyperliquid META_TRADE_FACET=<address> ORDERBOOK=0x... \ 
 *   npx hardhat run Dexetrav5/scripts/upgrade-gasless-facets.js --network hyperliquid
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

function extractError(error) {
  try {
    return (
      error?.shortMessage ||
      error?.reason ||
      error?.error?.message ||
      (typeof error?.data === "string" ? error.data : undefined) ||
      error?.message ||
      String(error)
    );
  } catch (_) {
    return String(error);
  }
}

async function main() {
  console.log("\n🚀 Deploy MetaTradeFacet");
  console.log("═".repeat(80));

  // Network detection (mirrors deploy-lifecycle-facet.js)
  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  const normalizedName = (() => {
    const n = String(rawNetworkName || "").toLowerCase();
    if (
      n === "hyperliquid_mainnet" ||
      n === "hyperliquid-mainnet" ||
      n === "hl" ||
      n === "hl_mainnet" ||
      n === "hl-mainnet" ||
      n === "hyperliquid"
    )
      return "hyperliquid";
    if (n === "hyperliquid-testnet" || n === "hl_testnet" || n === "hl-testnet")
      return "hyperliquid_testnet";
    return n;
  })();
  let effectiveNetworkName = normalizedName;
  if (
    (effectiveNetworkName === "hardhat" || effectiveNetworkName === "unknown") &&
    Number(network.chainId) === 31337
  ) {
    effectiveNetworkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    effectiveNetworkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    effectiveNetworkName = "hyperliquid_testnet";
  }
  console.log(`🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`);

  // Deploy facet
  let deployer;
  try {
    [deployer] = await ethers.getSigners();
    console.log("👤 Deployer:", await deployer.getAddress());
  } catch (_) {}
  console.log("\n⛏️  Deploying MetaTradeFacet...");
  const FacetFactory = await ethers.getContractFactory("MetaTradeFacet");
  const facet = await FacetFactory.deploy();
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  console.log("✅ Deployed MetaTradeFacet at:", facetAddress);

  // Update deployments file
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}
  deployment.network = effectiveNetworkName;
  deployment.chainId = Number(network.chainId);
  deployment.timestamp = new Date().toISOString();
  deployment.contracts = deployment.contracts || {};
  deployment.contracts.META_TRADE_FACET = facetAddress;
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("📝 Recorded facet in deployment file.");

  // Post-deploy guidance
  console.log("\n➡️  Next steps:");
  console.log(
    "   Upgrade a specific OrderBook diamond to use this facet with:"
  );
  console.log(
    `   HARDHAT_NETWORK=${effectiveNetworkName} META_TRADE_FACET=${facetAddress} ORDERBOOK=<orderbook_address> \\`
  );
  console.log(
    `   npx hardhat run Dexetrav5/scripts/upgrade-gasless-facets.js --network ${effectiveNetworkName}`
  );
  console.log("\nOr in batch mode (all active markets discovered via Supabase), set:");
  console.log(
    `   HARDHAT_NETWORK=${effectiveNetworkName} META_TRADE_FACET=${facetAddress} OB_ORDER_PLACEMENT_FACET=<existing_ob_placement_facet>`
  );
  console.log(
    `   npx hardhat run Dexetrav5/scripts/upgrade-gasless-facets.js --network ${effectiveNetworkName}`
  );
  console.log("\n✅ Done.\n");

  // Print a final machine-readable line for scripting
  console.log(
    JSON.stringify(
      {
        network: effectiveNetworkName,
        chainId: Number(network.chainId),
        MetaTradeFacet: facetAddress,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ deploy-metatrade-facet failed:", extractError(e));
    process.exit(1);
  });




