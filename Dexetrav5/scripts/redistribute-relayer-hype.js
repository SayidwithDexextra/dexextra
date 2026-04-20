#!/usr/bin/env node

/**
 * redistribute-relayer-hype.js
 *
 * Reads all relayer wallets and redistributes HYPE to balance them out.
 * Wallets with higher balances send to wallets with lower balances.
 *
 * Usage:
 *   npx hardhat run scripts/redistribute-relayer-hype.js --network hyperliquid --no-compile
 *
 * Options (env vars):
 *   MIN_BALANCE       Minimum target balance per wallet (default: 0.01 HYPE)
 *   DRY_RUN           Set to "true" to only show what would happen
 */

const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  console.log("\n💰 Relayer HYPE Redistribution");
  console.log("─".repeat(60));

  // Load relayers
  const relayersPath = path.join(__dirname, "../../relayers.generated.json");
  if (!fs.existsSync(relayersPath)) {
    console.error("❌ relayers.generated.json not found");
    process.exit(1);
  }

  const relayers = JSON.parse(fs.readFileSync(relayersPath, "utf8"));
  console.log(`📋 Found ${relayers.length} relayer wallets\n`);

  // Also include the main relayer from env if not in the list
  const mainRelayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (mainRelayerKey) {
    const mainRelayer = new ethers.Wallet(mainRelayerKey);
    const exists = relayers.some(r => r.address.toLowerCase() === mainRelayer.address.toLowerCase());
    if (!exists) {
      relayers.push({ address: mainRelayer.address, privateKey: mainRelayerKey, isMain: true });
    }
  }

  // Get balances for all relayers
  const walletData = [];
  let totalBalance = 0n;

  console.log("📊 Current Balances:");
  console.log("─".repeat(60));

  for (const relayer of relayers) {
    const balance = await ethers.provider.getBalance(relayer.address);
    walletData.push({
      address: relayer.address,
      privateKey: relayer.privateKey,
      balance,
      isMain: relayer.isMain || false,
    });
    totalBalance += balance;
    
    const balStr = ethers.formatEther(balance);
    const marker = relayer.isMain ? " (main)" : "";
    console.log(`  ${relayer.address.slice(0, 10)}...${relayer.address.slice(-6)}: ${balStr.padStart(12)} HYPE${marker}`);
  }

  const avgBalance = totalBalance / BigInt(walletData.length);
  const minTarget = ethers.parseEther(process.env.MIN_BALANCE || "0.01");
  const dryRun = process.env.DRY_RUN === "true";

  console.log("\n📈 Summary:");
  console.log(`  Total:   ${ethers.formatEther(totalBalance)} HYPE`);
  console.log(`  Wallets: ${walletData.length}`);
  console.log(`  Average: ${ethers.formatEther(avgBalance)} HYPE`);
  console.log(`  Target:  ${ethers.formatEther(minTarget)} HYPE (min per wallet)`);

  // Sort by balance (highest first for donors, lowest first for recipients)
  walletData.sort((a, b) => (b.balance > a.balance ? 1 : -1));

  // Identify donors (above average) and recipients (below target)
  const donors = walletData.filter(w => w.balance > avgBalance);
  const recipients = walletData.filter(w => w.balance < minTarget);

  if (recipients.length === 0) {
    console.log("\n✅ All wallets already meet minimum target!");
    return;
  }

  if (donors.length === 0) {
    console.log("\n⚠️  No wallets with above-average balance to donate from!");
    return;
  }

  console.log(`\n🔄 Redistribution Plan:`);
  console.log(`  Donors: ${donors.length} wallets (above average)`);
  console.log(`  Recipients: ${recipients.length} wallets (below ${ethers.formatEther(minTarget)} HYPE)`);

  if (dryRun) {
    console.log("\n⚠️  DRY RUN - No transactions will be sent\n");
  }

  // Calculate how much each recipient needs
  const gasCost = ethers.parseEther("0.0001"); // Reserve for gas
  let transfers = [];

  for (const recipient of recipients) {
    const needed = minTarget - recipient.balance;
    if (needed > 0n) {
      transfers.push({
        to: recipient.address,
        needed,
      });
    }
  }

  // Execute transfers from donors
  console.log("\n💸 Executing Transfers:");
  console.log("─".repeat(60));

  let totalTransferred = 0n;
  let transferCount = 0;

  for (const donor of donors) {
    const wallet = new ethers.Wallet(donor.privateKey, ethers.provider);
    let available = donor.balance - avgBalance - gasCost; // Keep at least average + gas reserve
    
    if (available <= 0n) continue;

    for (let i = 0; i < transfers.length; i++) {
      if (transfers[i].needed <= 0n) continue;
      if (available <= 0n) break;

      const sendAmount = available < transfers[i].needed ? available : transfers[i].needed;
      
      console.log(`  ${donor.address.slice(0, 8)}... → ${transfers[i].to.slice(0, 8)}...: ${ethers.formatEther(sendAmount)} HYPE`);

      if (!dryRun) {
        try {
          const tx = await wallet.sendTransaction({
            to: transfers[i].to,
            value: sendAmount,
            gasLimit: 21000,
          });
          await tx.wait();
          console.log(`    ✅ Tx: ${tx.hash.slice(0, 20)}...`);
          transferCount++;
          totalTransferred += sendAmount;
        } catch (e) {
          console.log(`    ❌ Failed: ${e.message?.slice(0, 40)}`);
        }
      } else {
        transferCount++;
        totalTransferred += sendAmount;
      }

      transfers[i].needed -= sendAmount;
      available -= sendAmount;
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`🎉 Redistribution Complete!`);
  console.log(`   Transfers: ${transferCount}`);
  console.log(`   Total moved: ${ethers.formatEther(totalTransferred)} HYPE`);

  if (!dryRun) {
    // Show final balances
    console.log("\n📊 Final Balances:");
    console.log("─".repeat(60));
    for (const w of walletData) {
      const newBal = await ethers.provider.getBalance(w.address);
      console.log(`  ${w.address.slice(0, 10)}...${w.address.slice(-6)}: ${ethers.formatEther(newBal).padStart(12)} HYPE`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
