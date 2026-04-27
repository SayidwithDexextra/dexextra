#!/usr/bin/env node
/**
 * Deploy MarketBondManagerV2 with bond exemption support
 * 
 * The Real USDC migration deployed V1 (without bond exemption).
 * This script deploys V2 with the setBondExempt/bondExempt feature.
 * 
 * Usage: npx hardhat run scripts/deploy-bond-manager-v2.js --network hyperliquid
 */

const hre = require("hardhat");
const { ethers } = hre;
const path = require("path");
const fs = require("fs");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}

async function main() {
  console.log("=== Deploy MarketBondManagerV2 (with bond exemption) ===\n");

  const vaultAddr = process.env.CORE_VAULT_ADDRESS;
  const factoryAddr = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
  const oldBondManagerAddr = process.env.MARKET_BOND_MANAGER_ADDRESS;

  if (!vaultAddr || !factoryAddr) {
    console.error("❌ Missing environment variables:");
    console.error("   CORE_VAULT_ADDRESS:", vaultAddr || "(not set)");
    console.error("   FUTURES_MARKET_FACTORY_ADDRESS:", factoryAddr || "(not set)");
    process.exit(1);
  }

  console.log("CoreVault:", vaultAddr);
  console.log("Factory:", factoryAddr);
  console.log("Old Bond Manager (V1):", oldBondManagerAddr);
  console.log("");

  // Use CREATOR_PRIVATE_KEY for deployment (it's the owner of existing contracts)
  const creatorPk = process.env.CREATOR_PRIVATE_KEY;
  if (!creatorPk) {
    console.error("❌ CREATOR_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }
  
  const signer = new ethers.Wallet(creatorPk, ethers.provider);
  console.log("Deployer (CREATOR_PRIVATE_KEY):", signer.address);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("");

  // Read config from old V1 bond manager
  console.log("--- Reading Old V1 Bond Manager Config ---");
  const oldBondManager = new ethers.Contract(oldBondManagerAddr, [
    "function vault() view returns (address)",
    "function owner() view returns (address)",
    "function defaultBondAmount() view returns (uint256)",
    "function minBondAmount() view returns (uint256)",
    "function maxBondAmount() view returns (uint256)",
  ], signer);

  const [oldVault, oldOwner, defaultBond, minBond, maxBond] = await Promise.all([
    oldBondManager.vault(),
    oldBondManager.owner(),
    oldBondManager.defaultBondAmount(),
    oldBondManager.minBondAmount(),
    oldBondManager.maxBondAmount(),
  ]);

  console.log("Old Vault:", oldVault);
  console.log("Old Owner:", oldOwner);
  console.log("Default Bond:", ethers.formatUnits(defaultBond, 6), "USDC");
  console.log("Min Bond:", ethers.formatUnits(minBond, 6), "USDC");
  console.log("Max Bond:", maxBond.toString() === "0" ? "No max" : ethers.formatUnits(maxBond, 6) + " USDC");
  console.log("");

  // Deploy new MarketBondManagerV2
  console.log("--- Deploying MarketBondManagerV2 ---");
  const MarketBondManagerV2 = await ethers.getContractFactory("MarketBondManagerV2", signer);
  const newBondManager = await MarketBondManagerV2.deploy(
    vaultAddr,         // _vault
    factoryAddr,       // _factory
    signer.address,    // _owner
    defaultBond,       // _defaultBondAmount
    minBond,           // _minBondAmount
    maxBond            // _maxBondAmount
  );

  await newBondManager.waitForDeployment();
  const newAddr = await newBondManager.getAddress();
  console.log("✅ MarketBondManagerV2 deployed:", newAddr);
  console.log("");

  // Set bond exemption for deployer/admin
  console.log("--- Setting Bond Exemptions ---");
  
  // Exempt the deployer (creator key)
  console.log("Exempting deployer:", signer.address);
  const tx1 = await newBondManager.setBondExempt(signer.address, true);
  await tx1.wait();
  console.log("✅ Deployer is bond-exempt");

  // Also exempt the admin key if different
  const adminPk = process.env.PRIVATE_KEY;
  if (adminPk) {
    const adminWallet = new ethers.Wallet(adminPk);
    if (adminWallet.address.toLowerCase() !== signer.address.toLowerCase()) {
      console.log("Exempting admin:", adminWallet.address);
      const tx2 = await newBondManager.setBondExempt(adminWallet.address, true);
      await tx2.wait();
      console.log("✅ Admin is bond-exempt");
    }
  }
  console.log("");

  // Grant FACTORY_ROLE on CoreVault to new bond manager
  console.log("--- Granting FACTORY_ROLE on CoreVault ---");
  const coreVault = new ethers.Contract(vaultAddr, [
    "function FACTORY_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account) external",
  ], signer);

  const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
  const hasRole = await coreVault.hasRole(FACTORY_ROLE, newAddr);

  if (hasRole) {
    console.log("✅ Already has FACTORY_ROLE");
  } else {
    const tx3 = await coreVault.grantRole(FACTORY_ROLE, newAddr);
    await tx3.wait();
    console.log("✅ FACTORY_ROLE granted");
  }
  console.log("");

  // Update factory to use new bond manager
  console.log("--- Updating Factory ---");
  const factory = new ethers.Contract(factoryAddr, [
    "function bondManager() view returns (address)",
    "function setBondManager(address _bondManager) external",
  ], signer);

  const currentBondManager = await factory.bondManager();
  console.log("Current factory.bondManager():", currentBondManager);

  if (currentBondManager.toLowerCase() === newAddr.toLowerCase()) {
    console.log("✅ Already using new bond manager");
  } else {
    const tx4 = await factory.setBondManager(newAddr);
    await tx4.wait();
    console.log("✅ Factory updated to use new bond manager");
  }
  console.log("");

  // Verify
  console.log("=== VERIFICATION ===");
  const verifyExempt1 = await newBondManager.bondExempt(signer.address);
  console.log("Deployer exempt:", verifyExempt1 ? "✅" : "❌");
  
  if (adminPk) {
    const adminWallet = new ethers.Wallet(adminPk);
    const verifyExempt2 = await newBondManager.bondExempt(adminWallet.address);
    console.log("Admin exempt:", verifyExempt2 ? "✅" : "❌");
  }

  const verifyFactory = await factory.bondManager();
  console.log("Factory points to new manager:", verifyFactory.toLowerCase() === newAddr.toLowerCase() ? "✅" : "❌");

  const verifyRole = await coreVault.hasRole(FACTORY_ROLE, newAddr);
  console.log("CoreVault FACTORY_ROLE:", verifyRole ? "✅" : "❌");
  console.log("");

  // Instructions
  console.log("=== UPDATE .env.local ===");
  console.log("");
  console.log("# MarketBondManager (V2 with bond exemption - deployed " + new Date().toISOString().split('T')[0] + ")");
  console.log("# Previous V1: " + oldBondManagerAddr);
  console.log("MARKET_BOND_MANAGER_ADDRESS=" + newAddr);
  console.log("NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS=" + newAddr);
  console.log("");

  // Update deployment file
  const deploymentPath = path.resolve(__dirname, "../deployments/hyperliquid-real-usdc-deployment.json");
  try {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    deployment.contracts.MARKET_BOND_MANAGER_V1_PREVIOUS = oldBondManagerAddr;
    deployment.contracts.MARKET_BOND_MANAGER = newAddr;
    deployment.bondManagerV2Upgrade = {
      timestamp: new Date().toISOString(),
      previousV1: oldBondManagerAddr,
      newV2: newAddr,
      by: signer.address,
    };
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("✅ Updated deployments/hyperliquid-real-usdc-deployment.json");
  } catch (e) {
    console.warn("⚠️  Could not update deployment file:", e.message);
  }

  console.log("");
  console.log("=== DONE ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
