#!/usr/bin/env node

/**
 * Grant all on-chain roles needed for cross-chain withdrawals.
 *
 * The cross-chain withdraw API route (src/app/api/withdraw/cross-chain/route.ts)
 * executes three steps, each requiring a specific role:
 *
 *  1. CollateralHub.requestWithdraw  → needs WITHDRAW_REQUESTER_ROLE  (hub chain)
 *  2. HubBridgeOutbox.sendWithdraw   → needs WITHDRAW_SENDER_ROLE    (hub chain)
 *  3. SpokeBridgeInbox.receiveMessage→ needs BRIDGE_ENDPOINT_ROLE    (spoke chain)
 *
 * Steps 1 & 2 use the `hub_inbox` relayer pool.
 * Step 3 uses `spoke_inbox_polygon` or `spoke_inbox_arbitrum`.
 *
 * Usage:
 *   # Hub roles (run on hyperliquid):
 *   npx hardhat run scripts/relayers/grant-cross-chain-withdraw-roles.js --network hyperliquid
 *
 *   # Spoke roles (run on each spoke):
 *   npx hardhat run scripts/relayers/grant-cross-chain-withdraw-roles.js --network arbitrum
 *   npx hardhat run scripts/relayers/grant-cross-chain-withdraw-roles.js --network polygon
 *
 * Env:
 *   COLLATERAL_HUB_ADDRESS, HUB_OUTBOX_ADDRESS           (hub)
 *   SPOKE_INBOX_ADDRESS / SPOKE_INBOX_ADDRESS_<TAG>       (spoke)
 *
 *   Relayer keys (same pools the API route uses):
 *     RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON / RELAYER_PRIVATE_KEY_HUB_INBOX_*
 *     RELAYER_PRIVATE_KEYS_SPOKE_INBOX_<TAG>_JSON / RELAYER_PRIVATE_KEY_SPOKE_INBOX_<TAG>_*
 *     Fallback: RELAYER_PRIVATE_KEY (single key)
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

function loadKeyPoolAddresses({ jsonEnv, prefix, max = 50 }) {
  const keys = [];
  const j = String(process.env[jsonEnv] || "").trim();
  if (j) keys.push(...parseJsonKeys(j));
  for (let i = 0; i < max; i++) {
    const v = String(process.env[`${prefix}${i}`] || "").trim();
    if (v) keys.push(v);
  }
  if (keys.length === 0 && process.env.RELAYER_PRIVATE_KEY) {
    keys.push(String(process.env.RELAYER_PRIVATE_KEY));
  }

  const addrs = [];
  for (const k of keys) {
    const pk = normalizePk(k);
    if (!pk) continue;
    addrs.push(new ethers.Wallet(pk).address);
  }
  return Array.from(new Set(addrs.map((a) => a.toLowerCase()))).map((a) =>
    ethers.getAddress(a)
  );
}

function upperTagFromNetwork(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai")) return "POLYGON";
  if (n.includes("arbitrum")) return "ARBITRUM";
  return n.toUpperCase();
}

async function grantIfNeeded(contract, contractName, roleName, roleHash, relayerAddr, admin) {
  const has = await contract.hasRole(roleHash, relayerAddr);
  if (has) {
    console.log(`  skip  ${contractName}.${roleName} → ${relayerAddr} (already granted)`);
    return;
  }
  const tx = await contract.connect(admin).grantRole(roleHash, relayerAddr);
  await tx.wait();
  console.log(`  grant ${contractName}.${roleName} → ${relayerAddr} (tx ${tx.hash})`);
}

async function main() {
  const [admin] = await ethers.getSigners();
  const netName = hre.network.name;
  const tag = upperTagFromNetwork(netName);
  const isHub = !(tag === "POLYGON" || tag === "ARBITRUM");

  console.log("\n=== Cross-Chain Withdraw Role Grants ===");
  console.log(`Network: ${netName} (${tag})`);
  console.log(`Admin:   ${admin.address}`);
  console.log();

  if (isHub) {
    // --- Hub chain: grant roles on CollateralHub and HubBridgeOutbox ---

    // Load hub_inbox relayer addresses (same pool the API route uses)
    const relayers = loadKeyPoolAddresses({
      jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON",
      prefix: "RELAYER_PRIVATE_KEY_HUB_INBOX_",
    });
    if (relayers.length === 0) {
      throw new Error(
        "No hub_inbox relayer keys found. Set RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON or RELAYER_PRIVATE_KEY_HUB_INBOX_* or RELAYER_PRIVATE_KEY"
      );
    }
    console.log(`Hub relayers: ${relayers.join(", ")}\n`);

    // 1. CollateralHub.WITHDRAW_REQUESTER_ROLE
    const hubAddr = process.env.COLLATERAL_HUB_ADDRESS;
    if (!hubAddr || !ethers.isAddress(hubAddr)) {
      throw new Error("COLLATERAL_HUB_ADDRESS is required");
    }
    const hub = await ethers.getContractAt("CollateralHub", hubAddr, admin);
    const withdrawRequesterRole = await hub.WITHDRAW_REQUESTER_ROLE();
    console.log("[CollateralHub] WITHDRAW_REQUESTER_ROLE");
    for (const r of relayers) {
      await grantIfNeeded(hub, "CollateralHub", "WITHDRAW_REQUESTER_ROLE", withdrawRequesterRole, r, admin);
    }

    // 2. HubBridgeOutbox.WITHDRAW_SENDER_ROLE
    const outboxAddr = process.env.HUB_OUTBOX_ADDRESS;
    if (outboxAddr && ethers.isAddress(outboxAddr)) {
      const outbox = await ethers.getContractAt("HubBridgeOutboxWormhole", outboxAddr, admin);
      const withdrawSenderRole = await outbox.WITHDRAW_SENDER_ROLE();
      console.log("\n[HubBridgeOutbox] WITHDRAW_SENDER_ROLE");
      for (const r of relayers) {
        await grantIfNeeded(outbox, "HubBridgeOutbox", "WITHDRAW_SENDER_ROLE", withdrawSenderRole, r, admin);
      }
    } else {
      console.log("\nHUB_OUTBOX_ADDRESS not set; skipping WITHDRAW_SENDER_ROLE grants.");
    }

    console.log("\nHub grants complete.");
  } else {
    // --- Spoke chain: grant BRIDGE_ENDPOINT_ROLE on SpokeBridgeInbox ---

    const inboxAddr =
      process.env[`SPOKE_INBOX_ADDRESS_${tag}`] ||
      process.env.SPOKE_INBOX_ADDRESS ||
      "";
    if (!inboxAddr || !ethers.isAddress(inboxAddr)) {
      throw new Error(
        `SPOKE_INBOX_ADDRESS_${tag} or SPOKE_INBOX_ADDRESS is required on ${tag} network`
      );
    }

    const relayers = loadKeyPoolAddresses({
      jsonEnv: `RELAYER_PRIVATE_KEYS_SPOKE_INBOX_${tag}_JSON`,
      prefix: `RELAYER_PRIVATE_KEY_SPOKE_INBOX_${tag}_`,
    });
    if (relayers.length === 0) {
      throw new Error(
        `No spoke_inbox_${tag.toLowerCase()} relayer keys found. Set RELAYER_PRIVATE_KEYS_SPOKE_INBOX_${tag}_JSON or RELAYER_PRIVATE_KEY_SPOKE_INBOX_${tag}_* or RELAYER_PRIVATE_KEY`
      );
    }
    console.log(`Spoke relayers: ${relayers.join(", ")}\n`);

    const inbox = await ethers.getContractAt("SpokeBridgeInboxWormhole", inboxAddr, admin);
    const bridgeEndpointRole = await inbox.BRIDGE_ENDPOINT_ROLE();
    console.log(`[SpokeBridgeInbox @ ${inboxAddr}] BRIDGE_ENDPOINT_ROLE`);
    for (const r of relayers) {
      await grantIfNeeded(inbox, "SpokeBridgeInbox", "BRIDGE_ENDPOINT_ROLE", bridgeEndpointRole, r, admin);
    }

    console.log("\nSpoke grants complete.");
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
