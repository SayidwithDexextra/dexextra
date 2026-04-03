#!/usr/bin/env node

/**
 * sweep-orderbook-roles.js
 *
 * Sweeps all markets (most-recent first) and ensures each OrderBook has:
 *   1. ORDERBOOK_ROLE on the current CoreVault
 *   2. SETTLEMENT_ROLE on the current CoreVault
 *   3. Is registered via registeredOrderBooks()
 *   4. Has a correct marketToOrderBook() mapping
 *
 * Dry-run by default. Pass --fix to actually send transactions.
 *
 * Usage:
 *   node scripts/sweep-orderbook-roles.js                  # dry-run audit
 *   node scripts/sweep-orderbook-roles.js --fix            # grant missing roles + register
 *   node scripts/sweep-orderbook-roles.js --fix --limit 10 # only process 10 most recent
 */

const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") }); } catch (_) {}
try { require("dotenv").config({ path: path.resolve(__dirname, "../.env") }); } catch (_) {}

// ── CLI args ──
function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const DRY_RUN = !process.argv.includes("--fix");
const LIMIT = parseInt(getArg("--limit", "0"), 10) || 0;
const VERBOSE = process.argv.includes("--verbose");

// ── Env ──
const RPC_URL = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY;
const CORE_VAULT = process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
const FACTORY_ADDR = process.env.FUTURES_MARKET_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!RPC_URL) { console.error("❌ RPC_URL not set"); process.exit(1); }
if (!ADMIN_PK) { console.error("❌ ADMIN_PRIVATE_KEY not set"); process.exit(1); }
if (!CORE_VAULT || !ethers.isAddress(CORE_VAULT)) { console.error("❌ CORE_VAULT_ADDRESS not set or invalid"); process.exit(1); }
if (!SB_URL || !SB_KEY) { console.error("❌ Supabase credentials not set"); process.exit(1); }

// ── Role hashes ──
const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));

const CORE_VAULT_ABI = [
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address)",
  "function registeredOrderBooks(address) view returns (bool)",
  "function marketToOrderBook(bytes32) view returns (address)",
  "function registerOrderBook(address)",
  "function assignMarketToOrderBook(bytes32,address)",
];

const OB_STORAGE_SLOT = ethers.keccak256(ethers.toUtf8Bytes("hyperliquid.orderbook.storage.v1"));
const SET_VAULT_ABI = ["function setVault(address newVault)"];

const ZERO = ethers.ZeroAddress;

