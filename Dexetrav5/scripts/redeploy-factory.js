#!/usr/bin/env node

// Minimal FuturesMarketFactory redeploy to target a NEW CoreVault
//
// What this script does:
// - Reads the latest CORE_VAULT from deployments/<network>-deployment.json
// - Redeploys ONLY FuturesMarketFactory pointing to the new CoreVault
// - Grants necessary roles on the new CoreVault to the new Factory
// - Optionally updates factory defaults (margin bps, fee bps) via env or flags
// - Updates the deployments/<network>-deployment.json with the new factory address
//
// What this script does NOT do:
// - It does NOT redeploy CoreVault, libraries, LiquidationManager, or OrderBooks
// - It does NOT create markets
//
// Usage:
//   npx hardhat run scripts/redeploy-factory.js --network <network>
//
// Flags:
//   --skip-defaults        Do not update default parameters on the new factory
//
// Env:
//   FACTORY_ADMIN_ADDRESS          (default: deployer)
//   TREASURY_ADDRESS               (default: deployer)
//   FACTORY_DEFAULT_MARGIN_BPS     (default: 10000)
//   FACTORY_DEFAULT_FEE_BPS        (default: 0)
//

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load environment (prefer .env.local, then default .env)
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

function parseFlags() {
  const argv = process.argv.slice(2);
  return {
    skipDefaults: argv.includes("--skip-defaults"),
  };
}

function readDeployment(networkName) {
  const deploymentPath = path.join(__dirname, "..", "deployments", `${networkName}-deployment.json`);
  const fallbackPath = path.join(__dirname, "..", "deployments", `unknown-deployment.json`);
  let data = null;
  if (fs.existsSync(deploymentPath)) {
    data = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    return { data, path: deploymentPath };
  }
  if (fs.existsSync(fallbackPath)) {
    data = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
    return { data, path: fallbackPath };
  }
  return { data: null, path: deploymentPath };
}

async function main() {
  console.log("\n🚀 Minimal FuturesMarketFactory Redeploy");
  console.log("═".repeat(80));
  const flags = parseFlags();

  // Network info
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);

  // Load deployment file
  const { data: deployment, path: deploymentPath } = readDeployment(networkName);
  if (!deployment || !deployment.contracts) {
    throw new Error(`No deployment data found for network "${networkName}". Expected at ${deploymentPath}`);
  }
  const contracts = { ...deployment.contracts };

  // Required addresses
  const CORE_VAULT = process.env.CORE_VAULT_ADDRESS || contracts.CORE_VAULT;
  if (!CORE_VAULT || !/^0x[0-9a-fA-F]{40}$/.test(CORE_VAULT)) {
    throw new Error("Missing or invalid CORE_VAULT address. Redeploy CoreVault first or set CORE_VAULT_ADDRESS.");
  }

  const [deployer] = await ethers.getSigners();
  const ADMIN = process.env.FACTORY_ADMIN_ADDRESS || deployer.address;
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address;

  console.log("\n📦 Using parameters:");
  console.log(`  CORE_VAULT       ${CORE_VAULT}`);
  console.log(`  ADMIN            ${ADMIN}`);
  console.log(`  FEE RECIPIENT    ${TREASURY}`);

  // Deploy new factory
  console.log("\n🏗️  Deploying new FuturesMarketFactory...");
  const Factory = await ethers.getContractFactory("FuturesMarketFactory");
  const factory = await Factory.deploy(CORE_VAULT, ADMIN, TREASURY);
  await factory.waitForDeployment();
  const NEW_FACTORY = await factory.getAddress();
  console.log("  ✅ FuturesMarketFactory deployed at:", NEW_FACTORY);

  // Optionally update defaults
  if (!flags.skipDefaults) {
    const marginBps = Number(process.env.FACTORY_DEFAULT_MARGIN_BPS || 10000);
    const feeBps = Number(process.env.FACTORY_DEFAULT_FEE_BPS || 0);
    try {
      console.log(`  🔧 Setting factory defaults: margin=${marginBps} bps, fee=${feeBps} bps...`);
      await factory.updateDefaultParameters(marginBps, feeBps);
      console.log("  ✅ Factory default parameters updated");
    } catch (e) {
      console.log("  ⚠️  Could not update factory default parameters:", e?.message || e);
    }
  } else {
    console.log("  ℹ️  Skipped factory defaults update (--skip-defaults)");
  }

  // Grant roles on CoreVault to the NEW factory
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
  const vault = await ethers.getContractAt(
    [
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
    ],
    CORE_VAULT
  );
  console.log("  🔒 Granting roles on CoreVault to the new Factory...");
  try {
    await vault.grantRole(FACTORY_ROLE, NEW_FACTORY);
    await vault.grantRole(SETTLEMENT_ROLE, NEW_FACTORY);
    console.log("  ✅ FACTORY_ROLE and SETTLEMENT_ROLE granted");
  } catch (e) {
    console.log("  ⚠️  Could not grant roles on CoreVault:", e?.message || e);
  }

  // Persist to deployment file
  console.log("\n📝 Updating deployment file with new FUTURES_MARKET_FACTORY...");
  const previousFactory = contracts.FUTURES_MARKET_FACTORY || null;
  contracts.FUTURES_MARKET_FACTORY = NEW_FACTORY;
  const updated = {
    ...deployment,
    timestamp: new Date().toISOString(),
    contracts,
    notes: {
      ...(deployment.notes || {}),
      factoryRedeploy: {
        previousFactory,
        newFactory: NEW_FACTORY,
        coreVault: CORE_VAULT,
        admin: ADMIN,
        feeRecipient: TREASURY,
        by: deployer.address,
      },
    },
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(updated, null, 2));
  console.log("  ✅ Deployment file updated:", deploymentPath);

  console.log("\n✅ Factory redeploy complete. New markets will target the new CoreVault.");
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Factory redeploy failed:", err?.message || err);
    process.exit(1);
  });





