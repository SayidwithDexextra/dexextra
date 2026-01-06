#!/usr/bin/env node

/**
 * Batch grant relayer roles needed for deposits (and optionally withdraw delivery).
 *
 * What it grants:
 * - Spoke outbox: DEPOSIT_SENDER_ROLE to each configured spoke-outbox relayer address
 * - Hub inbox: BRIDGE_ENDPOINT_ROLE to each configured hub-inbox relayer address
 *
 * It derives addresses from env key pools (does NOT read private keys from disk).
 *
 * Usage examples:
 *   # Arbitrum spoke publish role
 *   npx hardhat run scripts/relayers/grant-deposit-relayers.js --network arbitrum
 *
 *   # Hub inbox endpoint role
 *   npx hardhat run scripts/relayers/grant-deposit-relayers.js --network hyperliquid
 *
 * Env (repo root .env.local preferred):
 *  - Hub:
 *    - HUB_INBOX_ADDRESS
 *    - RELAYER_PRIVATE_KEY_HUB_INBOX_0..N or RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON
 *  - Spoke:
 *    - SPOKE_OUTBOX_ADDRESS
 *    - RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_<TAG>_0..N or RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_<TAG>_JSON
 *    - where TAG is ARBITRUM or POLYGON depending on --network
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
  // Back-compat
  if (keys.length === 0 && process.env.RELAYER_PRIVATE_KEY) keys.push(String(process.env.RELAYER_PRIVATE_KEY));

  const addrs = [];
  for (const k of keys) {
    const pk = normalizePk(k);
    if (!pk) continue;
    addrs.push(new ethers.Wallet(pk).address);
  }
  // de-dupe + checksum
  return Array.from(new Set(addrs.map((a) => a.toLowerCase()))).map((a) => ethers.getAddress(a));
}

async function main() {
  const [admin] = await ethers.getSigners();
  const netName = hre.network.name;
  const tag = upperTagFromNetwork(netName);

  console.log("\n🔐 Grant deposit relayer roles");
  console.log("─".repeat(60));
  console.log(`Network: ${netName} (${tag})`);
  console.log(`Admin:   ${admin.address}`);

  const isHub = !(tag === "POLYGON" || tag === "ARBITRUM");

  if (isHub) {
    const hubInbox = process.env.HUB_INBOX_ADDRESS;
    if (!hubInbox || !ethers.isAddress(hubInbox)) {
      throw new Error("HUB_INBOX_ADDRESS is required on hub network");
    }
    const relayers = loadKeyPoolAddresses({
      jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON",
      prefix: "RELAYER_PRIVATE_KEY_HUB_INBOX_",
    });
    if (relayers.length === 0) throw new Error("No hub inbox relayer keys configured (RELAYER_PRIVATE_KEY_HUB_INBOX_*)");

    console.log(`Hub inbox: ${hubInbox}`);
    console.log(`Relayers:  ${relayers.length}`);

    const inbox = await ethers.getContractAt("HubBridgeInboxWormhole", hubInbox, admin);
    const BRIDGE_ENDPOINT_ROLE = await inbox.BRIDGE_ENDPOINT_ROLE();
    for (const r of relayers) {
      const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, r);
      if (has) {
        console.log(`  ℹ️ already has BRIDGE_ENDPOINT_ROLE: ${r}`);
        continue;
      }
      const tx = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, r);
      await tx.wait();
      console.log(`  ✅ granted BRIDGE_ENDPOINT_ROLE: ${r} (tx ${tx.hash})`);
    }
    return;
  }

  // Spoke mode: grant DEPOSIT_SENDER_ROLE on the current network's outbox
  const outboxAddr = process.env.SPOKE_OUTBOX_ADDRESS;
  if (!outboxAddr || !ethers.isAddress(outboxAddr)) {
    throw new Error("SPOKE_OUTBOX_ADDRESS is required on spoke network");
  }
  const jsonEnv = `RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_${tag}_JSON`;
  const prefix = `RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_${tag}_`;
  const relayers = loadKeyPoolAddresses({ jsonEnv, prefix });
  if (relayers.length === 0) throw new Error(`No spoke outbox relayer keys configured (${prefix}*)`);

  console.log(`Spoke outbox: ${outboxAddr}`);
  console.log(`Relayers:     ${relayers.length}`);

  const outbox = await ethers.getContractAt("SpokeBridgeOutboxWormhole", outboxAddr, admin);
  const DEPOSIT_SENDER_ROLE = await outbox.DEPOSIT_SENDER_ROLE();
  for (const r of relayers) {
    const has = await outbox.hasRole(DEPOSIT_SENDER_ROLE, r);
    if (has) {
      console.log(`  ℹ️ already has DEPOSIT_SENDER_ROLE: ${r}`);
      continue;
    }
    const tx = await outbox.grantRole(DEPOSIT_SENDER_ROLE, r);
    await tx.wait();
    console.log(`  ✅ granted DEPOSIT_SENDER_ROLE: ${r} (tx ${tx.hash})`);
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});