async function getTxOverrides(provider) {
  try {
    const fee = await provider.getFeeData();
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: fee.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas * 2n,
      };
    }
    const gp = fee.gasPrice || ethers.parseUnits("1", "gwei");
    return { gasPrice: (gp * 15n) / 10n };
  } catch {
    return { gasPrice: ethers.parseUnits("1", "gwei") };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          OrderBook Role & Registration Sweep                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Mode:       ${DRY_RUN ? "🔍 DRY RUN (pass --fix to apply)" : "🔧 FIX MODE"}`);
  console.log(`  CoreVault:  ${CORE_VAULT}`);
  console.log(`  Factory:    ${FACTORY_ADDR || "(not set)"}`);
  if (LIMIT) console.log(`  Limit:      ${LIMIT} markets`);
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PK, provider);
  const signerAddr = await wallet.getAddress();
  console.log(`  Signer:     ${signerAddr}`);

  // Verify factory vault matches env
  if (FACTORY_ADDR && ethers.isAddress(FACTORY_ADDR)) {
    try {
      const factory = new ethers.Contract(FACTORY_ADDR, ["function vault() view returns (address)"], provider);
      const factoryVault = await factory.vault();
      const match = factoryVault.toLowerCase() === CORE_VAULT.toLowerCase();
      console.log(`  Factory →   ${factoryVault} ${match ? "✅ matches" : "⚠️  MISMATCH"}`);
      if (!match) {
        console.log(`              Env CoreVault and factory vault differ!`);
        console.log(`              Consider running: factory.updateVault(${CORE_VAULT})`);
      }
    } catch (e) {
      console.log(`  Factory →   ⚠️  Could not query vault(): ${e.message}`);
    }
  }
  console.log();

  const vault = new ethers.Contract(CORE_VAULT, CORE_VAULT_ABI, wallet);

  // Check if signer has DEFAULT_ADMIN_ROLE on the vault
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const isAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, signerAddr).catch(() => false);
  if (!isAdmin) {
    console.warn("⚠️  Signer does not have DEFAULT_ADMIN_ROLE on CoreVault — role grants will fail");
  }

  // ── Fetch markets from Supabase ──
  const supabase = createClient(SB_URL, SB_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let allMarkets = [];
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const { data, error } = await supabase
      .from("markets")
      .select("id, symbol, market_identifier, market_address, market_id_bytes32, market_status, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) { console.error("❌ Supabase fetch error:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allMarkets = allMarkets.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`📊 Fetched ${allMarkets.length} markets from Supabase (newest first)`);
  console.log();

  const markets = allMarkets.filter((m) => m.market_address && ethers.isAddress(m.market_address));
  console.log(`📋 ${markets.length} markets have valid on-chain addresses`);
  if (LIMIT && markets.length > LIMIT) {
    markets.length = LIMIT;
    console.log(`   (limited to ${LIMIT})`);
  }
  console.log();

  // ── Sweep ──
  const stats = { total: 0, ok: 0, fixed: 0, errors: 0, needsFix: 0 };
  const issues = [];

  // Check if we need FACTORY_ROLE for registration (check once, grant if needed)
  let hasFactoryRole = false;
  let grantedFactoryRole = false;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const ob = m.market_address;
    const marketId = m.market_id_bytes32;
    const label = m.symbol || m.market_identifier || m.id;
    stats.total++;

    const pad = String(i + 1).padStart(3, " ");
    const prefix = `[${pad}/${markets.length}] ${label}`;

    try {
      // Parallel reads for speed (includes OB internal vault check)
      const checks = await Promise.all([
        vault.hasRole(ORDERBOOK_ROLE, ob).catch(() => null),
        vault.hasRole(SETTLEMENT_ROLE, ob).catch(() => null),
        vault.registeredOrderBooks(ob).catch(() => null),
        marketId ? vault.marketToOrderBook(marketId).catch(() => null) : Promise.resolve("skip"),
        provider.getCode(ob).catch(() => "0x"),
        provider.getStorage(ob, OB_STORAGE_SLOT).catch(() => null),
      ]);

      const [hasOBRole, hasSettleRole, isRegistered, mappedOB, code, rawVaultSlot] = checks;
      const hasCode = code && code !== "0x";

      if (!hasCode) {
        if (VERBOSE) console.log(`${prefix}  ⏭️  no code at ${ob.slice(0, 10)}… — skipping`);
        continue;
      }

      // Extract OB's internal vault from storage slot
      let obInternalVault = null;
      if (rawVaultSlot && rawVaultSlot.length >= 42) {
        obInternalVault = "0x" + rawVaultSlot.slice(26);
      }
      const vaultNeedsRepoint = obInternalVault &&
        obInternalVault.toLowerCase() !== ZERO &&
        obInternalVault.toLowerCase() !== CORE_VAULT.toLowerCase();

      const roleMissing = hasOBRole === false || hasSettleRole === false;
      const regMissing = isRegistered === false;
      const mapWrong = mappedOB !== "skip" && mappedOB && mappedOB.toLowerCase() !== ob.toLowerCase();
      const mapMissing = mappedOB !== "skip" && (!mappedOB || mappedOB === ZERO);

      if (!roleMissing && !regMissing && !mapMissing && !mapWrong && !vaultNeedsRepoint) {
        if (VERBOSE) console.log(`${prefix}  ✅ all good`);
        stats.ok++;
        continue;
      }

      // Report issues
      const parts = [];
      if (vaultNeedsRepoint) parts.push(`vault→${obInternalVault?.slice(0, 10)}… (need ${CORE_VAULT.slice(0, 10)}…)`);
      if (hasOBRole === false) parts.push("ORDERBOOK_ROLE");
      if (hasSettleRole === false) parts.push("SETTLEMENT_ROLE");
      if (regMissing) parts.push("not registered");
      if (mapMissing) parts.push("no market mapping");
      if (mapWrong) parts.push(`mapping → ${mappedOB?.slice(0, 10)}… (expected ${ob.slice(0, 10)}…)`);

      console.log(`${prefix}  ❌ ${parts.join(" | ")}  [${ob.slice(0, 10)}…]`);
      issues.push({ label, ob, marketId, hasOBRole, hasSettleRole, isRegistered, mapMissing, mapWrong });
      stats.needsFix++;

      if (DRY_RUN) continue;

      // ── Fix: repoint OB internal vault ──
      if (vaultNeedsRepoint) {
        try {
          const obContract = new ethers.Contract(ob, SET_VAULT_ABI, wallet);
          const ov = await getTxOverrides(provider);
          const tx = await obContract.setVault(CORE_VAULT, ov);
          console.log(`          → setVault(${CORE_VAULT.slice(0, 10)}…) tx: ${tx.hash.slice(0, 18)}…`);
          await tx.wait();
          console.log(`          ✅ vault repointed`);
          stats.fixed++;
        } catch (e) {
          const msg = e?.shortMessage || e?.message || String(e);
          console.log(`          ⚠️  setVault failed: ${msg.slice(0, 120)}`);
        }
      }

      // ── Fix: grant missing roles ──
      if (hasOBRole === false) {
        const ov = await getTxOverrides(provider);
        const tx = await vault.grantRole(ORDERBOOK_ROLE, ob, ov);
        console.log(`          → grantRole(ORDERBOOK_ROLE) tx: ${tx.hash.slice(0, 18)}…`);
        await tx.wait();
        console.log(`          ✅ ORDERBOOK_ROLE granted`);
        stats.fixed++;
      }
      if (hasSettleRole === false) {
        const ov = await getTxOverrides(provider);
        const tx = await vault.grantRole(SETTLEMENT_ROLE, ob, ov);
        console.log(`          → grantRole(SETTLEMENT_ROLE) tx: ${tx.hash.slice(0, 18)}…`);
        await tx.wait();
        console.log(`          ✅ SETTLEMENT_ROLE granted`);
        stats.fixed++;
      }

      // ── Fix: register + map (needs FACTORY_ROLE) ──
      if (regMissing || mapMissing) {
        if (!hasFactoryRole) {
          hasFactoryRole = await vault.hasRole(FACTORY_ROLE, signerAddr).catch(() => false);
        }

        if (!hasFactoryRole && !grantedFactoryRole) {
          console.log(`          → granting temporary FACTORY_ROLE to signer…`);
          const ov = await getTxOverrides(provider);
          const tx = await vault.grantRole(FACTORY_ROLE, signerAddr, ov);
          await tx.wait();
          hasFactoryRole = true;
          grantedFactoryRole = true;
          console.log(`          ✅ FACTORY_ROLE granted to signer`);
        }

        if (hasFactoryRole) {
          if (regMissing) {
            try {
              const ov = await getTxOverrides(provider);
              const tx = await vault.registerOrderBook(ob, ov);
              console.log(`          → registerOrderBook tx: ${tx.hash.slice(0, 18)}…`);
              await tx.wait();
              console.log(`          ✅ registered`);
              stats.fixed++;
            } catch (e) {
              const msg = e?.shortMessage || e?.message || String(e);
              if (/AlreadyReserved/i.test(msg)) {
                console.log(`          ℹ️  already registered (stale read)`);
              } else {
                console.log(`          ⚠️  registerOrderBook failed: ${msg.slice(0, 100)}`);
              }
            }
          }
          if (mapMissing && marketId) {
            try {
              const ov = await getTxOverrides(provider);
              const tx = await vault.assignMarketToOrderBook(marketId, ob, ov);
              console.log(`          → assignMarketToOrderBook tx: ${tx.hash.slice(0, 18)}…`);
              await tx.wait();
              console.log(`          ✅ mapped`);
              stats.fixed++;
            } catch (e) {
              const msg = e?.shortMessage || e?.message || String(e);
              if (/AlreadyReserved/i.test(msg)) {
                console.log(`          ℹ️  already mapped (stale read)`);
              } else if (/UnauthorizedOrderBook/i.test(msg)) {
                console.log(`          ⚠️  mapping failed: OB not registered on vault`);
              } else {
                console.log(`          ⚠️  assignMarketToOrderBook failed: ${msg.slice(0, 100)}`);
              }
            }
          }
        } else {
          console.log(`          ⚠️  cannot register/map: no FACTORY_ROLE and unable to grant`);
        }
      }
    } catch (e) {
      console.log(`${prefix}  💥 error: ${(e.shortMessage || e.message || String(e)).slice(0, 120)}`);
      stats.errors++;
    }
  }

  // ── Summary ──
  console.log();
  console.log("═".repeat(64));
  console.log("  SUMMARY");
  console.log("═".repeat(64));
  console.log(`  Total checked:    ${stats.total}`);
  console.log(`  All good:         ${stats.ok}`);
  console.log(`  Needs fix:        ${stats.needsFix}`);
  if (!DRY_RUN) console.log(`  Fixes applied:    ${stats.fixed}`);
  console.log(`  Errors:           ${stats.errors}`);
  console.log();

  if (DRY_RUN && stats.needsFix > 0) {
    console.log("  💡 Run with --fix to apply changes");
  }

  if (issues.length > 0 && VERBOSE) {
    console.log();
    console.log("  Markets needing attention:");
    for (const iss of issues) {
      console.log(`    ${iss.label}: ${iss.ob}`);
    }
  }

  // Cleanup: revoke temporary FACTORY_ROLE if we granted it
  if (grantedFactoryRole && !DRY_RUN) {
    try {
      console.log("  🧹 Revoking temporary FACTORY_ROLE from signer…");
      const revokeAbi = ["function revokeRole(bytes32,address)"];
      const vaultRevoke = new ethers.Contract(CORE_VAULT, revokeAbi, wallet);
      const ov = await getTxOverrides(provider);
      const tx = await vaultRevoke.revokeRole(FACTORY_ROLE, signerAddr, ov);
      await tx.wait();
      console.log("  ✅ FACTORY_ROLE revoked");
    } catch (e) {
      console.warn(`  ⚠️  Could not revoke FACTORY_ROLE: ${e.message}`);
    }
  }

  console.log();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
