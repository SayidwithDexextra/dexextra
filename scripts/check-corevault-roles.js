#!/usr/bin/env node

/**
 * Check CoreVault Roles for an OrderBook
 *
 * Verifies that the OrderBook address has:
 *  - ORDERBOOK_ROLE
 *  - SETTLEMENT_ROLE
 * on the CoreVault contract.
 *
 * Usage:
 *   node scripts/check-corevault-roles.js --coreVault 0x... --orderBook 0x... [--rpc https://...]
 *
 * Env fallbacks:
 *   CORE_VAULT_ADDRESS
 *   ORDERBOOK_ADDRESS (optional)
 *   RPC_URL (optional; defaults to http://localhost:8545)
 */

/* eslint-disable no-console */
const {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  stringToHex,
} = require("viem");
const fs = require("fs");
const path = require("path");
// Load env from .env.local or .env if present (user-preferred config source)
try {
  const envLocal = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envLocal)) {
    require("dotenv").config({ path: envLocal });
  } else {
    const env = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(env)) {
      require("dotenv").config({ path: env });
    } else {
      // Fallback: load default resolution if available
      require("dotenv").config();
    }
  }
} catch (_) {
  // Non-fatal; proceed with process.env as-is
}

// ---------- CLI args ----------
function getArg(flag) {
  const idx = process.argv.findIndex((a) => a === flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !process.argv[idx + 1].startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  const pref = `${flag}=`;
  const direct = process.argv.find((a) => a.startsWith(pref));
  if (direct) return direct.slice(pref.length);
  return undefined;
}

const rpcUrl =
  getArg("--rpc") || process.env.RPC_URL || "http://localhost:8545";
const coreVault = getArg("--coreVault") || process.env.CORE_VAULT_ADDRESS;
const orderBook = getArg("--orderBook") || process.env.ORDERBOOK_ADDRESS;

if (!coreVault) {
  console.error(
    "❌ Missing CoreVault address. Provide --coreVault 0x... or set CORE_VAULT_ADDRESS in env."
  );
  process.exit(1);
}

if (!orderBook) {
  console.error(
    "❌ Missing OrderBook address. Provide --orderBook 0x... or set ORDERBOOK_ADDRESS in env."
  );
  process.exit(1);
}

if (!isAddress(coreVault)) {
  console.error(`❌ Invalid CoreVault address: ${coreVault}`);
  process.exit(1);
}
if (!isAddress(orderBook)) {
  console.error(`❌ Invalid OrderBook address: ${orderBook}`);
  process.exit(1);
}

// ---------- Minimal AccessControl ABI ----------
const ACCESS_CONTROL_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
];

// Role identifiers (keccak256 of role names)
const ORDERBOOK_ROLE = keccak256(stringToHex("ORDERBOOK_ROLE"));
const SETTLEMENT_ROLE = keccak256(stringToHex("SETTLEMENT_ROLE"));

async function main() {
  console.log("🔍 Checking CoreVault roles for OrderBook\n");
  console.log("RPC URL        :", rpcUrl);
  console.log("CoreVault      :", coreVault);
  console.log("OrderBook      :", orderBook, "\n");

  const client = createPublicClient({ transport: http(rpcUrl) });

  try {
    const [hasOrderBookRole, hasSettlementRole] = await Promise.all([
      client.readContract({
        address: coreVault,
        abi: ACCESS_CONTROL_ABI,
        functionName: "hasRole",
        args: [ORDERBOOK_ROLE, orderBook],
      }),
      client.readContract({
        address: coreVault,
        abi: ACCESS_CONTROL_ABI,
        functionName: "hasRole",
        args: [SETTLEMENT_ROLE, orderBook],
      }),
    ]);

    console.log("Role hashes:");
    console.log("  ORDERBOOK_ROLE  :", ORDERBOOK_ROLE);
    console.log("  SETTLEMENT_ROLE :", SETTLEMENT_ROLE, "\n");

    const okOrderBook = Boolean(hasOrderBookRole);
    const okSettlement = Boolean(hasSettlementRole);

    console.log(
      `ORDERBOOK_ROLE  on CoreVault for OrderBook: ${
        okOrderBook ? "✅ PRESENT" : "❌ MISSING"
      }`
    );
    console.log(
      `SETTLEMENT_ROLE on CoreVault for OrderBook: ${
        okSettlement ? "✅ PRESENT" : "❌ MISSING"
      }`
    );

    console.log("\nDiagnosis:");
    if (!okSettlement) {
      console.log(
        "- Missing SETTLEMENT_ROLE will cause updateMarkPrice() to revert, breaking pokeLiquidations()."
      );
    }
    if (!okOrderBook) {
      console.log(
        "- Missing ORDERBOOK_ROLE will prevent position updates during liquidation/trade execution."
      );
    }
    if (okOrderBook && okSettlement) {
      console.log("- Both required roles are present.");
    }

    if (!okOrderBook || !okSettlement) {
      console.log("\nSuggested fix (requires CoreVault admin):");
      console.log(
        `cast send ${coreVault} "grantRole(bytes32,address)" ${
          okOrderBook ? SETTLEMENT_ROLE : ORDERBOOK_ROLE
        } ${orderBook} --rpc-url ${rpcUrl} --private-key $ADMIN_PK`
      );
      // Exit non-zero to signal missing roles in CI
      process.exit(2);
    }

    process.exit(0);
  } catch (e) {
    console.error(
      "\n❌ Error while checking roles:",
      e?.shortMessage || e?.message || String(e)
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ORDERBOOK_ROLE, SETTLEMENT_ROLE };
