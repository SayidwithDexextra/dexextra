#!/usr/bin/env node
/**
 * register-spokes-on-hub.js
 *
 * Register spoke chains on the new CollateralHub after Real USDC migration.
 * Run this on the hub chain (Arbitrum) after deploying the new CollateralHub.
 *
 * Environment Variables:
 *   COLLATERAL_HUB_ADDRESS  - Address of the new CollateralHub
 *
 * Spoke configuration is read from the SPOKE_CONFIGS environment variable as JSON,
 * or you can modify the spokeConfigs array below.
 *
 * Usage:
 *   npx hardhat run scripts/register-spokes-on-hub.js --network arbitrum
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

// Default spoke configurations - update these for your deployment
const DEFAULT_SPOKE_CONFIGS = [
  {
    chainId: 42161, // Arbitrum
    spokeVault: "", // Fill in after spoke deployment
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC on Arbitrum
    enabled: true,
  },
  {
    chainId: 1, // Ethereum Mainnet
    spokeVault: "", // Fill in after spoke deployment
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Mainnet
    enabled: false, // Disabled by default until spoke is ready
  },
  {
    chainId: 137, // Polygon
    spokeVault: "", // Fill in after spoke deployment
    usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC on Polygon
    enabled: false,
  },
];

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`\n🔧 REGISTER SPOKES ON COLLATERAL HUB - ${networkName.toUpperCase()}`);
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Get CollateralHub address
  const hubAddress = process.env.COLLATERAL_HUB_ADDRESS;
  if (!hubAddress || !ethers.isAddress(hubAddress)) {
    console.error("❌ COLLATERAL_HUB_ADDRESS not set or invalid");
    process.exit(1);
  }
  console.log(`\n📋 CollateralHub: ${hubAddress}`);

  // Load spoke configs from env or use defaults
  let spokeConfigs = DEFAULT_SPOKE_CONFIGS;
  if (process.env.SPOKE_CONFIGS) {
    try {
      spokeConfigs = JSON.parse(process.env.SPOKE_CONFIGS);
      console.log(`   Loaded ${spokeConfigs.length} spoke configs from SPOKE_CONFIGS env`);
    } catch (e) {
      console.log(`   ⚠️ Could not parse SPOKE_CONFIGS, using defaults`);
    }
  }

  // Connect to CollateralHub
  const hubAbi = [
    "function registerSpoke(uint64 chainId, (address spokeVault, address usdc, bool enabled) cfg) external",
    "function setSpokeEnabled(uint64 chainId, bool enabled) external",
    "function spokes(uint64 chainId) view returns (address spokeVault, address usdc, bool enabled)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function grantRole(bytes32 role, address account) external",
    "function BRIDGE_INBOX_ROLE() view returns (bytes32)",
  ];

  const hub = new ethers.Contract(hubAddress, hubAbi, deployer);

  // Check admin role
  const ADMIN_ROLE = await hub.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await hub.hasRole(ADMIN_ROLE, deployer.address);
  if (!hasAdmin) {
    console.error(`\n❌ Deployer does not have DEFAULT_ADMIN_ROLE on CollateralHub`);
    process.exit(1);
  }
  console.log(`\n✅ Deployer has admin role`);

  // Register each spoke
  console.log(`\n📝 Registering spokes...`);

  for (const cfg of spokeConfigs) {
    if (!cfg.spokeVault || !ethers.isAddress(cfg.spokeVault)) {
      console.log(`   ⚠️ Skipping chain ${cfg.chainId}: spokeVault not configured`);
      continue;
    }
    if (!cfg.usdc || !ethers.isAddress(cfg.usdc)) {
      console.log(`   ⚠️ Skipping chain ${cfg.chainId}: usdc not configured`);
      continue;
    }

    try {
      // Check if already registered
      const existing = await hub.spokes(cfg.chainId);
      if (existing.spokeVault !== ethers.ZeroAddress) {
        console.log(`   ℹ️ Chain ${cfg.chainId} already registered: ${existing.spokeVault}`);
        
        // Update enabled status if different
        if (existing.enabled !== cfg.enabled) {
          console.log(`      Updating enabled status to: ${cfg.enabled}`);
          const tx = await hub.setSpokeEnabled(cfg.chainId, cfg.enabled);
          await tx.wait();
          console.log(`      ✅ Status updated`);
        }
        continue;
      }

      console.log(`   Registering chain ${cfg.chainId}...`);
      console.log(`      spokeVault: ${cfg.spokeVault}`);
      console.log(`      usdc: ${cfg.usdc}`);
      console.log(`      enabled: ${cfg.enabled}`);

      const tx = await hub.registerSpoke(cfg.chainId, {
        spokeVault: cfg.spokeVault,
        usdc: cfg.usdc,
        enabled: cfg.enabled,
      });
      await tx.wait();
      console.log(`      ✅ Registered`);
    } catch (e) {
      console.log(`   ⚠️ Error registering chain ${cfg.chainId}: ${e.message}`);
    }
  }

  // Grant BRIDGE_INBOX_ROLE to bridge inbox if specified
  const bridgeInboxAddress = process.env.HUB_BRIDGE_INBOX_ADDRESS;
  if (bridgeInboxAddress && ethers.isAddress(bridgeInboxAddress)) {
    console.log(`\n🔧 Granting BRIDGE_INBOX_ROLE to: ${bridgeInboxAddress}`);
    const BRIDGE_INBOX_ROLE = await hub.BRIDGE_INBOX_ROLE();
    const hasRole = await hub.hasRole(BRIDGE_INBOX_ROLE, bridgeInboxAddress);
    if (!hasRole) {
      const tx = await hub.grantRole(BRIDGE_INBOX_ROLE, bridgeInboxAddress);
      await tx.wait();
      console.log(`   ✅ Role granted`);
    } else {
      console.log(`   ✅ Already has role`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ SPOKE REGISTRATION COMPLETE`);
  console.log(`${"═".repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  });
