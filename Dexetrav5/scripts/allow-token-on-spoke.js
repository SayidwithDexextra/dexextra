#!/usr/bin/env node

/**
 * Allow a token on a SpokeVault (adds to allowed list) if not already allowed.
 *
 * Env:
 *  - SPOKE_VAULT_ADDRESS or chain-specific (e.g., SPOKE_ARBITRUM_VAULT_ADDRESS)
 *  - TOKEN_ADDRESS or chain-specific (e.g., SPOKE_ARBITRUM_USDC_ADDRESS)
 *
 * Usage:
 *  SPOKE_ARBITRUM_VAULT_ADDRESS=0x... SPOKE_ARBITRUM_USDC_ADDRESS=0x... \\
 *  npx hardhat run scripts/allow-token-on-spoke.js --network arbitrum
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function resolveEnvAddress(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && ethers.isAddress(v)) return v;
  }
  return null;
}

async function feeOverridesForNetwork(networkName) {
  let fee;
  try {
    fee = await Promise.race([
      ethers.provider.getFeeData(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("feeDataTimeout")), 8000)),
    ]);
  } catch (e) {
    fee = {};
    console.log(`  ℹ️ feeData unavailable (${e?.message || e}), using default overrides`);
  }
  const isPolygon = String(networkName || "").toLowerCase().includes("polygon");
  const defaultTip = ethers.parseUnits(isPolygon ? "35" : "3", "gwei");
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || defaultTip;
  const base = fee?.maxFeePerGas || fee?.gasPrice || defaultTip * 2n;
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";

  console.log("\n🔧 Allow token on SpokeVault");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Admin/Deployer: ${deployer.address}`);

  const vaultAddr =
    resolveEnvAddress(["SPOKE_VAULT_ADDRESS", "SPOKE_ARBITRUM_VAULT_ADDRESS", "SPOKE_POLYGON_VAULT_ADDRESS"]) ||
    process.env.SPOKE_VAULT_ADDRESS ||
    "";
  const tokenAddr =
    resolveEnvAddress(["TOKEN_ADDRESS", "SPOKE_ARBITRUM_USDC_ADDRESS", "SPOKE_POLYGON_USDC_ADDRESS"]) ||
    process.env.TOKEN_ADDRESS ||
    "";

  if (!vaultAddr) throw new Error("Missing SPOKE_VAULT_ADDRESS (or chain-specific) env");
  if (!tokenAddr) throw new Error("Missing TOKEN_ADDRESS (or chain-specific USDC env)");

  console.log(`Vault: ${vaultAddr}`);
  console.log(`Token: ${tokenAddr}`);

  const vault = await ethers.getContractAt("SpokeVault", vaultAddr);
  const currentlyAllowed = await vault.isAllowedToken(tokenAddr);
  if (currentlyAllowed) {
    console.log("  ℹ️ Token already allowed on SpokeVault");
    return;
  }

  const feeOv = await feeOverridesForNetwork(networkName);
  console.log(
    `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
  );
  const tx = await vault.addAllowedToken(tokenAddr, {
    ...feeOv,
    gasLimit: 150000n,
  });
  console.log(`  ⛽ addAllowedToken tx: ${tx.hash}`);
  await tx.wait();
  console.log("  ✅ Token allowed on SpokeVault");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





