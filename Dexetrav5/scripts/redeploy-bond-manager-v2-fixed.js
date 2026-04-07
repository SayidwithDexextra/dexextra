#!/usr/bin/env node
/**
 * Redeploy MarketBondManagerV2 with correct vault address
 * 
 * The previous deployment had an immutable vault pointing to the wrong CoreVault.
 * This script:
 * 1. Deploys a new MarketBondManagerV2 with the CORRECT vault address
 * 2. Copies configuration from the old bond manager
 * 3. Updates the factory to point to the new bond manager
 * 4. Grants FACTORY_ROLE on the new CoreVault to the new bond manager
 * 5. Sets up bond exemptions for admin
 * 
 * Usage: npx hardhat run scripts/redeploy-bond-manager-v2-fixed.js --network hyperliquid
 */

const hre = require("hardhat");
const { ethers } = hre;
const path = require("path");
const fs = require("fs");

// Load environment variables
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}

async function main() {
  console.log("=== Redeploy MarketBondManagerV2 with Correct Vault ===\n");

  // Get addresses from environment
  const oldBondManagerAddr = process.env.MARKET_BOND_MANAGER_ADDRESS;
  const correctVaultAddr = process.env.CORE_VAULT_ADDRESS;
  const factoryAddr = process.env.FUTURES_MARKET_FACTORY_ADDRESS;

  if (!oldBondManagerAddr || !correctVaultAddr || !factoryAddr) {
    console.error("❌ Missing environment variables:");
    console.error("   MARKET_BOND_MANAGER_ADDRESS:", oldBondManagerAddr || "(not set)");
    console.error("   CORE_VAULT_ADDRESS:", correctVaultAddr || "(not set)");
    console.error("   FUTURES_MARKET_FACTORY_ADDRESS:", factoryAddr || "(not set)");
    process.exit(1);
  }

  console.log("Old Bond Manager:", oldBondManagerAddr);
  console.log("Correct Vault:", correctVaultAddr);
  console.log("Factory:", factoryAddr);
  console.log("");

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Deployer/Admin:", signer.address);
  console.log("");

  // ABIs
  const oldBondManagerAbi = [
    "function vault() view returns (address)",
    "function factory() view returns (address)",
    "function owner() view returns (address)",
    "function defaultBondAmount() view returns (uint256)",
    "function minBondAmount() view returns (uint256)",
    "function maxBondAmount() view returns (uint256)",
    "function creationPenaltyBps() view returns (uint16)",
    "function penaltyRecipient() view returns (address)",
    "function bondExempt(address) view returns (bool)",
  ];

  const factoryAbi = [
    "function bondManager() view returns (address)",
    "function setBondManager(address _bondManager) external",
  ];

  const coreVaultAbi = [
    "function FACTORY_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account) external",
  ];

  // Read old bond manager configuration
  console.log("--- Reading Old Bond Manager Configuration ---");
  const oldBondManager = new ethers.Contract(oldBondManagerAddr, oldBondManagerAbi, signer);
  
  const [
    oldVault,
    oldFactory,
    oldOwner,
    defaultBondAmount,
    minBondAmount,
    maxBondAmount,
    creationPenaltyBps,
    penaltyRecipient,
  ] = await Promise.all([
    oldBondManager.vault(),
    oldBondManager.factory(),
    oldBondManager.owner(),
    oldBondManager.defaultBondAmount(),
    oldBondManager.minBondAmount(),
    oldBondManager.maxBondAmount(),
    oldBondManager.creationPenaltyBps(),
    oldBondManager.penaltyRecipient(),
  ]);

  console.log("Old Vault (WRONG):", oldVault);
  console.log("Old Factory:", oldFactory);
  console.log("Old Owner:", oldOwner);
  console.log("Default Bond:", ethers.formatUnits(defaultBondAmount, 6), "USDC");
  console.log("Min Bond:", ethers.formatUnits(minBondAmount, 6), "USDC");
  console.log("Max Bond:", maxBondAmount.toString() === "0" ? "No max" : ethers.formatUnits(maxBondAmount, 6) + " USDC");
  console.log("Creation Penalty:", Number(creationPenaltyBps) / 100, "%");
  console.log("Penalty Recipient:", penaltyRecipient);
  console.log("");

  // Check that we're the owner
  if (oldOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.warn("⚠️  Warning: You are not the owner of the old bond manager");
    console.warn("   Old owner:", oldOwner);
    console.warn("   Your address:", signer.address);
  }

  // Deploy new MarketBondManagerV2
  console.log("--- Deploying New MarketBondManagerV2 ---");
  console.log("Vault (CORRECT):", correctVaultAddr);
  console.log("Factory:", factoryAddr);
  console.log("Owner:", signer.address);
  console.log("");

  const MarketBondManagerV2 = await ethers.getContractFactory("MarketBondManagerV2");
  const newBondManager = await MarketBondManagerV2.deploy(
    correctVaultAddr,      // _vault (CORRECT this time!)
    factoryAddr,           // _factory
    signer.address,        // _owner
    defaultBondAmount,     // _defaultBondAmount (copy from old)
    minBondAmount,         // _minBondAmount (copy from old)
    maxBondAmount          // _maxBondAmount (copy from old)
  );

  await newBondManager.waitForDeployment();
  const newBondManagerAddr = await newBondManager.getAddress();
  console.log("✅ New Bond Manager deployed:", newBondManagerAddr);
  console.log("");

  // Configure the new bond manager
  console.log("--- Configuring New Bond Manager ---");

  // Set penalty config (if different from defaults)
  if (Number(creationPenaltyBps) > 0) {
    console.log("Setting penalty config...");
    const tx1 = await newBondManager.setPenaltyConfig(creationPenaltyBps, penaltyRecipient);
    await tx1.wait();
    console.log("✅ Penalty config set:", Number(creationPenaltyBps) / 100, "% to", penaltyRecipient);
  }

  // Set bond exemption for admin
  console.log("Setting bond exemption for admin...");
  const tx2 = await newBondManager.setBondExempt(signer.address, true);
  await tx2.wait();
  console.log("✅ Admin is now bond-exempt:", signer.address);
  console.log("");

  // Grant FACTORY_ROLE on the new CoreVault
  console.log("--- Granting FACTORY_ROLE on CoreVault ---");
  const coreVault = new ethers.Contract(correctVaultAddr, coreVaultAbi, signer);
  
  const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
  const hasRole = await coreVault.hasRole(FACTORY_ROLE, newBondManagerAddr);
  
  if (hasRole) {
    console.log("✅ Bond manager already has FACTORY_ROLE");
  } else {
    console.log("Granting FACTORY_ROLE...");
    const tx3 = await coreVault.grantRole(FACTORY_ROLE, newBondManagerAddr);
    await tx3.wait();
    console.log("✅ FACTORY_ROLE granted to new bond manager");
  }
  console.log("");

  // Update factory to use new bond manager
  console.log("--- Updating Factory Bond Manager ---");
  const factory = new ethers.Contract(factoryAddr, factoryAbi, signer);
  
  const currentBondManager = await factory.bondManager();
  console.log("Current bond manager on factory:", currentBondManager);
  
  if (currentBondManager.toLowerCase() === newBondManagerAddr.toLowerCase()) {
    console.log("✅ Factory already points to new bond manager");
  } else {
    console.log("Updating factory.setBondManager...");
    const tx4 = await factory.setBondManager(newBondManagerAddr);
    await tx4.wait();
    console.log("✅ Factory now uses new bond manager");
  }
  console.log("");

  // Verify final state
  console.log("--- Final Verification ---");
  const verifyVault = await newBondManager.vault();
  const verifyFactory = await factory.bondManager();
  const verifyHasRole = await coreVault.hasRole(FACTORY_ROLE, newBondManagerAddr);

  console.log("New Bond Manager Address:", newBondManagerAddr);
  console.log("  vault():", verifyVault);
  console.log("  Matches correct vault:", verifyVault.toLowerCase() === correctVaultAddr.toLowerCase() ? "✅ YES" : "❌ NO");
  console.log("");
  console.log("Factory.bondManager():", verifyFactory);
  console.log("  Points to new manager:", verifyFactory.toLowerCase() === newBondManagerAddr.toLowerCase() ? "✅ YES" : "❌ NO");
  console.log("");
  console.log("CoreVault FACTORY_ROLE:", verifyHasRole ? "✅ Granted" : "❌ Missing");
  console.log("");

  // Update .env.local suggestion
  console.log("=== UPDATE YOUR .env.local ===");
  console.log("");
  console.log("Replace:");
  console.log(`  MARKET_BOND_MANAGER_ADDRESS=${oldBondManagerAddr}`);
  console.log("");
  console.log("With:");
  console.log(`  MARKET_BOND_MANAGER_ADDRESS=${newBondManagerAddr}`);
  console.log(`  NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS=${newBondManagerAddr}`);
  console.log("");

  // Save to deployment file
  const deploymentPath = path.resolve(__dirname, "../deployments/hyperliquid-deployment.json");
  try {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    deployment.contracts = deployment.contracts || {};
    deployment.contracts.MARKET_BOND_MANAGER_V2 = newBondManagerAddr;
    deployment.contracts.MARKET_BOND_MANAGER_V2_PREVIOUS = oldBondManagerAddr;
    deployment.notes = deployment.notes || {};
    deployment.notes.bondManagerRedeploy = {
      timestamp: new Date().toISOString(),
      reason: "Fixed vault address mismatch",
      previousManager: oldBondManagerAddr,
      newManager: newBondManagerAddr,
      oldVault: oldVault,
      newVault: correctVaultAddr,
      by: signer.address,
    };
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("✅ Updated deployments/hyperliquid-deployment.json");
  } catch (e) {
    console.warn("⚠️  Could not update deployment file:", e.message);
  }

  console.log("");
  console.log("=== Deployment Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
