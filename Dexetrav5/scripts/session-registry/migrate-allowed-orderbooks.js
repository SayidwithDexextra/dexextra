#!/usr/bin/env node

/**
 * migrate-allowed-orderbooks.js
 *
 * Allowlist all active OrderBook diamonds on a (new) GlobalSessionRegistry.
 *
 * Sources of orderbooks:
 *  1) Supabase markets table (preferred): requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *  2) Env list: ALLOWED_ORDERBOOKS="0x...,0x..."
 *
 * Target registry address:
 *  - SESSION_REGISTRY_ADDRESS or REGISTRY must be set (new V2 registry)
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid npx hardhat run Dexetrav5/scripts/session-registry/migrate-allowed-orderbooks.js --network hyperliquid
 *
 * Optional env:
 *   ONLY_CHAIN_ID=999
 *   DRY_RUN=true
 */

const { ethers } = require("hardhat");

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function parseList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadFromSupabase(chainId) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("market_address, chain_id, market_status, is_active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  const out = [];
  for (const row of data || []) {
    const addr = String(row.market_address || "").trim();
    if (!isAddress(addr)) continue;
    if (Number(row.chain_id) !== Number(chainId)) continue;
    if (!(row.is_active && row.market_status === "ACTIVE")) continue;
    out.push(addr);
  }
  return [...new Set(out.map((x) => x.toLowerCase()))];
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(process.env.ONLY_CHAIN_ID || net.chainId);
  const registryAddr = process.env.SESSION_REGISTRY_ADDRESS || process.env.REGISTRY || "";
  if (!isAddress(registryAddr)) throw new Error("Set SESSION_REGISTRY_ADDRESS (or REGISTRY) to the new GlobalSessionRegistry address");

  const dry = String(process.env.DRY_RUN || "false").toLowerCase() === "true";

  let orderbooks = await loadFromSupabase(chainId);
  if (!orderbooks || orderbooks.length === 0) {
    const envList = parseList(process.env.ALLOWED_ORDERBOOKS);
    orderbooks = envList.filter(isAddress).map((x) => x.toLowerCase());
  }
  if (!orderbooks || orderbooks.length === 0) throw new Error("No orderbooks found. Provide Supabase creds or ALLOWED_ORDERBOOKS.");

  console.log("");
  console.log("SessionRegistry allowlist migration");
  console.log("────────────────────────────────────────────────────────────");
  console.log("chainId:", chainId);
  console.log("registry:", registryAddr);
  console.log("orderbooks:", orderbooks.length);
  console.log("dryRun:", dry);
  console.log("────────────────────────────────────────────────────────────");

  const registry = await ethers.getContractAt(
    [
      "function allowedOrderbook(address) view returns (bool)",
      "function setAllowedOrderbook(address,bool) external",
    ],
    registryAddr
  );

  let changed = 0;
  for (const ob of orderbooks) {
    const addr = ethers.getAddress(ob);
    const already = await registry.allowedOrderbook(addr);
    if (already) {
      console.log("ℹ️  already allowed:", addr);
      continue;
    }
    if (dry) {
      console.log("DRY_RUN would allow:", addr);
      continue;
    }
    const tx = await registry.setAllowedOrderbook(addr, true);
    console.log("→ allow tx:", addr, tx.hash);
    await tx.wait();
    console.log("✅ allowed:", addr);
    changed++;
  }

  console.log("");
  console.log("Done. updated:", changed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





