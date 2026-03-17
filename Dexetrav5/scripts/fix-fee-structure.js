#!/usr/bin/env node
/**
 * fix-fee-structure.js
 *
 * Batch script to call updateFeeStructure() on all markets that have the
 * upgraded OBAdminFacet but were never configured with fee parameters.
 *
 * After the Diamond facet upgrade (upgrade-fee-structure-interactive.js),
 * the new storage slots (takerFeeBps, makerFeeBps, protocolFeeRecipient,
 * protocolFeeShareBps) default to zero. This script populates them.
 *
 * It also detects and optionally fixes feeRecipient mismatches between
 * on-chain and Supabase creator_wallet_address (via updateTradingParameters).
 *
 * Modes:
 *   --dry-run       Scan only; report which markets need fixing without executing.
 *   --skip-confirm  Skip the confirmation prompt before executing.
 *
 * Env required:
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_PRIVATE_KEY          (primary signer)
 *   ADMIN_PRIVATE_KEY_2/3      (optional fallbacks for diamond ownership)
 *   PROTOCOL_FEE_RECIPIENT     (optional; defaults to 0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306)
 *
 * Usage:
 *   npx hardhat run scripts/fix-fee-structure.js --network hyperliquid
 *   npx hardhat run scripts/fix-fee-structure.js --network hyperliquid --dry-run
 */
const { ethers } = require("hardhat");
const readline = require("readline");

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_CONFIRM = process.argv.includes("--skip-confirm");

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Standard fee parameters (matching deploy.js and the healthy RQHR market)
const DEFAULT_TAKER_FEE_BPS = 45;       // 0.45%
const DEFAULT_MAKER_FEE_BPS = 15;       // 0.15%
const DEFAULT_PROTOCOL_SHARE_BPS = 8000; // 80% to protocol, 20% to market owner
const DEFAULT_PROTOCOL_RECIPIENT = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";

const VIEW_ABI = [
  "function owner() view returns (address)",
  "function getTradingParameters() view returns (uint256 marginRequirement, uint256 fee, address recipient)",
  "function getFeeStructure() view returns (uint256 takerFeeBps, uint256 makerFeeBps, address protocolFeeRecipient, uint256 protocolFeeShareBps, uint256 legacyTradingFee, address marketOwnerFeeRecipient)",
];

