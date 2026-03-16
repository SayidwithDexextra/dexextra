#!/usr/bin/env node
/**
 * fix-fee-recipient.js
 *
 * One-time script to update the feeRecipient on existing markets
 * so the market creator (from Supabase) receives their 20% share
 * instead of the global treasury/deployer address.
 *
 * Usage:
 *   npx hardhat run scripts/fix-fee-recipient.js --network hyperliquid
 */
const { ethers } = require("hardhat");

function normalizePk(v) {
  let raw = String(v || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return "";
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-fA-F0-9]{64}$/.test(pk) ? pk : "";
}

async function main() {
  console.log("\n🔧 Fix Fee Recipient — Point feeRecipient to market creators");
  console.log("═".repeat(70));

  // Resolve signers
  const pk1 = normalizePk(process.env.ADMIN_PRIVATE_KEY);
  const pk2 = normalizePk(process.env.ADMIN_PRIVATE_KEY_2);
  const pk3 = normalizePk(process.env.ADMIN_PRIVATE_KEY_3);
  if (!pk1) throw new Error("Missing ADMIN_PRIVATE_KEY");

  const w1 = new ethers.Wallet(pk1, ethers.provider);
  const w2 = pk2 ? new ethers.Wallet(pk2, ethers.provider) : null;
  const w3 = pk3 ? new ethers.Wallet(pk3, ethers.provider) : null;
  const candidates = [
    { w: w1, addr: (await w1.getAddress()).toLowerCase() },
    ...(w2 ? [{ w: w2, addr: (await w2.getAddress()).toLowerCase() }] : []),
    ...(w3 ? [{ w: w3, addr: (await w3.getAddress()).toLowerCase() }] : []),
  ];

  // Fetch markets from Supabase
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, key);

  const { data: markets, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, creator_wallet_address")
    .not("market_address", "is", null)
    .not("creator_wallet_address", "is", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!markets?.length) {
    console.log("No markets found.");
    return;
  }

  console.log(`\nFound ${markets.length} market(s) with creator wallets.\n`);

  const nonceMap = {};
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of markets) {
    const label = m.symbol || m.market_identifier || m.id;
    const ob = m.market_address;
    const creator = m.creator_wallet_address;

    console.log(`─ ${label} @ ${ob}`);
    console.log(`  Creator wallet: ${creator}`);

    // Read current on-chain feeRecipient
    const view = await ethers.getContractAt(
      ["function getTradingParameters() view returns (uint256,uint256,address)"],
      ob, ethers.provider
    );
    const [marginBps, tradingFee, currentRecipient] = await view.getTradingParameters();
    console.log(`  Current feeRecipient: ${currentRecipient}`);

    if (currentRecipient.toLowerCase() === creator.toLowerCase()) {
      console.log(`  ✅ Already correct — skipping.\n`);
      skipped++;
      continue;
    }

    // Find the owner signer
    const ownerView = await ethers.getContractAt(
      ["function owner() view returns (address)"], ob, ethers.provider
    );
    const owner = await ownerView.owner();
    const picked = candidates.find((c) => c.addr === owner.toLowerCase());
    if (!picked) {
      console.log(`  ⚠️  No key matches owner ${owner} — skipping.\n`);
      continue;
    }

    // Update feeRecipient to creator wallet
    try {
      const signerAddr = picked.addr;
      if (!nonceMap[signerAddr]) {
        nonceMap[signerAddr] = await ethers.provider.getTransactionCount(picked.w.address, "pending");
      }
      const admin = await ethers.getContractAt(
        ["function updateTradingParameters(uint256,uint256,address) external"],
        ob, picked.w
      );
      console.log(`  🔄 Updating feeRecipient → ${creator} (nonce=${nonceMap[signerAddr]}) ...`);
      const tx = await admin.updateTradingParameters(marginBps, tradingFee, creator, { nonce: nonceMap[signerAddr] });
      nonceMap[signerAddr]++;
      console.log(`  tx: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ Done — feeRecipient now points to creator.\n`);
      updated++;
    } catch (e) {
      console.log(`  ❌ Failed: ${e?.message || e}\n`);
      failed++;
    }
  }

  console.log("═".repeat(70));
  console.log(`Complete: ${updated} updated, ${skipped} already correct, ${failed} failed.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ fix-fee-recipient failed:", e?.message || e);
    process.exit(1);
  });
