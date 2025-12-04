#!/usr/bin/env node

/**
 * Configure SpokeBridgeOutboxWormhole remote app mapping for the hub domain.
 *
 * Spoke (Polygon/Arbitrum):
 *  - Requires: SPOKE_OUTBOX_ADDRESS
 *  - Remote app set to: bytes32(HUB_INBOX_ADDRESS) by default
 *  - Domain: BRIDGE_DOMAIN_HUB (e.g., 999 for Hyperliquid EVM)
 *
 * Usage:
 *   SPOKE_OUTBOX_ADDRESS=0x... HUB_INBOX_ADDRESS=0x... BRIDGE_DOMAIN_HUB=999 \\
 *   npx hardhat run scripts/configure-spoke-outbox-remote-app.js --network polygon
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function toBytes32Address(addr) {
  if (!addr) return "0x" + "00".repeat(32);
  const hex = String(addr).toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
  return "0x" + "0".repeat(24) + hex;
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

  console.log("\n⚙️ Configure Spoke Outbox remote app");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Admin/Deployer: ${deployer.address}`);

  const outboxAddr = process.env.SPOKE_OUTBOX_ADDRESS;
  const hubInbox = process.env.HUB_INBOX_ADDRESS;
  const domainHub = process.env.BRIDGE_DOMAIN_HUB || "999";
  if (!outboxAddr) throw new Error("SPOKE_OUTBOX_ADDRESS is required");
  if (!hubInbox) throw new Error("HUB_INBOX_ADDRESS is required");

  const remoteApp = toBytes32Address(hubInbox);
  console.log(`Outbox: ${outboxAddr}`);
  console.log(`Hub Inbox: ${hubInbox} -> remoteApp(bytes32): ${remoteApp}`);
  console.log(`Domain (hub): ${domainHub}`);

  const outbox = await ethers.getContractAt("SpokeBridgeOutboxWormhole", outboxAddr);
  const feeOv = await feeOverridesForNetwork(networkName);
  console.log(
    `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
  );
  const tx = await outbox.setRemoteApp(Number(domainHub), remoteApp, {
    ...feeOv,
    gasLimit: 200000n,
  });
  console.log(`  ⛽ setRemoteApp tx: ${tx.hash}`);
  await tx.wait();
  console.log("  ✅ Spoke Outbox remote app configured");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





