#!/usr/bin/env node

/**
 * deploy-lifecycle-facet.js
 *
 * Deploys MarketLifecycleFacet and records the address in deployments/<network>-deployment.json.
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid npx hardhat run Dexetrav5/scripts/deploy-lifecycle-facet.js --network hyperliquid
 *
 * After deploy, apply the facet to a specific market Diamond with:
 *   HARDHAT_NETWORK=hyperliquid MARKET_LIFECYCLE_FACET=<address> \
 *   npx hardhat run Dexetrav5/scripts/add-lifecycle-facet-interactive.js --network hyperliquid
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
  console.log("\n🚀 Deploy MarketLifecycleFacet");
  console.log("═".repeat(80));

  // Network detection (consistent with other scripts)
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
  console.log("\n⛏️  Deploying MarketLifecycleFacet...");
  const FacetFactory = await ethers.getContractFactory("MarketLifecycleFacet");
  const facet = await FacetFactory.deploy();
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  console.log("✅ Deployed MarketLifecycleFacet at:", facetAddress);

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
  deployment.contracts.MARKET_LIFECYCLE_FACET = facetAddress;
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("📝 Recorded facet in deployment file.");

  // Post-deploy guidance
  console.log("\n➡️  Next steps:");
  console.log(
    "   Apply facet selectors to a market Diamond interactively with:"
  );
  console.log(
    `   HARDHAT_NETWORK=${effectiveNetworkName} MARKET_LIFECYCLE_FACET=${facetAddress} \\`
  );
  console.log(
    `   npx hardhat run Dexetrav5/scripts/add-lifecycle-facet-interactive.js --network ${effectiveNetworkName}`
  );
  console.log("\n✅ Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ deploy-lifecycle-facet failed:", extractError(e));
    process.exit(1);
  });












