#!/usr/bin/env node
/**
 * verify-real-usdc-migration.js
 *
 * Verify all contracts deployed by the Real USDC migration script on Arbiscan.
 * Reads contract addresses from the deployment JSON and verifies each one.
 *
 * Environment Variables:
 *   ARBISCAN_API_KEY       - Your Arbiscan API key for verification
 *   DEPLOYMENT_JSON_PATH   - Path to deployment JSON (defaults to arbitrum-real-usdc-deployment.json)
 *
 * Usage:
 *   npx hardhat run scripts/verify-real-usdc-migration.js --network arbitrum
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "arbitrum";
  console.log(`\n🔍 VERIFY REAL USDC MIGRATION CONTRACTS - ${networkName.toUpperCase()}`);
  console.log("═".repeat(70));

  // Check for Arbiscan API key
  const apiKey = process.env.ARBISCAN_API_KEY;
  if (!apiKey) {
    console.error("❌ ARBISCAN_API_KEY not set in environment");
    console.error("   Get your API key from https://arbiscan.io/myapikey");
    process.exit(1);
  }
  console.log("✅ Arbiscan API key found");

  // Load deployment JSON
  const deploymentPath = process.env.DEPLOYMENT_JSON_PATH || 
    path.join(__dirname, "../deployments/arbitrum-real-usdc-deployment.json");
  
  if (!fs.existsSync(deploymentPath)) {
    console.error(`❌ Deployment file not found: ${deploymentPath}`);
    console.error("   Run deploy-real-usdc-migration.js first");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  console.log(`✅ Loaded deployment from: ${deploymentPath}`);
  console.log(`   Network: ${deployment.network} (Chain ID: ${deployment.chainId})`);
  console.log(`   USDC: ${deployment.usdcToken}`);

  const contracts = deployment.contracts;
  const usdcToken = deployment.usdcToken;
  const deployer = deployment.deployer;
  const treasury = deployment.treasury;

  // Verification configs with constructor arguments
  const verifications = [
    {
      name: "VaultAnalytics",
      address: contracts.VAULT_ANALYTICS,
      args: [],
    },
    {
      name: "PositionManager",
      address: contracts.POSITION_MANAGER,
      args: [],
    },
    {
      name: "CoreVault",
      address: contracts.CORE_VAULT_IMPL,
      args: [usdcToken],
      libraries: {
        PositionManager: contracts.POSITION_MANAGER,
      },
    },
    {
      name: "LiquidationManager",
      address: contracts.LIQUIDATION_MANAGER,
      args: [usdcToken, deployer],
      libraries: {
        VaultAnalytics: contracts.VAULT_ANALYTICS,
        PositionManager: contracts.POSITION_MANAGER,
      },
    },
    {
      name: "SettlementManager",
      address: contracts.SETTLEMENT_MANAGER,
      args: [],
      libraries: {
        PositionManager: contracts.POSITION_MANAGER,
      },
    },
    {
      name: "VaultViewsManager",
      address: contracts.VAULT_VIEWS_MANAGER,
      args: [],
      libraries: {
        VaultAnalytics: contracts.VAULT_ANALYTICS,
      },
    },
    {
      name: "FeeRegistry",
      address: contracts.FEE_REGISTRY,
      args: [
        deployer,
        deployment.configuration?.takerFeeBps || "7",
        deployment.configuration?.makerFeeBps || "3",
        treasury,
        deployment.configuration?.protocolFeeShareBps || "8000"
      ],
    },
    {
      name: "FacetRegistry",
      address: contracts.FACET_REGISTRY,
      args: [deployer],
    },
    {
      name: "FuturesMarketFactoryV2",
      address: contracts.FUTURES_MARKET_FACTORY,
      args: [contracts.CORE_VAULT, deployer, treasury],
    },
    {
      name: "GlobalSessionRegistry",
      address: contracts.GLOBAL_SESSION_REGISTRY,
      args: [deployer],
    },
  ];

  // Add CollateralHub if deployed
  if (contracts.COLLATERAL_HUB) {
    const hubAdmin = process.env.COLLATERAL_HUB_ADMIN || deployer;
    const hubOperator = process.env.CORE_VAULT_OPERATOR_ADDRESS || deployer;
    verifications.push({
      name: "CollateralHub",
      address: contracts.COLLATERAL_HUB,
      args: [hubAdmin, contracts.CORE_VAULT, hubOperator],
    });
  }

  // Add MarketBondManager
  const bondDefault = deployment.configuration?.bondDefault || "100000000";
  const bondMin = deployment.configuration?.bondMin || "1000000";
  const bondMax = deployment.configuration?.bondMax || "0";
  verifications.push({
    name: "MarketBondManager",
    address: contracts.MARKET_BOND_MANAGER,
    args: [
      contracts.CORE_VAULT,
      contracts.FUTURES_MARKET_FACTORY,
      deployer,
      bondDefault,
      bondMin,
      bondMax,
    ],
  });

  // Add facets (no constructor args)
  const facetContracts = [
    "OrderBookInit",
    "OBAdminFacet",
    "OBAdminViewFacet",
    "OBPricingFacet",
    "OBOrderPlacementFacet",
    "OBTradeExecutionFacet",
    "OBLiquidationFacet",
    "OBViewFacet",
    "OBSettlementFacet",
    "OBBatchSettlementFacet",
    "OBMaintenanceFacet",
    "MarketLifecycleFacet",
    "MetaTradeFacet",
    "OrderBookVaultAdminFacet",
  ];

  for (const name of facetContracts) {
    const key = name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    const address = contracts[key] || contracts[`${key}_FACET`];
    if (address) {
      verifications.push({ name, address, args: [] });
    }
  }

  console.log(`\n📝 Verifying ${verifications.length} contracts...`);
  console.log("─".repeat(70));

  let verified = 0;
  let failed = 0;
  let skipped = 0;

  for (const v of verifications) {
    if (!v.address) {
      console.log(`⚠️ ${v.name}: No address found, skipping`);
      skipped++;
      continue;
    }

    console.log(`\n🔍 Verifying ${v.name}...`);
    console.log(`   Address: ${v.address}`);

    try {
      // Build verify command
      let cmd = `npx hardhat verify --network ${networkName} ${v.address}`;
      
      // Add constructor args
      if (v.args && v.args.length > 0) {
        cmd += ` ${v.args.map(a => `"${a}"`).join(" ")}`;
      }

      // Add libraries
      if (v.libraries) {
        for (const [libName, libAddr] of Object.entries(v.libraries)) {
          cmd += ` --libraries ${libName}:${libAddr}`;
        }
      }

      console.log(`   Command: ${cmd}`);
      
      const result = execSync(cmd, { encoding: "utf8", timeout: 120000 });
      console.log(`   ✅ Verified successfully`);
      verified++;
    } catch (error) {
      const msg = error.message || error.toString();
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log(`   ✅ Already verified`);
        verified++;
      } else if (msg.includes("Contract source code already verified")) {
        console.log(`   ✅ Already verified`);
        verified++;
      } else {
        console.log(`   ❌ Verification failed: ${msg.split("\n")[0]}`);
        failed++;
      }
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("VERIFICATION SUMMARY");
  console.log("═".repeat(70));
  console.log(`  ✅ Verified: ${verified}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⚠️ Skipped: ${skipped}`);
  console.log("═".repeat(70));

  // Print manual verification commands for any that failed
  if (failed > 0) {
    console.log("\n📋 Manual verification commands:");
    console.log("─".repeat(70));
    
    for (const v of verifications) {
      if (!v.address) continue;
      
      let cmd = `npx hardhat verify --network ${networkName} ${v.address}`;
      if (v.args && v.args.length > 0) {
        cmd += ` ${v.args.map(a => `"${a}"`).join(" ")}`;
      }
      if (v.libraries) {
        for (const [libName, libAddr] of Object.entries(v.libraries)) {
          cmd += ` --libraries ${libName}:${libAddr}`;
        }
      }
      console.log(`\n# ${v.name}`);
      console.log(cmd);
    }
  }

  console.log("\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  });
