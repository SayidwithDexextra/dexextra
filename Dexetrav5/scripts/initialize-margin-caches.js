#!/usr/bin/env node

/**
 * initialize-margin-caches.js
 *
 * Initializes the O(1) index mappings and margin caches for existing users
 * after the gas optimization upgrade.
 *
 * This script should be run AFTER upgrade-gas-optimization.js to populate
 * the new storage mappings for users who had positions/orders before the upgrade.
 *
 * ENV VARS (required):
 *   CORE_VAULT_ADDRESS         - CoreVault proxy address
 *
 * ENV VARS (optional):
 *   BATCH_SIZE                 - Number of users per transaction (default: 50)
 *   DRY_RUN=1                  - Just fetch users, don't initialize
 *
 * USAGE:
 *   npx hardhat run scripts/initialize-margin-caches.js --network hyperliquid
 */

const { ethers } = require("hardhat");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim();
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  Initialize Margin Caches");
  console.log("  Post-upgrade O(1) index population");
  console.log("═".repeat(60) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const batchSize = parseInt(process.env.BATCH_SIZE || "50", 10);
  const dryRun = !!process.env.DRY_RUN;

  console.log(`CoreVault proxy: ${vaultProxy}`);
  console.log(`Batch size: ${batchSize}`);
  if (dryRun) console.log("DRY_RUN mode enabled\n");

  // Get the vault and views manager
  const vault = await ethers.getContractAt("CoreVault", vaultProxy);
  
  // Get views manager address
  const viewsManagerAddr = await vault.viewsManager();
  console.log(`VaultViewsManager: ${viewsManagerAddr}`);

  if (viewsManagerAddr === ethers.ZeroAddress) {
    throw new Error("VaultViewsManager not set on CoreVault");
  }

  const viewsManager = await ethers.getContractAt("VaultViewsManager", viewsManagerAddr);

  // Fetch all known users
  console.log("\n--- Fetching users ---");
  let allUsers;
  try {
    allUsers = await viewsManager.getAllKnownUsers();
    console.log(`Found ${allUsers.length} users`);
  } catch (e) {
    console.log(`Error fetching users: ${e.message}`);
    
    // Fallback: try to get users from vault directly
    try {
      const userCount = await vault.getKnownUserCount();
      console.log(`User count: ${userCount}`);
      allUsers = [];
      for (let i = 0; i < userCount; i++) {
        const user = await vault.allKnownUsers(i);
        allUsers.push(user);
      }
      console.log(`Fetched ${allUsers.length} users individually`);
    } catch (e2) {
      throw new Error(`Could not fetch users: ${e2.message}`);
    }
  }

  if (allUsers.length === 0) {
    console.log("No users to initialize");
    return;
  }

  // Check which users need initialization
  console.log("\n--- Checking which users need initialization ---");
  const usersToInit = [];
  
  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    
    // Check if user has positions but no cached margin
    try {
      const positions = await vault.getUserPositions(user);
      const cachedLocked = await vault.userTotalMarginLocked(user);
      
      // Calculate actual locked margin
      let actualLocked = 0n;
      for (const pos of positions) {
        actualLocked += pos.marginLocked;
      }
      
      // If cached doesn't match actual, needs initialization
      if (actualLocked > 0n && cachedLocked === 0n) {
        usersToInit.push(user);
      }
    } catch (e) {
      // User might need init, add to list
      usersToInit.push(user);
    }
    
    if ((i + 1) % 100 === 0) {
      console.log(`  Checked ${i + 1}/${allUsers.length} users...`);
    }
  }

  console.log(`${usersToInit.length} users need initialization`);

  if (usersToInit.length === 0) {
    console.log("All users already initialized!");
    return;
  }

  if (dryRun) {
    console.log("\nDRY_RUN: Would initialize these users:");
    usersToInit.slice(0, 10).forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
    if (usersToInit.length > 10) {
      console.log(`  ... and ${usersToInit.length - 10} more`);
    }
    return;
  }

  // Initialize in batches
  console.log("\n--- Initializing margin caches ---");
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < usersToInit.length; i += batchSize) {
    const batch = usersToInit.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(usersToInit.length / batchSize);
    
    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} users)`);
    
    try {
      const tx = await viewsManager.initializeMarginCaches(batch);
      console.log(`  tx: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  ✓ Mined block ${receipt.blockNumber}, gas ${receipt.gasUsed.toString()}`);
      successCount += batch.length;
    } catch (e) {
      console.log(`  ✗ Failed: ${e.message}`);
      failCount += batch.length;
      
      // Try one-by-one for failed batch
      console.log("  Retrying individually...");
      for (const user of batch) {
        try {
          const tx = await viewsManager.initializeMarginCaches([user]);
          await tx.wait();
          console.log(`    ✓ ${user}`);
          successCount++;
          failCount--;
        } catch (e2) {
          console.log(`    ✗ ${user}: ${e2.message}`);
        }
      }
    }
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  Initialization Complete");
  console.log("═".repeat(60));
  console.log(`  Total users: ${allUsers.length}`);
  console.log(`  Needed init: ${usersToInit.length}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log("═".repeat(60) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nInitialization failed:", error);
    process.exit(1);
  });
