#!/usr/bin/env node

/**
 * Audit relayer pools and on-chain roles for the selected network.
 *
 * Hub (hyperliquid):
 *  - Checks HUB_INBOX BRIDGE_ENDPOINT_ROLE for hub_inbox relayers
 *  - Checks CollateralHub wiring roles (BRIDGE_INBOX_ROLE to inbox; EXTERNAL_CREDITOR_ROLE to hub on CoreVault)
 *
 * Spoke (arbitrum/polygon):
 *  - Checks SPOKE_OUTBOX DEPOSIT_SENDER_ROLE for spoke_outbox relayers
 *  - Checks SPOKE_INBOX BRIDGE_ENDPOINT_ROLE for spoke_inbox relayers
 *
 * Usage:
 *   npx hardhat run scripts/relayers/audit-relayer-permissions.js --network hyperliquid
 *   npx hardhat run scripts/relayers/audit-relayer-permissions.js --network arbitrum
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
  const isHub = !(tag === "POLYGON" || tag === "ARBITRUM");

  console.log("\n🧾 Relayer permissions audit");
  console.log("─".repeat(70));
  console.log(`Network: ${netName} (${tag})`);
  console.log(`Admin:   ${admin.address}`);

  if (isHub) {
    const hubInbox = process.env.HUB_INBOX_ADDRESS;
    const hubAddr = process.env.COLLATERAL_HUB_ADDRESS;
    const coreVault = process.env.CORE_VAULT_ADDRESS;
    if (!hubInbox || !ethers.isAddress(hubInbox)) throw new Error("HUB_INBOX_ADDRESS missing/invalid");
    if (!hubAddr || !ethers.isAddress(hubAddr)) throw new Error("COLLATERAL_HUB_ADDRESS missing/invalid");
    if (!coreVault || !ethers.isAddress(coreVault)) throw new Error("CORE_VAULT_ADDRESS missing/invalid");

    const relayers = loadKeyPoolAddresses({
      jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON",
      prefix: "RELAYER_PRIVATE_KEY_HUB_INBOX_",
    });
    console.log(`Hub inbox: ${hubInbox}`);
    console.log(`CollateralHub: ${hubAddr}`);
    console.log(`CoreVault: ${coreVault}`);
    console.log(`hub_inbox relayers: ${relayers.length}`);

    const inbox = await ethers.getContractAt("HubBridgeInboxWormhole", hubInbox, admin);
    const hub = await ethers.getContractAt("CollateralHub", hubAddr, admin);
    const vault = await ethers.getContractAt("CoreVault", coreVault, admin);

    const BRIDGE_ENDPOINT_ROLE = await inbox.BRIDGE_ENDPOINT_ROLE();
    const BRIDGE_INBOX_ROLE = await hub.BRIDGE_INBOX_ROLE();
    const EXTERNAL_CREDITOR_ROLE = await vault.EXTERNAL_CREDITOR_ROLE();

    for (const r of relayers) {
      const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, r);
      console.log(`- hub inbox BRIDGE_ENDPOINT_ROLE ${has ? "✅" : "❌"} ${r}`);
    }
    const hubInboxHas = await hub.hasRole(BRIDGE_INBOX_ROLE, hubInbox);
    console.log(`- CollateralHub.BRIDGE_INBOX_ROLE -> HUB_INBOX ${hubInboxHas ? "✅" : "❌"}`);
    const extCredHas = await vault.hasRole(EXTERNAL_CREDITOR_ROLE, hubAddr);
    console.log(`- CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub ${extCredHas ? "✅" : "❌"}`);
    return;
  }

  // Spoke
  const outboxAddr = process.env.SPOKE_OUTBOX_ADDRESS;
  const inboxAddr = process.env.SPOKE_INBOX_ADDRESS;
  if (!outboxAddr || !ethers.isAddress(outboxAddr)) throw new Error("SPOKE_OUTBOX_ADDRESS missing/invalid");
  if (!inboxAddr || !ethers.isAddress(inboxAddr)) throw new Error("SPOKE_INBOX_ADDRESS missing/invalid");

  const outboxRelayers = loadKeyPoolAddresses({
    jsonEnv: `RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_${tag}_JSON`,
    prefix: `RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_${tag}_`,
  });
  const inboxRelayers = loadKeyPoolAddresses({
    jsonEnv: `RELAYER_PRIVATE_KEYS_SPOKE_INBOX_${tag}_JSON`,
    prefix: `RELAYER_PRIVATE_KEY_SPOKE_INBOX_${tag}_`,
  });

  console.log(`Spoke outbox: ${outboxAddr}`);
  console.log(`Spoke inbox:  ${inboxAddr}`);
  console.log(`spoke_outbox relayers: ${outboxRelayers.length}`);
  console.log(`spoke_inbox relayers:  ${inboxRelayers.length}`);

  const outbox = await ethers.getContractAt("SpokeBridgeOutboxWormhole", outboxAddr, admin);
  const inbox = await ethers.getContractAt("SpokeBridgeInboxWormhole", inboxAddr, admin);
  const DEPOSIT_SENDER_ROLE = await outbox.DEPOSIT_SENDER_ROLE();
  const BRIDGE_ENDPOINT_ROLE = await inbox.BRIDGE_ENDPOINT_ROLE();

  for (const r of outboxRelayers) {
    const has = await outbox.hasRole(DEPOSIT_SENDER_ROLE, r);
    console.log(`- spoke outbox DEPOSIT_SENDER_ROLE ${has ? "✅" : "❌"} ${r}`);
  }
  for (const r of inboxRelayers) {
    const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, r);
    console.log(`- spoke inbox BRIDGE_ENDPOINT_ROLE ${has ? "✅" : "❌"} ${r}`);
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});





