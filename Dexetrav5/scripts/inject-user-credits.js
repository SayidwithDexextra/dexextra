#!/usr/bin/env node

/**
 * inject-user-credits.js
 *
 * Artificially inject available balance (credits) into a user's CoreVault account.
 * These credits are fully usable for trading without requiring actual token deposits.
 *
 * Uses the `creditExternal` function which adds to `userCrossChainCredit[user]`.
 *
 * Usage:
 *   npx hardhat run Dexetrav5/scripts/inject-user-credits.js --network hyperliquid -- --user 0x... --amount 1000
 *
 * Options:
 *   --user <address>     Target user address to credit
 *   --amount <number>    Amount in human-readable units (e.g., 1000 = 1000 USDC)
 *   --corevault <addr>   (Optional) CoreVault address override
 *
 * Environment:
 *   CORE_VAULT_ADDRESS or loads from deployments/hyperliquid-deployment.json
 */

const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// Load env
try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch (_) {}

const COREVAULT_ABI = [
  "function creditExternal(address user, uint256 amount) external",
  "function debitExternal(address user, uint256 amount) external",
  "function userCrossChainCredit(address) view returns (uint256)",
  "function userCollateral(address) view returns (uint256)",
  "function userRealizedPnL(address) view returns (int256)",
  "function getAvailableCollateral(address user) external returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log("\n💉 CoreVault Credit Injection Script");
  console.log("─".repeat(60));

  // Parse arguments (support both CLI args and env vars)
  const userAddress = getArg("--user") || process.env.USER_ADDRESS;
  const amountStr = getArg("--amount") || process.env.INJECT_AMOUNT;
  const autoConfirm = process.argv.includes("--yes") || process.env.AUTO_CONFIRM === "true";
  
  // Priority: CLI arg > CORE_VAULT_ADDRESS env > NEXT_PUBLIC_CORE_VAULT_ADDRESS env
  let coreVaultAddress = getArg("--corevault") 
    || process.env.CORE_VAULT_ADDRESS 
    || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;

  // Validate inputs
  if (!userAddress || !ethers.isAddress(userAddress)) {
    console.error("❌ Invalid or missing --user address");
    console.log("\nUsage:");
    console.log("  npx hardhat run Dexetrav5/scripts/inject-user-credits.js --network hyperliquid -- --user 0x... --amount 1000");
    process.exit(1);
  }

  if (!amountStr || isNaN(parseFloat(amountStr))) {
    console.error("❌ Invalid or missing --amount");
    process.exit(1);
  }

  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
    console.error("❌ CoreVault address not found. Set CORE_VAULT_ADDRESS or use --corevault");
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  const signerAddr = await signer.getAddress();
  
  // Amount in 6 decimals (USDC)
  const amount = ethers.parseUnits(amountStr, 6);

  console.log(`👤 Signer:     ${signerAddr}`);
  console.log(`🏦 CoreVault:  ${coreVaultAddress}`);
  console.log(`🎯 Target:     ${userAddress}`);
  console.log(`💰 Amount:     ${amountStr} USDC (${amount.toString()} raw)`);

  const coreVault = new ethers.Contract(coreVaultAddress, COREVAULT_ABI, signer);

  // Check current balances
  console.log("\n📊 Current User Balances:");
  console.log("─".repeat(40));
  
  const crossChainCredit = await coreVault.userCrossChainCredit(userAddress);
  const collateral = await coreVault.userCollateral(userAddress);
  const realizedPnL = await coreVault.userRealizedPnL(userAddress);
  
  console.log(`  Cross-chain Credit: ${ethers.formatUnits(crossChainCredit, 6)} USDC`);
  console.log(`  Collateral:         ${ethers.formatUnits(collateral, 6)} USDC`);
  console.log(`  Realized PnL:       ${ethers.formatUnits(realizedPnL, 18)} (18 decimals)`);

  // Check and grant EXTERNAL_CREDITOR_ROLE if needed
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
  
  const hasRole = await coreVault.hasRole(EXTERNAL_CREDITOR_ROLE, signerAddr);
  
  if (!hasRole) {
    console.log("\n⚠️  Signer does not have EXTERNAL_CREDITOR_ROLE");
    
    // Check if signer is admin
    const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
    const isAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signerAddr);
    
    if (!isAdmin) {
      console.error("❌ Signer is not an admin and cannot grant roles");
      process.exit(1);
    }
    
    if (!autoConfirm) {
      const answer = await prompt("Grant EXTERNAL_CREDITOR_ROLE to signer? (y/N) ");
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        process.exit(0);
      }
    }
    
    console.log("🔑 Granting EXTERNAL_CREDITOR_ROLE...");
    const grantTx = await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, signerAddr);
    console.log(`   Tx: ${grantTx.hash}`);
    await grantTx.wait();
    console.log("   ✅ Role granted");
  } else {
    console.log("\n✅ Signer has EXTERNAL_CREDITOR_ROLE");
  }

  // Confirm injection
  if (!autoConfirm) {
    const confirm = await prompt(`\nInject ${amountStr} USDC credits to ${userAddress}? (y/N) `);
    if (confirm.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Execute credit injection
  console.log("\n💉 Injecting credits...");
  const tx = await coreVault.creditExternal(userAddress, amount);
  console.log(`   Tx: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log(`   ✅ Credits injected (block ${receipt.blockNumber})`);

  // Show updated balances
  console.log("\n📊 Updated User Balances:");
  console.log("─".repeat(40));
  
  const newCrossChainCredit = await coreVault.userCrossChainCredit(userAddress);
  const newCollateral = await coreVault.userCollateral(userAddress);
  
  console.log(`  Cross-chain Credit: ${ethers.formatUnits(newCrossChainCredit, 6)} USDC (+${amountStr})`);
  console.log(`  Collateral:         ${ethers.formatUnits(newCollateral, 6)} USDC`);
  console.log(`  Total Available:    ${ethers.formatUnits(newCrossChainCredit + newCollateral, 6)} USDC`);

  console.log("\n🎉 Done! User can now use these credits for trading.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
