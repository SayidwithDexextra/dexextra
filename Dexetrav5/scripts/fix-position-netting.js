#!/usr/bin/env node
/**
 * fix-position-netting.js
 * 
 * Fixes the duplicate position issue by:
 * 1. Deploying new CoreVault implementation with initializeMarginCaches wrapper
 * 2. Upgrading the proxy
 * 3. Initializing index mappings for existing users
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim();
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  Fix Position Netting - Index Migration");
  console.log("═".repeat(70) + "\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken = requireEnv("MOCK_USDC_ADDRESS");
  
  // Use the already deployed PositionManager from the upgrade
  const positionManagerAddr = "0x8e3dAF0040C4ea49007ead181602c25b1b82C1CC";

  console.log("Configuration:");
  console.log(`  CoreVault proxy:     ${vaultProxy}`);
  console.log(`  Collateral token:    ${collateralToken}`);
  console.log(`  PositionManager:     ${positionManagerAddr}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 1: Deploy new CoreVault implementation with initializeMarginCaches
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 1: Deploy new CoreVault implementation");
  console.log("─".repeat(70));
  console.log("(Contains initializeMarginCaches wrapper function)");

  const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const newImpl = await CoreVaultImpl.deploy(collateralToken);
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`✓ New CoreVault implementation deployed: ${newImplAddr}`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 2: Upgrade CoreVault proxy (UUPS)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 2: Upgrade CoreVault proxy (UUPS)");
  console.log("─".repeat(70));

  const vault = await ethers.getContractAt("CoreVault", vaultProxy);
  const tx1 = await vault.upgradeToAndCall(newImplAddr, "0x");
  const receipt1 = await tx1.wait();
  console.log(`✓ upgradeToAndCall complete (tx: ${receipt1.hash})`);

  // ══════════════════════════════════════════════════════════════════════
  // Step 3: Get ALL known users from on-chain storage
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("Step 3: Fetch all known users from chain");
  console.log("─".repeat(70));

  // Fetch allKnownUsers from the vault
  let usersToInit = [];
  let i = 0;
  while (true) {
    try {
      const user = await vault.allKnownUsers(i);
      usersToInit.push(user);
      i++;
      if (i % 50 === 0) console.log(`  Fetched ${i} users...`);
    } catch (e) {
      // End of array
      break;
    }
  }
  
  console.log(`  Found ${usersToInit.length} total known users`);

  // Filter to only users with positions and set their indexes
  console.log("\n" + "─".repeat(70));
  console.log("Step 4: Initialize position indexes for users");
  console.log("─".repeat(70));

  let usersFixed = 0;
  for (const user of usersToInit) {
    try {
      const positions = await vault.getUserPositions(user);
      if (positions.length > 0) {
        console.log(`  ${user}: ${positions.length} positions`);
        
        // Set position index for each position
        for (let i = 0; i < positions.length; i++) {
          const marketId = positions[i].marketId;
          const indexPlusOne = i + 1;
          
          // Check if index already set
          const currentIdx = await vault.userPositionIndex(user, marketId);
          if (currentIdx === 0n) {
            console.log(`    Setting index for market ${marketId.slice(0, 10)}... to ${indexPlusOne}`);
            const tx = await vault.setPosIdx(user, marketId, indexPlusOne);
            await tx.wait();
            console.log(`    ✓ Done`);
          } else {
            console.log(`    Market ${marketId.slice(0, 10)}... already indexed (${currentIdx})`);
          }
        }
        usersFixed++;
      }
    } catch (e) {
      console.log(`  Error with ${user}: ${e.message}`);
    }
  }
  
  console.log(`\n  ${usersFixed} users processed`);

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(70));
  console.log("  Fix Complete!");
  console.log("═".repeat(70));
  console.log(`  New CoreVault Impl: ${newImplAddr}`);
  console.log(`  Users initialized:  ${usersWithPositions.length}`);
  console.log("");
  console.log("  Position netting should now work correctly.");
  console.log("═".repeat(70) + "\n");
  
  // Save deployment record
  const deploymentsDir = path.join(__dirname, "../deployments");
  const outFile = path.join(
    deploymentsDir,
    `position-netting-fix-${chainId}-${Date.now()}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: networkName,
    chainId,
    newCoreVaultImpl: newImplAddr,
    usersInitialized: usersWithPositions,
    upgradeTx: receipt1.hash
  }, null, 2));
  console.log(`Saved: ${outFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFix failed:", error);
    process.exit(1);
  });
