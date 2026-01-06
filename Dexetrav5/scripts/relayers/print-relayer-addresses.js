#!/usr/bin/env node

/**
 * Print relayer addresses derived from env key pools (no chain calls).
 *
 * This is a helper for ops: copy/paste addresses into role-grant scripts or dashboards.
 *
 * Supported env patterns (any combination):
 * - RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON='["0x...","0x..."]'
 * - RELAYER_PRIVATE_KEY_HUB_TRADE_0=0x...
 * - ... similarly for HUB_INBOX / SPOKE_OUTBOX_ARBITRUM / SPOKE_INBOX_ARBITRUM / SPOKE_OUTBOX_POLYGON / SPOKE_INBOX_POLYGON
 *
 * Usage:
 *   node Dexetrav5/scripts/relayers/print-relayer-addresses.js
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
require("dotenv").config();

async function main() {
  const { Wallet, getAddress } = await import("ethers");

  function normalizePk(pk) {
    const raw = String(pk || "").trim();
    if (!raw) return "";
    const v = raw.startsWith("0x") ? raw : `0x${raw}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return "";
    return v;
  }

  function parseJsonKeys(json) {
    try {
      const v = JSON.parse(json);
      if (!Array.isArray(v)) return [];
      return v.map((x) => String(x || "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  function loadPool(poolName, { jsonEnv, prefix, max = 50 }) {
    const keysRaw = [];
    if (jsonEnv) {
      const j = String(process.env[jsonEnv] || "").trim();
      if (j) keysRaw.push(...parseJsonKeys(j));
    }
    if (prefix) {
      for (let i = 0; i < max; i++) {
        const v = String(process.env[`${prefix}${i}`] || "").trim();
        if (v) keysRaw.push(v);
      }
    }
    // Back-compat: single key
    if (keysRaw.length === 0 && process.env.RELAYER_PRIVATE_KEY) {
      keysRaw.push(String(process.env.RELAYER_PRIVATE_KEY));
    }
    const addrs = [];
    for (const k of keysRaw) {
      const pk = normalizePk(k);
      if (!pk) continue;
      addrs.push(new Wallet(pk).address);
    }
    // de-dupe
    return Array.from(new Set(addrs.map((a) => a.toLowerCase()))).map((a) => {
      try {
        return getAddress(a);
      } catch {
        return a;
      }
    });
  }

  const pools = [
    ["hub_trade", { jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON", prefix: "RELAYER_PRIVATE_KEY_HUB_TRADE_" }],
    ["hub_inbox", { jsonEnv: "RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON", prefix: "RELAYER_PRIVATE_KEY_HUB_INBOX_" }],
    ["spoke_outbox_arbitrum", { jsonEnv: "RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_ARBITRUM_JSON", prefix: "RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_ARBITRUM_" }],
    ["spoke_inbox_arbitrum", { jsonEnv: "RELAYER_PRIVATE_KEYS_SPOKE_INBOX_ARBITRUM_JSON", prefix: "RELAYER_PRIVATE_KEY_SPOKE_INBOX_ARBITRUM_" }],
    ["spoke_outbox_polygon", { jsonEnv: "RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_POLYGON_JSON", prefix: "RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_POLYGON_" }],
    ["spoke_inbox_polygon", { jsonEnv: "RELAYER_PRIVATE_KEYS_SPOKE_INBOX_POLYGON_JSON", prefix: "RELAYER_PRIVATE_KEY_SPOKE_INBOX_POLYGON_" }],
  ];

  console.log("\nRelayer pools (addresses only):");
  console.log("─".repeat(60));
  for (const [name, cfg] of pools) {
    const addrs = loadPool(name, cfg);
    if (!addrs.length) {
      console.log(`${name}: (none)`);
      continue;
    }
    console.log(`${name}:`);
    for (const a of addrs) {
      console.log(`  - ${a}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});


