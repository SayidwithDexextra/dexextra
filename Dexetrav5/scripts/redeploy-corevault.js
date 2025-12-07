#!/usr/bin/env node

// Minimal CoreVault redeploy (no new markets, no unnecessary redeploys)
//
// What this script does:
// - Reuses existing library addresses (VaultAnalytics, PositionManager)
// - Redeploys ONLY CoreVault with the same USDC and new admin (from env or deployer)
// - Immediately deploys a NEW FuturesMarketFactory pointing at the NEW CoreVault
// - Rewires roles on the NEW CoreVault to existing/new components (Factories, optional Hub, OBs if opted-in)
// - Updates deployments/<network>-deployment.json with the new CORE_VAULT and FUTURES_MARKET_FACTORY addresses
//
// What this script DOES NOT do:
// - It does NOT redeploy VaultAnalytics, PositionManager, LiquidationManager, or any OrderBook Diamonds
// - It does NOT create markets
//
// IMPORTANT ARCHITECTURE NOTE:
// - FuturesMarketFactory stores the vault address as immutable and the OrderBook diamonds store the vault
//   address at initialization. Redeploying CoreVault WILL NOT automatically rewire existing Factory/OrderBooks.
// - This script warns about that and, by default, does not attempt to grant OB roles unless you pass:
//     --grant-ob-roles
// - Use this primarily before markets exist, in local dev, or when you intend to redeploy dependent components.
//
// Usage:
//   npx hardhat run scripts/redeploy-corevault.js --network <network>
//   node scripts/redeploy-corevault.js                   (Hardhat picks default network)
//
// Flags:
//   --grant-ob-roles       Also grant ORDERBOOK_ROLE and SETTLEMENT_ROLE to known OB addresses
//   --allow-breaking       Suppress safety warning about immutable vault refs in Factory/OrderBooks
//   --skip-factory-defaults Do not update default parameters on the new factory
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
    grantObRoles: argv.includes("--grant-ob-roles"),
    allowBreaking: argv.includes("--allow-breaking"),
    skipFactoryDefaults: argv.includes("--skip-factory-defaults"),
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

function getKnownOrderbooks(contracts) {
  if (!contracts) return [];
  const keys = Object.keys(contracts);
  const result = [];
  for (const k of keys) {
    if (k.endsWith("_ORDERBOOK") || k === "ORDERBOOK") {
      const addr = contracts[k];
      if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
        result.push({ key: k, address: addr });
      }
    }
  }
  return result;
}

