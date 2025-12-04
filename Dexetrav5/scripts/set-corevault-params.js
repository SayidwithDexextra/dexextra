#!/usr/bin/env node

/**
 * Update CollateralHub to point to a new CoreVault and operator.
 *
 * Inputs (env or CLI flags):
 *   - COLLATERAL_HUB_ADDRESS (required)               --hub 0x...
 *   - CORE_VAULT_ADDRESS (required)                   --vault 0x...
 *   - CORE_VAULT_OPERATOR_ADDRESS (optional)          --operator 0x...
 *   - (role grant now unconditional)
 *
 * Usage:
 *   npx hardhat run scripts/set-corevault-params.js --network hyperliquid
 *   npx hardhat run scripts/set-corevault-params.js --network hyperliquid --hub 0x... --vault 0x... --operator 0x...
 */

const { ethers } = require("hardhat");
const path = require("path");

// Prefer .env.local, then fallback to default .env
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (key) => {
    const idx = argv.indexOf(key);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };
  return {
    hub:
      get("--hub") ||
      process.env.COLLATERAL_HUB_ADDRESS ||
      process.env.HUB_ADDRESS ||
      null,
    vault:
      get("--vault") ||
      process.env.CORE_VAULT_ADDRESS ||
      process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS ||
      null,
    operator:
      get("--operator") || process.env.CORE_VAULT_OPERATOR_ADDRESS || null,
  };
}

function isAddress(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.log(`Usage:
  # Set env in .env.local or pass flags:
  #   COLLATERAL_HUB_ADDRESS=0x...
  #   CORE_VAULT_ADDRESS=0x...
  #   CORE_VAULT_OPERATOR_ADDRESS=0x...   # optional; defaults to current hub operator
  #
  # Run:
  #   npx hardhat run scripts/set-corevault-params.js --network hyperliquid
  #   # or with flags:
  #   npx hardhat run scripts/set-corevault-params.js --network hyperliquid --hub 0x... --vault 0x... --operator 0x...
  `);
  process.exit(1);
}

async function main() {
  const args = parseArgs();
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";

  console.log("\n🔧 setCoreVaultParams()");
  console.log("─".repeat(72));
  console.log(`Network: ${networkName} (chainId ${network.chainId})`);
  console.log(`Signer:  ${await signer.getAddress()}`);

  if (!isAddress(args.hub)) usage("COLLATERAL_HUB_ADDRESS is required");
  if (!isAddress(args.vault)) usage("CORE_VAULT_ADDRESS is required");

  const hub = await ethers.getContractAt("CollateralHub", args.hub);

  // Verify signer has DEFAULT_ADMIN_ROLE on CollateralHub
  try {
    const isAdmin = await hub.hasRole(
      ethers.ZeroHash,
      await signer.getAddress()
    );
    if (!isAdmin) {
      throw new Error("Signer lacks DEFAULT_ADMIN_ROLE on CollateralHub");
    }
  } catch (e) {
    console.error("❌ Admin check failed on CollateralHub:", e?.message || e);
    process.exit(1);
  }

  // Determine operator: use provided or fall back to current
  let operator = args.operator;
  if (!operator) {
    try {
      operator = await hub.coreVaultOperator();
      console.log(`ℹ️  Using existing hub operator: ${operator}`);
    } catch (e) {
      console.log("⚠️  Could not read current operator; defaulting to signer");
      operator = await signer.getAddress();
    }
  }
  if (!isAddress(operator))
    usage(
      "Operator address is invalid (set CORE_VAULT_OPERATOR_ADDRESS or --operator 0x...)"
    );

  // Show current params
  try {
    const currentVault = await hub.coreVault();
    const currentOp = await hub.coreVaultOperator();
    console.log(`Current coreVault:        ${currentVault}`);
    console.log(`Current coreVaultOperator:${currentOp}`);
  } catch (_) {}

  console.log(
    `\n➡️  Updating CollateralHub.setCoreVaultParams(vault=${args.vault}, operator=${operator})`
  );
  try {
    const tx = await hub.setCoreVaultParams(args.vault, operator);
    console.log(`  ⛽ tx: ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`  ✅ updated in block ${rc?.blockNumber}`);
  } catch (e) {
    console.error("❌ setCoreVaultParams failed:", e?.message || e);
    process.exit(1);
  }

  // Grant EXTERNAL_CREDITOR_ROLE on CoreVault to CollateralHub (unconditional)
  console.log(
    "\n🔒 Grant EXTERNAL_CREDITOR_ROLE on CoreVault to CollateralHub"
  );
  const coreVault = await ethers.getContractAt("CoreVault", args.vault);
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE")
  );
  try {
    const already = await coreVault.hasRole(EXTERNAL_CREDITOR_ROLE, args.hub);
    if (already) {
      console.log("  ℹ️  Role already granted; skipping");
    } else {
      const tx = await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, args.hub);
      console.log(`  ⛽ tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`  ✅ role granted in block ${rc?.blockNumber}`);
    }
  } catch (e) {
    console.error("  ❌ grantRole failed:", e?.message || e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
