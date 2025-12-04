#!/usr/bin/env node

/**
 * Register a spoke on the hub CollateralHub.
 *
 * Env required:
 * - COLLATERAL_HUB_ADDRESS
 * - TARGET_SPOKE=POLYGON|ARBITRUM (upper/lower ok)
 * - SPOKE_<TARGET>_VAULT_ADDRESS
 * - SPOKE_<TARGET>_USDC_ADDRESS
 * - SPOKE_CHAIN_ID (optional; defaults: POLYGON=137, ARBITRUM=42161)
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function toTag(s) {
  const v = String(s || "").toUpperCase();
  if (v === "POLYGON" || v === "ARBITRUM") return v;
  throw new Error(`Unsupported TARGET_SPOKE: ${s}`);
}

function defaultChainId(tag) {
  if (tag === "POLYGON") return 137;
  if (tag === "ARBITRUM") return 42161;
  return 0;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const hubAddr = process.env.COLLATERAL_HUB_ADDRESS;
  if (!hubAddr) throw new Error("COLLATERAL_HUB_ADDRESS is required");

  const tag = toTag(process.env.TARGET_SPOKE || "POLYGON");
  const spokeVault = process.env[`SPOKE_${tag}_VAULT_ADDRESS`];
  const usdc = process.env[`SPOKE_${tag}_USDC_ADDRESS`];
  if (!spokeVault || !usdc) {
    throw new Error(`Missing spoke envs: SPOKE_${tag}_VAULT_ADDRESS and SPOKE_${tag}_USDC_ADDRESS`);
  }
  const chainId = Number(process.env.SPOKE_CHAIN_ID || defaultChainId(tag));
  if (!chainId) throw new Error("SPOKE_CHAIN_ID is required for this TARGET_SPOKE");

  console.log("\n🔗 Register Spoke on Hub");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (hub)`);
  console.log(`CollateralHub: ${hubAddr}`);
  console.log(`Spoke: chainId=${chainId}, vault=${spokeVault}, usdc=${usdc}`);

  const hub = await ethers.getContractAt("CollateralHub", hubAddr);
  const tx = await hub.registerSpoke(chainId, {
    spokeVault: spokeVault,
    usdc: usdc,
    enabled: true,
  });
  await tx.wait();
  console.log("  ✅ Spoke registered");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});






