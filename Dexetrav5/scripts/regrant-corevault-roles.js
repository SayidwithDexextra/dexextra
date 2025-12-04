#!/usr/bin/env node

/**
 * Regrant roles on a newly redeployed CoreVault.
 *
 * What this script does:
 * - Verifies the signer has DEFAULT_ADMIN_ROLE on CoreVault
 * - Optionally sets the LiquidationManager implementation
 * - Grants FACTORY_ROLE/SETTLEMENT_ROLE to the existing factory (if provided)
 * - Grants EXTERNAL_CREDITOR_ROLE to CollateralHub (if provided)
 * - Grants ORDERBOOK_ROLE (and optionally SETTLEMENT_ROLE) to known OrderBooks
 * - Registers OrderBooks and assigns marketId→OrderBook mapping on CoreVault
 *   (temporarily grants FACTORY_ROLE to signer if needed; revokes it afterwards unless --keep-factory-on-signer)
 *
 * Inputs (env or CLI flags):
 *   CORE_VAULT_ADDRESS (required)                       --vault 0x...
 *   LIQUIDATION_MANAGER_ADDRESS (optional)              --lm 0x...
 *   FUTURES_MARKET_FACTORY_ADDRESS (optional)           --factory 0x...
 *   COLLATERAL_HUB_ADDRESS (optional)                   --hub 0x...
 *   SETTLEMENT_OPERATORS (optional: comma-separated)    --settlers 0xA,0xB
 *   DEPLOYMENTS_FILE (optional explicit file path)      --deployments path/to/file.json
 *
 * Flags:
 *   --no-ob-settlement     Do NOT grant SETTLEMENT_ROLE to OrderBooks (default: grant)
 *   --skip-ob-roles        Skip granting ORDERBOOK_ROLE to OrderBooks
 *   --skip-mapping         Skip register/assign market→orderbook mapping
 *   --keep-factory-on-signer  Keep FACTORY_ROLE on signer (do not revoke after)
 *
 * Usage:
 *   npx hardhat run scripts/regrant-corevault-roles.js --network <network>
 *   node scripts/regrant-corevault-roles.js --vault 0x... --factory 0x... --hub 0x...
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load environment (prefer .env.local first)
try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (key) => {
    const idx = argv.indexOf(key);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };
  const has = (flag) => argv.includes(flag);
  return {
    vault: get("--vault") || process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || null,
    lm: get("--lm") || process.env.LIQUIDATION_MANAGER_ADDRESS || null,
    factory: get("--factory") || process.env.FUTURES_MARKET_FACTORY_ADDRESS || null,
    hub: get("--hub") || process.env.COLLATERAL_HUB_ADDRESS || process.env.HUB_ADDRESS || null,
    settlers: (get("--settlers") || process.env.SETTLEMENT_OPERATORS || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s)),
    deploymentsFile: get("--deployments") || process.env.DEPLOYMENTS_FILE || null,
    usdc: get("--usdc") || process.env.MOCK_USDC_ADDRESS || null,
    admin: get("--admin") || process.env.CORE_VAULT_ADMIN_ADDRESS || null,
    vaLib: get("--vault-analytics") || process.env.VAULT_ANALYTICS_ADDRESS || null,
    pmLib: get("--position-manager") || process.env.POSITION_MANAGER_ADDRESS || null,
    deployCoreVault: has("--deploy-core-vault") || has("--deploy"),
    writeDeployments: has("--write-deployments"),
    noObSettlement: has("--no-ob-settlement"),
    skipObRoles: has("--skip-ob-roles"),
    skipMapping: has("--skip-mapping"),
    keepFactoryOnSigner: has("--keep-factory-on-signer"),
  };
}

function readDeployment(networkName, explicitFile) {
  if (explicitFile && fs.existsSync(explicitFile)) {
    return { data: JSON.parse(fs.readFileSync(explicitFile, "utf8")), path: explicitFile };
  }
  const candidate = path.join(__dirname, "..", "deployments", `${networkName}-deployment.json`);
  if (fs.existsSync(candidate)) {
    return { data: JSON.parse(fs.readFileSync(candidate, "utf8")), path: candidate };
  }
  // Fallback to hyperliquid-deployment.json if network isn't standard hardhat networks
  const hyper = path.join(__dirname, "..", "deployments", "hyperliquid-deployment.json");
  if (fs.existsSync(hyper)) {
    return { data: JSON.parse(fs.readFileSync(hyper, "utf8")), path: hyper };
  }
  return { data: null, path: candidate };
}

function getKnownOrderbooksAndMarketIds(deployment) {
  const result = [];
  if (!deployment) return result;
  // Prefer explicit markets list with marketId and orderBook
  const markets = Array.isArray(deployment.markets) ? deployment.markets : [];
  for (const m of markets) {
    if (m && /^0x[0-9a-fA-F]{40}$/.test(m.orderBook) && /^0x[0-9a-fA-F]{64}$/.test(m.marketId)) {
      result.push({ marketId: m.marketId, orderBook: m.orderBook, symbol: m.symbol || "" });
    }
  }
  // Also scan "contracts" keys that end with _ORDERBOOK with paired *_MARKET_ID if present
  const c = deployment.contracts || {};
  for (const [key, val] of Object.entries(c)) {
    if ((key.endsWith("_ORDERBOOK") || key === "ORDERBOOK") && typeof val === "string" && /^0x[0-9a-fA-F]{40}$/.test(val)) {
      const prefix = key.replace("_ORDERBOOK", "");
      const mkKey = prefix + "_MARKET_ID";
      const mkVal = c[mkKey];
      if (typeof mkVal === "string" && /^0x[0-9a-fA-F]{64}$/.test(mkVal)) {
        // Avoid duplicates
        if (!result.find((r) => r.orderBook.toLowerCase() === val.toLowerCase())) {
          result.push({ marketId: mkVal, orderBook: val, symbol: prefix });
        }
      }
    }
  }
  return result;
}

async function main() {
  console.log("\n🔐 Regrant CoreVault Roles");
  console.log("─".repeat(80));
  const args = parseArgs();

  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`🌐 Network: ${networkName} (chainId=${network.chainId})`);

  const { data: deployment, path: depPath } = readDeployment(networkName, args.deploymentsFile);
  if (!deployment) {
    console.log("ℹ️  No deployment file found; proceeding with explicit addresses only.");
  } else {
    console.log(`📄 Deployment file: ${depPath}`);
  }

  // Optionally deploy a NEW CoreVault if requested or if no vault provided
  if (args.deployCoreVault || !args.vault || !/^0x[0-9a-fA-F]{40}$/.test(args.vault)) {
    console.log("\n🏗️  Deploying NEW CoreVault...");
    // Resolve libraries and constructor params
    const VAULT_ANALYTICS = args.vaLib || (deployment && deployment.contracts && deployment.contracts.VAULT_ANALYTICS) || null;
    const POSITION_MANAGER = args.pmLib || (deployment && deployment.contracts && deployment.contracts.POSITION_MANAGER) || null;
    const MOCK_USDC = args.usdc || (deployment && deployment.contracts && deployment.contracts.MOCK_USDC) || null;
    const [signer] = await ethers.getSigners();
    const CORE_VAULT_ADMIN = args.admin || signer.address;
    const missing = [];
    if (!VAULT_ANALYTICS) missing.push("VaultAnalytics library (--vault-analytics or VAULT_ANALYTICS_ADDRESS)");
    if (!POSITION_MANAGER) missing.push("PositionManager library (--position-manager or POSITION_MANAGER_ADDRESS)");
    if (!MOCK_USDC) missing.push("MockUSDC address (--usdc or MOCK_USDC_ADDRESS)");
    if (missing.length) {
      throw new Error(`Missing required inputs to deploy CoreVault:\n- ${missing.join("\n- ")}`);
    }
    console.log("  Using:");
    console.log(`    VAULT_ANALYTICS      ${VAULT_ANALYTICS}`);
    console.log(`    POSITION_MANAGER     ${POSITION_MANAGER}`);
    console.log(`    MOCK_USDC            ${MOCK_USDC}`);
    console.log(`    CORE_VAULT_ADMIN     ${CORE_VAULT_ADMIN}`);
    const CoreVaultFactory = await ethers.getContractFactory("CoreVault", {
      libraries: {
        VaultAnalytics: VAULT_ANALYTICS,
        PositionManager: POSITION_MANAGER,
      },
    });
    const coreVaultDeployed = await CoreVaultFactory.deploy(MOCK_USDC, CORE_VAULT_ADMIN);
    await coreVaultDeployed.waitForDeployment();
    const NEW_CORE_VAULT = await coreVaultDeployed.getAddress();
    args.vault = NEW_CORE_VAULT;
    console.log("  ✅ CoreVault deployed at:", NEW_CORE_VAULT);
    // Persist to deployment file if requested
    if (deployment && args.writeDeployments) {
      const contracts = { ...(deployment.contracts || {}) };
      const previousCoreVault = contracts.CORE_VAULT || null;
      contracts.CORE_VAULT = NEW_CORE_VAULT;
      const updated = {
        ...deployment,
        timestamp: new Date().toISOString(),
        contracts,
        notes: {
          ...(deployment.notes || {}),
          coreVaultRedeploy: {
            previousCoreVault,
            newCoreVault: NEW_CORE_VAULT,
            by: await signer.getAddress(),
          },
        },
      };
      fs.writeFileSync(depPath, JSON.stringify(updated, null, 2));
      console.log("  📝 Updated deployment file:", depPath);
    }
    // Emit machine-readable output line
    console.log(`NEW_CORE_VAULT=${args.vault}`);
    console.log(JSON.stringify({ newCoreVault: args.vault }));
  }

  if (!args.vault || !/^0x[0-9a-fA-F]{40}$/.test(args.vault)) {
    throw new Error("CORE_VAULT_ADDRESS is required (provided or deployed). Pass --vault 0x... or --deploy-core-vault.");
  }

  const [signer] = await ethers.getSigners();
  console.log(`👤 Signer: ${await signer.getAddress()}`);

  // Role identifiers
  // In OZ AccessControl, DEFAULT_ADMIN_ROLE is 0x00
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));

  // CoreVault at provided address
  const coreVault = await ethers.getContractAt("CoreVault", args.vault);

  // Verify DEFAULT_ADMIN_ROLE
  try {
    const isAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, await signer.getAddress());
    if (!isAdmin) {
      throw new Error("Signer is not DEFAULT_ADMIN_ROLE on CoreVault. Use an admin to run this script.");
    }
  } catch (e) {
    console.log("❌ Cannot verify DEFAULT_ADMIN_ROLE. Ensure ABI is correct and signer is admin.", e?.message || e);
    throw e;
  }

  // 1) Link LiquidationManager
  if (args.lm && /^0x[0-9a-fA-F]{40}$/.test(args.lm)) {
    console.log("🔧 setLiquidationManager:", args.lm);
    await coreVault.setLiquidationManager(args.lm);
    console.log("✅ LiquidationManager set");
  } else {
    console.log("ℹ️  No LIQUIDATION_MANAGER_ADDRESS provided; skipping");
  }

  // 2) Grant FACTORY/SETTLEMENT roles to factory (if provided)
  if (args.factory && /^0x[0-9a-fA-F]{40}$/.test(args.factory)) {
    console.log("🏭 Existing Factory:", args.factory);
    console.log("🔒 Granting FACTORY_ROLE and SETTLEMENT_ROLE to Factory (on CoreVault)...");
    try {
      if (!(await coreVault.hasRole(FACTORY_ROLE, args.factory))) {
        await coreVault.grantRole(FACTORY_ROLE, args.factory);
      }
      if (!(await coreVault.hasRole(SETTLEMENT_ROLE, args.factory))) {
        await coreVault.grantRole(SETTLEMENT_ROLE, args.factory);
      }
      console.log("✅ Factory roles granted on CoreVault");
    } catch (e) {
      console.log("⚠️  Could not grant roles to Factory:", e?.message || e);
    }

    // Also update the Factory to point to the NEW CoreVault for future markets
    try {
      const factory = await ethers.getContractAt("FuturesMarketFactory", args.factory);
      const currentVault = await factory.vault();
      if (currentVault.toLowerCase() !== args.vault.toLowerCase()) {
        console.log(`🔧 Updating Factory.vault from ${currentVault} -> ${args.vault} ...`);
        await factory.updateVault(args.vault);
        console.log("✅ Factory now points to the new CoreVault");
      } else {
        console.log("ℹ️  Factory already points to the provided CoreVault; skipping updateVault");
      }
    } catch (e) {
      console.log("⚠️  Could not update Factory.vault. Are you factory admin?", e?.message || e);
    }
  } else {
    console.log("ℹ️  No Factory address provided; skipping factory role grants");
  }

  // 3) Grant EXTERNAL_CREDITOR_ROLE to CollateralHub
  if (args.hub && /^0x[0-9a-fA-F]{40}$/.test(args.hub)) {
    console.log("🔒 Granting EXTERNAL_CREDITOR_ROLE to CollateralHub:", args.hub);
    try {
      if (!(await coreVault.hasRole(EXTERNAL_CREDITOR_ROLE, args.hub))) {
        await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, args.hub);
      }
      console.log("✅ CollateralHub role granted");
    } catch (e) {
      console.log("⚠️  Could not grant EXTERNAL_CREDITOR_ROLE:", e?.message || e);
    }
  } else {
    console.log("ℹ️  No CollateralHub address provided; skipping EXTERNAL_CREDITOR_ROLE");
  }

  // 4) Grant SETTLEMENT_ROLE to any additional settlement operators
  for (const op of args.settlers) {
    console.log("🔒 Granting SETTLEMENT_ROLE to operator:", op);
    try {
      if (!(await coreVault.hasRole(SETTLEMENT_ROLE, op))) {
        await coreVault.grantRole(SETTLEMENT_ROLE, op);
      }
      console.log("✅ SETTLEMENT_ROLE granted to", op);
    } catch (e) {
      console.log(`⚠️  Could not grant SETTLEMENT_ROLE to ${op}:`, e?.message || e);
    }
  }

  // 5) OrderBooks: grant roles and wire market mapping
  const entries = getKnownOrderbooksAndMarketIds(deployment || {});
  if (!entries.length) {
    console.log("ℹ️  No known markets/orderbooks found in deployment; skipping OB grants/mapping");
  } else {
    // Optionally grant signer FACTORY_ROLE for mapping ops
    let signerHadFactory = false;
    try {
      signerHadFactory = await coreVault.hasRole(FACTORY_ROLE, await signer.getAddress());
      if (!args.skipMapping && !signerHadFactory) {
        console.log("🔓 Granting FACTORY_ROLE to signer for mapping operations...");
        await coreVault.grantRole(FACTORY_ROLE, await signer.getAddress());
        console.log("✅ FACTORY_ROLE granted to signer");
      }
    } catch (e) {
      console.log("⚠️  Could not grant FACTORY_ROLE to signer (mapping may fail):", e?.message || e);
    }

    for (const { orderBook, marketId, symbol } of entries) {
      const label = symbol ? `${symbol}` : marketId.slice(0, 10);
      // Grant roles to OB
      if (!args.skipObRoles) {
        try {
          if (!(await coreVault.hasRole(ORDERBOOK_ROLE, orderBook))) {
            console.log(`🔒 Granting ORDERBOOK_ROLE to ${label}:`, orderBook);
            await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
          }
          if (!args.noObSettlement && !(await coreVault.hasRole(SETTLEMENT_ROLE, orderBook))) {
            console.log(`🔒 Granting SETTLEMENT_ROLE to ${label}:`, orderBook);
            await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
          }
        } catch (e) {
          console.log(`⚠️  Could not grant roles to OB ${orderBook}:`, e?.message || e);
        }
      }
      // Register + assign mapping
      if (!args.skipMapping) {
        try {
          const isRegistered = await coreVault.registeredOrderBooks(orderBook);
          if (!isRegistered) {
            console.log(`🧾 registerOrderBook for ${label}:`, orderBook);
            await coreVault.registerOrderBook(orderBook);
          }
        } catch (e) {
          console.log(`⚠️  registerOrderBook failed for ${orderBook}:`, e?.message || e);
        }
        try {
          const mapped = await coreVault.marketToOrderBook(marketId);
          if (!mapped || mapped.toLowerCase() !== orderBook.toLowerCase()) {
            console.log(`🧭 assignMarketToOrderBook for ${label}: ${marketId} -> ${orderBook}`);
            await coreVault.assignMarketToOrderBook(marketId, orderBook);
          }
        } catch (e) {
          console.log(`⚠️  assignMarketToOrderBook failed for ${marketId}:`, e?.message || e);
        }
      }
    }

    // Revoke temporary FACTORY_ROLE on signer unless requested to keep
    if (!args.keepFactoryOnSigner && !signerHadFactory && !args.skipMapping) {
      try {
        console.log("🔐 Revoking FACTORY_ROLE from signer (cleanup)...");
        await coreVault.revokeRole(FACTORY_ROLE, await signer.getAddress());
        console.log("✅ FACTORY_ROLE revoked from signer");
      } catch (e) {
        console.log("⚠️  Could not revoke FACTORY_ROLE from signer:", e?.message || e);
      }
    }
  }

  console.log("\n✅ Role regrant complete.");
  console.log("─".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Regrant failed:", err?.message || err);
    process.exit(1);
  });


