#!/usr/bin/env node

/**
 * grant-roles-orderbook.js
 *
 * Grants ORDERBOOK_ROLE and SETTLEMENT_ROLE on CoreVault to a specific OrderBook.
 * This is a minimal, idempotent helper to avoid rerunning the full create-market flow.
 *
 * Usage:
 *   npx hardhat --config Dexetrav5/hardhat.config.js run Dexetrav5/scripts/grant-roles-orderbook.js --network hyperliquid -- --orderbook 0x... [--corevault 0x...]
 *
 * Env fallbacks:
 *   CORE_VAULT_ADDRESS / NEXT_PUBLIC_CORE_VAULT_ADDRESS
 */

const { ethers } = require("hardhat");
const path = require("path");

// Load env from common locations
try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
  require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
} catch (_) {}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

async function bumpedOverrides() {
  const fee = await ethers.provider.getFeeData();
  const bump = (val) => (val ? val * 10n : null); // 10x
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: bump(fee.maxFeePerGas) || fee.maxFeePerGas,
      maxPriorityFeePerGas:
        bump(fee.maxPriorityFeePerGas) || fee.maxPriorityFeePerGas,
    };
  }
  const gp = fee.gasPrice || ethers.parseUnits("40", "gwei");
  const gasPrice = bump(gp) || gp;
  return { gasPrice };
}

async function main() {
  console.log("\n🔒 Grant CoreVault roles to OrderBook (targeted)");
  console.log("─".repeat(72));

  const orderBook =
    getArg("--orderbook", null) ||
    process.env.ORDERBOOK ||
    process.env.ORDERBOOK_ADDRESS ||
    process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS ||
    null;
  const coreVault =
    getArg("--corevault", null) ||
    process.env.CORE_VAULT_ADDRESS ||
    process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS ||
    null;

  if (!isAddress(orderBook)) {
    throw new Error("Provide --orderbook 0x... (target OrderBook address)");
  }
  if (!isAddress(coreVault)) {
    throw new Error(
      "CoreVault address missing. Set CORE_VAULT_ADDRESS or pass --corevault 0x..."
    );
  }

  const [signer] = await ethers.getSigners();
  const signerAddr = await signer.getAddress();
  console.log("👤 Signer:", signerAddr);
  console.log("🏦 CoreVault:", coreVault);
  console.log("📘 OrderBook:", orderBook);

  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );

  const cv = await ethers.getContractAt(
    [
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)",
    ],
    coreVault,
    signer
  );

  // Let provider pick nonce; we only bump fees heavily

  async function grant(role, label) {
    const already = await cv.hasRole(role, orderBook).catch(() => false);
    if (already) {
      console.log(`  ✅ ${label} already granted`);
      return;
    }
    const ov = await bumpedOverrides();
    const tx = await cv.grantRole(role, orderBook, ov);
    console.log(`  • grantRole(${label}) tx:`, tx.hash);
    const rc = await tx.wait();
    console.log(
      `  ✅ ${label} granted:`,
      rc?.hash || tx.hash,
      `block=${rc?.blockNumber ?? "?"}`
    );
  }

  await grant(ORDERBOOK_ROLE, "ORDERBOOK_ROLE");
  await grant(SETTLEMENT_ROLE, "SETTLEMENT_ROLE");

  console.log("🎉 Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});






