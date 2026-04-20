#!/usr/bin/env node
/**
 * Deploy new CoreVault implementation with setPosIdx function
 */

const { ethers } = require("hardhat");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val.split("#")[0].split(" ")[0].trim();
}

async function main() {
  console.log("\n=== Deploy CoreVault Fix ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  const vaultProxy = requireEnv("CORE_VAULT_ADDRESS");
  const collateralToken = requireEnv("MOCK_USDC_ADDRESS");
  const positionManagerAddr = "0x8e3dAF0040C4ea49007ead181602c25b1b82C1CC";

  console.log("Deploying new CoreVault implementation...");
  const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: positionManagerAddr },
  });
  
  const newImpl = await CoreVaultImpl.deploy(collateralToken);
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("✓ New implementation:", newImplAddr);

  console.log("\nUpgrading proxy...");
  const vault = await ethers.getContractAt("CoreVault", vaultProxy);
  const tx = await vault.upgradeToAndCall(newImplAddr, "0x");
  const receipt = await tx.wait();
  console.log("✓ Upgraded (tx:", receipt.hash, ")");

  console.log("\n=== Done ===");
  console.log("New CoreVault impl:", newImplAddr);
  console.log("\nNow run: npx hardhat run scripts/init-position-indexes.js --network hyperliquid");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
