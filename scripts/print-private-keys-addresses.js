#!/usr/bin/env node
/**
 * print-private-keys-addresses.js
 *
 * Reads an env file (default: .env.local) and prints:
 *   ENV_VAR_NAME => derived public address(es)
 *
 * It NEVER prints the private key values.
 *
 * Usage:
 *   node scripts/print-private-keys-addresses.js
 *   node scripts/print-private-keys-addresses.js path/to/.env.local
 *
 * Notes:
 * - Matches variables whose name contains "PRIVATE_KEY" (case-insensitive)
 * - Supports values wrapped in quotes and/or missing 0x prefix
 * - Supports comma-separated lists of keys in a single env var
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Wallet } = require("ethers");

function isHexPk(maybePk) {
  return typeof maybePk === "string" && /^0x[a-fA-F0-9]{64}$/.test(maybePk);
}

function normalizePk(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";

  // Strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (!v) return "";

  // Allow comma-separated keys
  // Normalization happens per-entry elsewhere.
  return v;
}

function splitCandidates(v) {
  const s = normalizePk(v);
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pkToAddress(candidate) {
  let pk = String(candidate || "").trim();
  if (!pk) return null;
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  if (!isHexPk(pk)) return null;
  try {
    return new Wallet(pk).address;
  } catch {
    return null;
  }
}

function padRight(str, len) {
  str = String(str || "");
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

async function main() {
  const inputPathArg = process.argv[2];
  const envPath = path.resolve(process.cwd(), inputPathArg || ".env.local");

  if (!fs.existsSync(envPath)) {
    console.error(`❌ Env file not found: ${envPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const parsed = dotenv.parse(raw);

  const keys = Object.keys(parsed).filter((k) => /private_key/i.test(k));
  if (!keys.length) {
    console.log(`No env vars matching /PRIVATE_KEY/i found in ${envPath}`);
    return;
  }

  // Header
  console.log(`\nEnv file: ${envPath}`);
  console.log(`Found ${keys.length} var(s) matching /PRIVATE_KEY/i.\n`);

  const nameWidth = Math.min(
    56,
    Math.max("ENV_VAR".length, ...keys.map((k) => k.length)) + 2
  );

  console.log(padRight("ENV_VAR", nameWidth), "PUBLIC_ADDRESS(ES)");
  console.log("-".repeat(nameWidth + 1 + 64));

  let totalAddrs = 0;
  let invalidCount = 0;

  for (const k of keys.sort()) {
    const candidates = splitCandidates(parsed[k]);
    const addrs = [];
    for (const c of candidates) {
      const addr = pkToAddress(c);
      if (addr) {
        addrs.push(addr);
      } else {
        invalidCount++;
      }
    }
    totalAddrs += addrs.length;
    const rhs = addrs.length ? addrs.join(", ") : "(invalid or empty)";
    console.log(padRight(k, nameWidth), rhs);
  }

  console.log(`\nSummary: ${totalAddrs} address(es) derived.`);
  if (invalidCount) {
    console.log(`Note: ${invalidCount} value(s) under PRIVATE_KEY vars were not valid 32-byte hex keys.`);
  }
}

main().catch((e) => {
  console.error("❌ Script failed:", e?.message || String(e));
  process.exit(1);
});