const ADMIN_ABI = [
  "function updateFeeStructure(uint256 _takerFeeBps, uint256 _makerFeeBps, address _protocolFeeRecipient, uint256 _protocolFeeShareBps) external",
  "function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external",
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

function normalizePk(v) {
  let raw = String(v || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return "";
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-fA-F0-9]{64}$/.test(pk) ? pk : "";
}

function padRight(str, len) {
  str = String(str || "");
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function shortAddr(addr) {
  if (!addr || addr === ZERO_ADDR) return addr === ZERO_ADDR ? "0x0…0000" : "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchMarkets() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, creator_wallet_address, chain_id")
    .not("market_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).filter((r) => /^0x[a-fA-F0-9]{40}$/.test((r.market_address || "").trim()));
}

async function main() {
  console.log("\n🔧 Fix Fee Structure — Configure updateFeeStructure() on all markets");
  console.log("═".repeat(80));
  if (DRY_RUN) console.log("🔍 DRY RUN mode — no transactions will be sent.\n");

  const protocolRecipient = process.env.PROTOCOL_FEE_RECIPIENT || DEFAULT_PROTOCOL_RECIPIENT;
  const takerBps = Number(process.env.TAKER_FEE_BPS || DEFAULT_TAKER_FEE_BPS);
  const makerBps = Number(process.env.MAKER_FEE_BPS || DEFAULT_MAKER_FEE_BPS);
  const protocolShareBps = Number(process.env.PROTOCOL_SHARE_BPS || DEFAULT_PROTOCOL_SHARE_BPS);

  console.log("Fee parameters to apply:");
  console.log(`  Taker Fee:            ${takerBps} bps (${takerBps / 100}%)`);
  console.log(`  Maker Fee:            ${makerBps} bps (${makerBps / 100}%)`);
  console.log(`  Protocol Recipient:   ${protocolRecipient}`);
  console.log(`  Protocol Share:       ${protocolShareBps} bps (${protocolShareBps / 100}%)`);

  // Resolve admin signers
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing ADMIN_PRIVATE_KEY");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const candidates = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY" },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_2" }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase(), label: "ADMIN_PRIVATE_KEY_3" }] : []),
  ];

  console.log(`\n💰 Signers: ${candidates.map((c) => `${c.label}=${shortAddr(c.addr)}`).join(", ")}`);

  // Fetch markets
  console.log("\n🔎 Fetching markets from Supabase...");
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const allMarkets = await fetchMarkets();
  const markets = allMarkets.filter((m) => !m.chain_id || Number(m.chain_id) === chainId);
  console.log(`   ${allMarkets.length} total markets, ${markets.length} on chain ${chainId}\n`);

  // Scan phase
  console.log("🔍 Scanning fee structure on each market...\n");

  const needsFeeConfig = [];
  const needsRecipientFix = [];
  const healthy = [];
  const skipped = [];

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const label = m.symbol || m.market_identifier || m.id;
    const ob = m.market_address.trim();

    process.stdout.write(`  [${i + 1}/${markets.length}] ${padRight(label, 30)} `);

    // Check owner
    let owner;
    try {
      const view = await ethers.getContractAt(VIEW_ABI, ob, ethers.provider);
      owner = await view.owner();
    } catch {
      console.log("⚠️  owner() failed — skipping");
      skipped.push({ label, address: ob, reason: "owner() reverted" });
      continue;
    }

    const signer = candidates.find((c) => c.addr === owner.toLowerCase());
    if (!signer) {
      console.log(`⚠️  owner=${shortAddr(owner)} — no matching key`);
      skipped.push({ label, address: ob, reason: `owner=${owner} not in keys` });
      continue;
    }

    // Read current fee structure
    const view = await ethers.getContractAt(VIEW_ABI, ob, ethers.provider);
    let curTaker, curMaker, curProtoRecipient, curProtoShare, curLegacyFee, curFeeRecipient;

    try {
      const fs = await view.getFeeStructure();
      curTaker = Number(fs.takerFeeBps);
      curMaker = Number(fs.makerFeeBps);
      curProtoRecipient = fs.protocolFeeRecipient;
      curProtoShare = Number(fs.protocolFeeShareBps);
      curLegacyFee = Number(fs.legacyTradingFee);
      curFeeRecipient = fs.marketOwnerFeeRecipient;
    } catch {
      console.log("⚠️  getFeeStructure() failed — facet may be missing");
      skipped.push({ label, address: ob, reason: "getFeeStructure() reverted" });
      continue;
    }

    const feesAreZero =
      curTaker === 0 &&
      curMaker === 0 &&
      curProtoShare === 0 &&
      (!curProtoRecipient || curProtoRecipient === ZERO_ADDR);

    // Check feeRecipient vs Supabase creator
    let recipientMismatch = false;
    if (m.creator_wallet_address && curFeeRecipient) {
      recipientMismatch = curFeeRecipient.toLowerCase() !== m.creator_wallet_address.toLowerCase();
    }

    if (feesAreZero) {
      console.log(`⚠️  UNCONFIGURED (taker=0, maker=0, proto=0x0)${recipientMismatch ? " + RECIPIENT MISMATCH" : ""}`);
      needsFeeConfig.push({ label, address: ob, signer, recipientMismatch, market: m, curLegacyFee, curFeeRecipient });
    } else if (recipientMismatch) {
      console.log(`❌ RECIPIENT MISMATCH: on-chain=${shortAddr(curFeeRecipient)} vs supabase=${shortAddr(m.creator_wallet_address)}`);
      needsRecipientFix.push({ label, address: ob, signer, market: m, curLegacyFee, curFeeRecipient });
    } else {
      console.log(`✅ healthy (taker=${curTaker}bp, maker=${curMaker}bp, share=${curProtoShare}bp)`);
      healthy.push({ label, address: ob });
    }
  }

  // Summary
  console.log(`\n${"═".repeat(80)}`);
  console.log("SCAN SUMMARY");
  console.log(`${"═".repeat(80)}`);
  console.log(`  ✅ Healthy:                ${healthy.length}`);
  console.log(`  ⚠️  Need fee config:        ${needsFeeConfig.length}`);
  console.log(`  ❌ Need recipient fix:      ${needsRecipientFix.length}`);
  console.log(`  ⏭️  Skipped:                ${skipped.length}`);

  const totalFixes = needsFeeConfig.length + needsRecipientFix.length;
  if (totalFixes === 0) {
    console.log("\n🎉 All markets are properly configured. Nothing to do.");
    return;
  }

  if (needsFeeConfig.length) {
    console.log("\n  Markets needing updateFeeStructure():");
    for (const r of needsFeeConfig) {
      console.log(`     ${padRight(r.label, 30)} ${r.address}${r.recipientMismatch ? "  + recipient fix" : ""}`);
    }
  }
  if (needsRecipientFix.length) {
    console.log("\n  Markets needing updateTradingParameters() (recipient fix only):");
    for (const r of needsRecipientFix) {
      console.log(`     ${padRight(r.label, 30)} ${r.address}  ${shortAddr(r.curFeeRecipient)} → ${shortAddr(r.market.creator_wallet_address)}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n🔍 Dry run complete. Re-run without --dry-run to execute fixes.`);
    return;
  }

  // Confirm
  if (!SKIP_CONFIRM) {
    const confirm1 = (await ask(`\nProceed with fixing ${totalFixes} market(s)? [y/N]: `)).trim().toLowerCase();
    if (confirm1 !== "y" && confirm1 !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  // Execute
  console.log(`\n🚀 Executing fixes...\n`);
  const nonceMap = {};
  let feeConfigured = 0;
  let recipientFixed = 0;
  let failCount = 0;

  async function getNonce(signer) {
    if (!nonceMap[signer.addr]) {
      nonceMap[signer.addr] = await ethers.provider.getTransactionCount(signer.w.address, "pending");
    }
    return nonceMap[signer.addr]++;
  }

  // 1. updateFeeStructure on unconfigured markets
  for (const entry of needsFeeConfig) {
    const { label, address: ob, signer, recipientMismatch, market, curLegacyFee } = entry;
    console.log(`${"─".repeat(80)}`);
    console.log(`${label} @ ${ob}`);

    // updateFeeStructure
    try {
      const admin = await ethers.getContractAt(ADMIN_ABI, ob, signer.w);
      const nonce = await getNonce(signer);
      console.log(`  🔄 updateFeeStructure(${takerBps}, ${makerBps}, ${shortAddr(protocolRecipient)}, ${protocolShareBps}) nonce=${nonce}`);
      const tx = await admin.updateFeeStructure(takerBps, makerBps, protocolRecipient, protocolShareBps, { nonce });
      console.log(`     tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`     ✅ Mined block ${rc.blockNumber}, gas=${rc.gasUsed.toString()}`);
      feeConfigured++;
    } catch (e) {
      console.log(`     ❌ updateFeeStructure failed: ${(e?.message || String(e)).slice(0, 100)}`);
      failCount++;
      continue;
    }

    // Also fix recipient if mismatched
    if (recipientMismatch && market.creator_wallet_address) {
      try {
        const admin = await ethers.getContractAt(ADMIN_ABI, ob, signer.w);
        const view = await ethers.getContractAt(VIEW_ABI, ob, ethers.provider);
        const [marginBps, tradingFee] = await view.getTradingParameters();
        const nonce = await getNonce(signer);
        console.log(`  🔄 updateTradingParameters(${marginBps}, ${tradingFee}, ${shortAddr(market.creator_wallet_address)}) nonce=${nonce}`);
        const tx = await admin.updateTradingParameters(marginBps, tradingFee, market.creator_wallet_address, { nonce });
        console.log(`     tx: ${tx.hash}`);
        const rc = await tx.wait();
        console.log(`     ✅ Recipient fixed, block ${rc.blockNumber}`);
        recipientFixed++;
      } catch (e) {
        console.log(`     ❌ updateTradingParameters failed: ${(e?.message || String(e)).slice(0, 100)}`);
        failCount++;
      }
    }
  }

  // 2. updateTradingParameters on recipient-only mismatches
  for (const entry of needsRecipientFix) {
    const { label, address: ob, signer, market } = entry;
    console.log(`${"─".repeat(80)}`);
    console.log(`${label} @ ${ob}  (recipient fix only)`);

    try {
      const admin = await ethers.getContractAt(ADMIN_ABI, ob, signer.w);
      const view = await ethers.getContractAt(VIEW_ABI, ob, ethers.provider);
      const [marginBps, tradingFee] = await view.getTradingParameters();
      const nonce = await getNonce(signer);
      console.log(`  🔄 updateTradingParameters(${marginBps}, ${tradingFee}, ${shortAddr(market.creator_wallet_address)}) nonce=${nonce}`);
      const tx = await admin.updateTradingParameters(marginBps, tradingFee, market.creator_wallet_address, { nonce });
      console.log(`     tx: ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`     ✅ Recipient fixed, block ${rc.blockNumber}`);
      recipientFixed++;
    } catch (e) {
      console.log(`     ❌ Failed: ${(e?.message || String(e)).slice(0, 100)}`);
      failCount++;
    }
  }

  // Final summary
  console.log(`\n${"═".repeat(80)}`);
  console.log("EXECUTION SUMMARY");
  console.log(`${"═".repeat(80)}`);
  console.log(`  ✅ Fee structure configured:  ${feeConfigured}`);
  console.log(`  ✅ Recipients fixed:          ${recipientFixed}`);
  console.log(`  ❌ Failed:                    ${failCount}`);
  console.log(`\nFee parameters applied:`);
  console.log(`  Taker:     ${takerBps} bps`);
  console.log(`  Maker:     ${makerBps} bps`);
  console.log(`  Proto:     ${protocolRecipient}`);
  console.log(`  Share:     ${protocolShareBps} bps`);
  console.log("\nDone. Run 'npm run sweep:fees' to verify.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ fix-fee-structure failed:", e?.message || String(e));
    process.exit(1);
  });
