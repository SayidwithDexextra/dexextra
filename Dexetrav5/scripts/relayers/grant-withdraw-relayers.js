#!/usr/bin/env node

/**
 * Batch grant relayer roles needed for withdrawals.
 *
 * What it grants:
 * - Spoke inbox: BRIDGE_ENDPOINT_ROLE to each configured spoke-inbox relayer address
 * - Hub (optional): CollateralHub.WITHDRAW_REQUESTER_ROLE to configured hub withdraw relayers
 *
 * Usage:
 *   # Spoke delivery role
 *   npx hardhat run scripts/relayers/grant-withdraw-relayers.js --network arbitrum
 *
 *   # Hub withdraw requester role (optional)
 *   npx hardhat run scripts/relayers/grant-withdraw-relayers.js --network hyperliquid
 *
 * Env:
 *  - Spoke:
 *    - SPOKE_INBOX_ADDRESS
 *    - RELAYER_PRIVATE_KEY_SPOKE_INBOX_<TAG>_0..N or RELAYER_PRIVATE_KEYS_SPOKE_INBOX_<TAG>_JSON
 *  - Hub:
 *    - COLLATERAL_HUB_ADDRESS
 *    - RELAYER_PRIVATE_KEY_HUB_WITHDRAW_0..N or RELAYER_PRIVATE_KEYS_HUB_WITHDRAW_JSON
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
require("dotenv").config();

const hre = require("hardhat");
const { ethers } = hre;

function parseJsonKeys(json) {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizePk(pk) {
  const raw = String(pk || "").trim();
  if (!raw) return "";
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return "";
  return v;
}

function upperTagFromNetwork(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai")) return "POLYGON";
  if (n.includes("arbitrum")) return "ARBITRUM";
  return n.toUpperCase();
}

function loadKeyPoolAddresses({ jsonEnv, prefix, max = 50 }) {
  const keys = [];
  const j = String(process.env[jsonEnv] || "").trim();
  if (j) keys.push(...parseJsonKeys(j));
  for (let i = 0; i < max; i++) {
    const v = String(process.env[`${prefix}${i}`] || "").trim();
    if (v) keys.push(v);
  }
  if (keys.length === 0 && process.env.RELAYER_PRIVATE_KEY) keys.push(String(process.env.RELAYER_PRIVATE_KEY));

  const addrs = [];
  for (const k of keys) {
    const pk = normalizePk(k);
    if (!pk) continue;
    addrs.push(new ethers.Wallet(pk).address);
  }
  return Array.from(new Set(addrs.map((a) => a.toLowerCase()))).map((a) => ethers.getAddress(a));
}

async function main() {
  const [admin] = await ethers.getSigners();
  const netName = hre.network.name;
  const tag = upperTagFromNetwork(netName);

  console.log("\n🔐 Grant withdraw relayer roles");
  console.log("─".repeat(60));
  console.log(`Network: ${netName} (${tag})`);
  console.log(`Admin:   ${admin.address}`);

  const isHub = !(tag === "POLYGON" || tag === "ARBITRUM");
  if (isHub) {
    const hubAddr = process.env.COLLATERAL_HUB_ADDRESS;
    if (!hubAddr || !ethers.isAddress(hubAddr)) {
      throw new Error("COLLATERAL_HUB_ADDRESS is required on hub network");
    }
    const relayers = loadKeyPoolAddresses({
      jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_WITHDRAW_JSON",
      prefix: "RELAYER_PRIVATE_KEY_HUB_WITHDRAW_",
    });
    if (relayers.length === 0) {
      console.log("ℹ️ No hub withdraw relayer keys configured; skipping WITHDRAW_REQUESTER_ROLE grants.");
      return;
    }
    const hub = await ethers.getContractAt("CollateralHub", hubAddr, admin);
    const role = await hub.WITHDRAW_REQUESTER_ROLE();
    for (const r of relayers) {
      const has = await hub.hasRole(role, r);
      if (has) {
        console.log(`  ℹ️ already has WITHDRAW_REQUESTER_ROLE: ${r}`);
        continue;
      }
      const tx = await hub.grantRole(role, r);
      await tx.wait();
      console.log(`  ✅ granted WITHDRAW_REQUESTER_ROLE: ${r} (tx ${tx.hash})`);
    }
    return;
  }

  // Spoke mode: grant BRIDGE_ENDPOINT_ROLE on spoke inbox
  const inboxAddr = process.env.SPOKE_INBOX_ADDRESS;
  if (!inboxAddr || !ethers.isAddress(inboxAddr)) {
    throw new Error("SPOKE_INBOX_ADDRESS is required on spoke network");
  }
  const jsonEnv = `RELAYER_PRIVATE_KEYS_SPOKE_INBOX_${tag}_JSON`;
  const prefix = `RELAYER_PRIVATE_KEY_SPOKE_INBOX_${tag}_`;
  const relayers = loadKeyPoolAddresses({ jsonEnv, prefix });
  if (relayers.length === 0) throw new Error(`No spoke inbox relayer keys configured (${prefix}*)`);

  const inbox = await ethers.getContractAt("SpokeBridgeInboxWormhole", inboxAddr, admin);
  const role = await inbox.BRIDGE_ENDPOINT_ROLE();
  for (const r of relayers) {
    const has = await inbox.hasRole(role, r);
    if (has) {
      console.log(`  ℹ️ already has BRIDGE_ENDPOINT_ROLE: ${r}`);
      continue;
    }
    const tx = await inbox.grantRole(role, r);
    await tx.wait();
    console.log(`  ✅ granted BRIDGE_ENDPOINT_ROLE: ${r} (tx ${tx.hash})`);
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});




