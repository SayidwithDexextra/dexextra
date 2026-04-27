#!/usr/bin/env node
/**
 * reconfigure-spokes.js
 *
 * Helper script to reconfigure existing SpokeVault contracts on other chains
 * to point to the new CollateralHub after the Real USDC migration.
 *
 * This script should be run on each spoke chain (e.g., mainnet, polygon)
 * to update the spoke's bridge inbox to communicate with the new hub.
 *
 * Environment Variables:
 *   SPOKE_VAULT_ADDRESS     - Address of the SpokeVault on this chain
 *   NEW_BRIDGE_INBOX        - New bridge inbox address (connected to new hub)
 *   REAL_USDC_ADDRESS       - Real USDC address on this chain (for token allow list)
 *
 * Usage:
 *   npx hardhat run scripts/reconfigure-spokes.js --network mainnet
 *   npx hardhat run scripts/reconfigure-spokes.js --network polygon
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`\n🔧 SPOKE RECONFIGURATION - ${networkName.toUpperCase()}`);
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Get configuration
  const spokeVaultAddress = process.env.SPOKE_VAULT_ADDRESS;
  const newBridgeInbox = process.env.NEW_BRIDGE_INBOX;
  const realUsdcAddress = process.env.REAL_USDC_ADDRESS;

  if (!spokeVaultAddress || !ethers.isAddress(spokeVaultAddress)) {
    console.error("❌ SPOKE_VAULT_ADDRESS not set or invalid");
    process.exit(1);
  }

  console.log(`\n📋 Configuration:`);
  console.log(`   SpokeVault: ${spokeVaultAddress}`);
  console.log(`   New BridgeInbox: ${newBridgeInbox || "(not set)"}`);
  console.log(`   Real USDC: ${realUsdcAddress || "(not set)"}`);

  // Connect to SpokeVault
  const spokeVaultAbi = [
    "function setBridgeInbox(address _inbox) external",
    "function addAllowedToken(address token) external",
    "function removeAllowedToken(address token) external",
    "function isAllowedToken(address token) view returns (bool)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function VAULT_ADMIN_ROLE() view returns (bytes32)",
    "function BRIDGE_INBOX_ROLE() view returns (bytes32)",
    "function grantRole(bytes32 role, address account) external",
    "function revokeRole(bytes32 role, address account) external",
  ];

  const spokeVault = new ethers.Contract(spokeVaultAddress, spokeVaultAbi, deployer);

  // Check if we have admin role
  const VAULT_ADMIN_ROLE = await spokeVault.VAULT_ADMIN_ROLE();
  const hasAdmin = await spokeVault.hasRole(VAULT_ADMIN_ROLE, deployer.address);
  if (!hasAdmin) {
    console.error(`\n❌ Deployer does not have VAULT_ADMIN_ROLE on SpokeVault`);
    console.error(`   Cannot proceed with reconfiguration`);
    process.exit(1);
  }
  console.log(`\n✅ Deployer has VAULT_ADMIN_ROLE`);

  // Update bridge inbox if specified
  if (newBridgeInbox && ethers.isAddress(newBridgeInbox)) {
    console.log(`\n🔧 Updating bridge inbox...`);
    const tx = await spokeVault.setBridgeInbox(newBridgeInbox);
    await tx.wait();
    console.log(`   ✅ Bridge inbox updated to: ${newBridgeInbox}`);
  }

  // Add real USDC to allowed tokens if specified
  if (realUsdcAddress && ethers.isAddress(realUsdcAddress)) {
    const isAllowed = await spokeVault.isAllowedToken(realUsdcAddress);
    if (!isAllowed) {
      console.log(`\n🔧 Adding Real USDC to allowed tokens...`);
      const tx = await spokeVault.addAllowedToken(realUsdcAddress);
      await tx.wait();
      console.log(`   ✅ Real USDC added: ${realUsdcAddress}`);
    } else {
      console.log(`\n✅ Real USDC already in allowed tokens`);
    }
  }

  // Optional: Remove mock USDC from allowed tokens
  const mockUsdcAddress = process.env.MOCK_USDC_ADDRESS;
  if (mockUsdcAddress && ethers.isAddress(mockUsdcAddress)) {
    const isAllowed = await spokeVault.isAllowedToken(mockUsdcAddress);
    if (isAllowed) {
      console.log(`\n🔧 Removing Mock USDC from allowed tokens...`);
      const tx = await spokeVault.removeAllowedToken(mockUsdcAddress);
      await tx.wait();
      console.log(`   ✅ Mock USDC removed: ${mockUsdcAddress}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ SPOKE RECONFIGURATION COMPLETE`);
  console.log(`${"═".repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  });