async function main() {
  console.log("\n🚀 Minimal CoreVault Redeploy");
  console.log("═".repeat(80));
  const flags = parseFlags();

  // Network info
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);

  // Load deployment
  const { data: deployment, path: deploymentPath } = readDeployment(networkName);
  if (!deployment || !deployment.contracts) {
    throw new Error(`No deployment data found for network "${networkName}". Expected at ${deploymentPath}`);
  }
  const contracts = { ...deployment.contracts };

  // Required existing addresses (reused; no redeploy)
  const VAULT_ANALYTICS = process.env.VAULT_ANALYTICS_ADDRESS || contracts.VAULT_ANALYTICS;
  const POSITION_MANAGER = process.env.POSITION_MANAGER_ADDRESS || contracts.POSITION_MANAGER;
  const MOCK_USDC = process.env.MOCK_USDC_ADDRESS || contracts.MOCK_USDC;
  const LIQUIDATION_MANAGER = process.env.LIQUIDATION_MANAGER_ADDRESS || contracts.LIQUIDATION_MANAGER || null;
  const FACTORY = process.env.FUTURES_MARKET_FACTORY_ADDRESS || contracts.FUTURES_MARKET_FACTORY || null;
  const COLLATERAL_HUB =
    process.env.COLLATERAL_HUB_ADDRESS || contracts.COLLATERAL_HUB || process.env.HUB_ADDRESS || null;

  // Validate library and USDC addresses
  const missing = [];
  if (!VAULT_ANALYTICS) missing.push("VAULT_ANALYTICS");
  if (!POSITION_MANAGER) missing.push("POSITION_MANAGER");
  if (!MOCK_USDC) missing.push("MOCK_USDC");
  if (missing.length) {
    throw new Error(`Missing required addresses: ${missing.join(", ")}. Populate via env or deployment file.`);
  }

  // Safety warning about immutable references
  const knownOBs = getKnownOrderbooks(contracts);
  if (knownOBs.length && !flags.allowBreaking) {
    console.log("\n⚠️  WARNING: Existing OrderBooks and Factory reference the OLD CoreVault address.");
    console.log("    - Factory stores CoreVault as immutable.");
    console.log("    - OrderBooks store CoreVault during initialization.");
    console.log("    Redeploying CoreVault will NOT automatically rewire those references.");
    console.log("    Pass --allow-breaking to proceed anyway.");
    process.exit(1);
  }

  // Get signer
  const [deployer] = await ethers.getSigners();
  const CORE_VAULT_ADMIN = process.env.CORE_VAULT_ADMIN_ADDRESS || deployer.address;

  console.log("\n📦 Reusing existing components (no redeploy):");
  console.log(`  VAULT_ANALYTICS      ${VAULT_ANALYTICS}`);
  console.log(`  POSITION_MANAGER     ${POSITION_MANAGER}`);
  console.log(`  MOCK_USDC            ${MOCK_USDC}`);
  if (LIQUIDATION_MANAGER) console.log(`  LIQUIDATION_MANAGER  ${LIQUIDATION_MANAGER}`);
  if (FACTORY) console.log(`  FACTORY              ${FACTORY}`);
  if (COLLATERAL_HUB) console.log(`  COLLATERAL_HUB       ${COLLATERAL_HUB}`);

  // Deploy NEW CoreVault (linked to existing libraries)
  console.log("\n🏗️  Deploying NEW CoreVault (linked to existing libs)...");
  const CoreVaultFactory = await ethers.getContractFactory("CoreVault", {
    libraries: {
      VaultAnalytics: VAULT_ANALYTICS,
      PositionManager: POSITION_MANAGER,
    },
  });
  const coreVault = await CoreVaultFactory.deploy(MOCK_USDC, CORE_VAULT_ADMIN);
  await coreVault.waitForDeployment();
  const NEW_CORE_VAULT = await coreVault.getAddress();
  console.log("  ✅ CoreVault deployed at:", NEW_CORE_VAULT);

  // Roles and wiring on NEW CoreVault
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));

  // Link LiquidationManager if present
  if (LIQUIDATION_MANAGER) {
    console.log("  🔧 Setting liquidation manager on new CoreVault...");
    await coreVault.setLiquidationManager(LIQUIDATION_MANAGER);
    console.log("  ✅ LiquidationManager configured");
  } else {
    console.log("  ℹ️  No LIQUIDATION_MANAGER address found; skipping setLiquidationManager");
  }

  // Set global fixed MMR params (same as deploy.js baseline)
  console.log("  🔧 Setting MMR params (base=10%, penalty=10%, cap=20%, scaling=0, depth=1)...");
  await coreVault.setMmrParams(1000, 1000, 2000, 1);
  console.log("  ✅ MMR params set");

  // Grant roles to EXISTING Factory (if present) so it can continue managing legacy/new ops if desired
  if (FACTORY) {
    console.log("  🔒 Granting roles to Factory on new CoreVault...");
    await coreVault.grantRole(FACTORY_ROLE, FACTORY);
    await coreVault.grantRole(SETTLEMENT_ROLE, FACTORY);
    console.log("  ✅ FACTORY_ROLE and SETTLEMENT_ROLE granted to Factory");
  } else {
    console.log("  ℹ️  No FACTORY address found; skipping factory role grants");
  }

  // Deploy NEW FuturesMarketFactory that targets the NEW CoreVault
  console.log("\n🏗️  Deploying NEW FuturesMarketFactory (targets NEW CoreVault)...");
  const ADMIN = process.env.FACTORY_ADMIN_ADDRESS || deployer.address;
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address;
  const Factory = await ethers.getContractFactory("FuturesMarketFactory");
  const newFactory = await Factory.deploy(NEW_CORE_VAULT, ADMIN, TREASURY);
  await newFactory.waitForDeployment();
  const NEW_FACTORY = await newFactory.getAddress();
  console.log("  ✅ New FuturesMarketFactory deployed at:", NEW_FACTORY);

  // Optionally set default parameters on the new factory
  if (!flags.skipFactoryDefaults) {
    const marginBps = Number(process.env.FACTORY_DEFAULT_MARGIN_BPS || 10000);
    const feeBps = Number(process.env.FACTORY_DEFAULT_FEE_BPS || 0);
    try {
      console.log(`  🔧 Setting new factory defaults: margin=${marginBps} bps, fee=${feeBps} bps...`);
      await newFactory.updateDefaultParameters(marginBps, feeBps);
      console.log("  ✅ New factory default parameters updated");
    } catch (e) {
      console.log("  ⚠️  Could not update new factory default parameters:", e?.message || e);
    }
  } else {
    console.log("  ℹ️  Skipped new factory defaults update (--skip-factory-defaults)");
  }

  // Grant roles on NEW CoreVault to the NEW Factory
  console.log("  🔒 Granting roles to NEW Factory on new CoreVault...");
  try {
    await coreVault.grantRole(FACTORY_ROLE, NEW_FACTORY);
    await coreVault.grantRole(SETTLEMENT_ROLE, NEW_FACTORY);
    console.log("  ✅ FACTORY_ROLE and SETTLEMENT_ROLE granted to NEW Factory");
  } catch (e) {
    console.log("  ⚠️  Could not grant roles on CoreVault to NEW Factory:", e?.message || e);
  }

  // Optionally grant roles to known OrderBooks
  if (flags.grantObRoles && knownOBs.length) {
    console.log("  🔒 Granting roles to known OrderBooks on new CoreVault...");
    for (const ob of knownOBs) {
      try {
        await coreVault.grantRole(ORDERBOOK_ROLE, ob.address);
        await coreVault.grantRole(SETTLEMENT_ROLE, ob.address);
        console.log(`  ✅ Roles granted to ${ob.key}: ${ob.address}`);
      } catch (e) {
        console.log(`  ⚠️  Could not grant roles to ${ob.key}: ${e?.message || e}`);
      }
    }
  } else if (knownOBs.length) {
    console.log("  ℹ️  Known OrderBooks detected but --grant-ob-roles not provided; skipping OB role grants");
  } else {
    console.log("  ℹ️  No known OrderBooks detected in deployment; skipping OB role grants");
  }

  // Grant EXTERNAL_CREDITOR_ROLE to CollateralHub (if present)
  if (COLLATERAL_HUB) {
    try {
      console.log("  🔒 Granting EXTERNAL_CREDITOR_ROLE to CollateralHub...");
      await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, COLLATERAL_HUB);
      console.log("  ✅ EXTERNAL_CREDITOR_ROLE granted to CollateralHub");
    } catch (e) {
      console.log("  ⚠️  Could not grant CollateralHub role:", e?.message || e);
    }
  }

  // Persist: update deployments file with NEW_CORE_VAULT and NEW_FACTORY
  console.log("\n📝 Updating deployment file with new CORE_VAULT and FUTURES_MARKET_FACTORY...");
  const previousCoreVault = contracts.CORE_VAULT || null;
  const previousFactory = contracts.FUTURES_MARKET_FACTORY || null;
  contracts.CORE_VAULT = NEW_CORE_VAULT;
  contracts.FUTURES_MARKET_FACTORY = NEW_FACTORY;
  const updated = {
    ...deployment,
    timestamp: new Date().toISOString(),
    contracts,
    notes: {
      ...(deployment.notes || {}),
      coreVaultRedeploy: {
        previousCoreVault,
        newCoreVault: NEW_CORE_VAULT,
        by: (await ethers.getSigners())[0].address,
      },
      factoryRedeploy: {
        previousFactory,
        newFactory: NEW_FACTORY,
        coreVault: NEW_CORE_VAULT,
        admin: ADMIN,
        feeRecipient: TREASURY,
        by: (await ethers.getSigners())[0].address,
      },
    },
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(updated, null, 2));
  console.log("  ✅ Deployment file updated:", deploymentPath);

  // Final reminder about immutable references
  if (knownOBs.length) {
    console.log("\n⚠️  Reminder:");
    console.log("    Existing Factory/OrderBooks still reference the OLD CoreVault.");
    console.log("    This redeploy provides a NEW CoreVault and a NEW Factory for future markets.");
    console.log("    Update/replace dependent components as needed before production use for legacy markets.");
  }

  console.log("\n✅ CoreVault + Factory redeploy complete.");
  console.log(`   • NEW CoreVault: ${NEW_CORE_VAULT}`);
  console.log(`   • NEW Factory:   ${NEW_FACTORY}`);
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ CoreVault redeploy failed:", err?.message || err);
    process.exit(1);
  });


