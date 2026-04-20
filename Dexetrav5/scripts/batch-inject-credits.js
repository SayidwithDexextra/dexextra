#!/usr/bin/env node

/**
 * batch-inject-credits.js
 *
 * Fund all wallets from a CSV with credits.
 *
 * Usage:
 *   npx hardhat run scripts/batch-inject-credits.js --network hyperliquid --no-compile
 *
 * Env:
 *   CSV_PATH         Path to wallets CSV (default: ../../AdvancedMarketAutomation/wallets.csv)
 *   INJECT_AMOUNT    Amount per user in USDC (default: 1000000)
 */

const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

// Load env
try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch (_) {}

const COREVAULT_ABI = [
  "function creditExternal(address user, uint256 amount) external",
  "function userCrossChainCredit(address) view returns (uint256)",
  "function userCollateral(address) view returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') { cur += '"'; i++; } 
        else { inQuotes = false; }
      } else { cur += ch; }
    } else {
      if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur.trim());
  return out;
}

function loadWalletsFromCsv(csvPath) {
  const txt = fs.readFileSync(csvPath, "utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = String(lines[0]).toLowerCase();
  const hasHeader = header.includes("nickname") && header.includes("address");
  const start = hasHeader ? 1 : 0;

  const wallets = [];
  for (let i = start; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const nickname = String(parts[0] || "").trim();
    const address = String(parts[1] || "").trim();
    if (!ethers.isAddress(address)) continue;
    wallets.push({ nickname, address });
  }
  return wallets;
}

async function main() {
  console.log("\n💉 Batch CoreVault Credit Injection");
  console.log("─".repeat(60));

  const csvPath = process.env.CSV_PATH || path.join(__dirname, "../../AdvancedMarketAutomation/wallets.csv");
  const amountStr = process.env.INJECT_AMOUNT || "1000000";
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;

  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
    console.error("❌ CoreVault address not found. Set CORE_VAULT_ADDRESS");
    process.exit(1);
  }

  const wallets = loadWalletsFromCsv(csvPath);
  if (wallets.length === 0) {
    console.error("❌ No wallets found in CSV:", csvPath);
    process.exit(1);
  }

  // Use relayer key if available (has more HYPE)
  let signer;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (relayerKey) {
    signer = new ethers.Wallet(relayerKey, ethers.provider);
    console.log("Using RELAYER as signer");
  } else {
    [signer] = await ethers.getSigners();
  }
  const signerAddr = await signer.getAddress();
  const amount = ethers.parseUnits(amountStr, 6);

  console.log(`👤 Signer:     ${signerAddr}`);
  console.log(`🏦 CoreVault:  ${coreVaultAddress}`);
  console.log(`📄 CSV:        ${csvPath}`);
  console.log(`👥 Wallets:    ${wallets.length}`);
  console.log(`💰 Per user:   ${amountStr} USDC`);
  console.log(`💵 Total:      ${Number(amountStr) * wallets.length} USDC`);

  const coreVault = new ethers.Contract(coreVaultAddress, COREVAULT_ABI, signer);

  // Check and grant EXTERNAL_CREDITOR_ROLE if needed
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
  const hasRole = await coreVault.hasRole(EXTERNAL_CREDITOR_ROLE, signerAddr);
  
  if (!hasRole) {
    console.log("\n⚠️  Signer does not have EXTERNAL_CREDITOR_ROLE");
    const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
    const isAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signerAddr);
    
    if (!isAdmin) {
      console.error("❌ Signer is not an admin and cannot grant roles");
      process.exit(1);
    }
    
    console.log("🔑 Granting EXTERNAL_CREDITOR_ROLE...");
    const grantTx = await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, signerAddr);
    console.log(`   Tx: ${grantTx.hash}`);
    await grantTx.wait();
    console.log("   ✅ Role granted");
  } else {
    console.log("\n✅ Signer has EXTERNAL_CREDITOR_ROLE");
  }

  // First, check which wallets need funding
  console.log("\n🔍 Checking existing balances...");
  const needsFunding = [];
  const alreadyFunded = [];

  for (let i = 0; i < wallets.length; i++) {
    const { nickname, address } = wallets[i];
    try {
      const credit = await coreVault.userCrossChainCredit(address);
      const collateral = await coreVault.userCollateral(address);
      const total = credit + collateral;
      
      if (total >= amount) {
        alreadyFunded.push({ nickname, address, balance: total });
      } else {
        needsFunding.push({ nickname, address, balance: total });
      }
    } catch (e) {
      needsFunding.push({ nickname, address, balance: 0n });
    }
  }

  console.log(`   ✅ Already funded: ${alreadyFunded.length} wallets`);
  console.log(`   🔄 Need funding:   ${needsFunding.length} wallets`);

  if (needsFunding.length === 0) {
    console.log("\n🎉 All wallets already have sufficient balance!");
    return;
  }

  console.log("\n💉 Injecting credits (only unfunded wallets)...");
  console.log("─".repeat(60));

  let funded = 0;
  let failed = 0;
  let skipped = alreadyFunded.length;

  // Get fee data and bump significantly
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = (feeData.gasPrice || ethers.parseUnits("50", "gwei")) * 20n;
  console.log(`Using gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  // Get fresh nonce
  let nonce = await signer.getNonce();
  console.log(`Starting nonce: ${nonce}\n`);

  for (let i = 0; i < needsFunding.length; i++) {
    const { nickname, address, balance } = needsFunding[i];
    const progress = `[${String(i + 1).padStart(3)}/${needsFunding.length}]`;
    const currentBal = ethers.formatUnits(balance, 6);
    
    try {
      const tx = await coreVault.creditExternal(address, amount, { gasPrice, nonce });
      await tx.wait();
      console.log(`${progress} ✅ ${nickname} (had ${currentBal} USDC)`);
      funded++;
      nonce++;
    } catch (e) {
      console.error(`${progress} ❌ ${nickname}: ${e?.message?.slice(0, 50) || e}`);
      failed++;
      nonce++;
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`🎉 Batch injection complete!`);
  console.log(`   ✅ Funded:  ${funded}`);
  console.log(`   ⏭️  Skipped: ${skipped} (already had >= ${amountStr} USDC)`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   💵 Total:   ${funded * Number(amountStr)} USDC injected`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
