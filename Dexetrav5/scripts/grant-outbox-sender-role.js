#!/usr/bin/env node

/**
 * Grant DEPOSIT_SENDER_ROLE on the current network's SpokeBridgeOutboxWormhole to an EOA/contract.
 *
 * Spoke (Polygon/Arbitrum):
 *  - Requires: SPOKE_OUTBOX_ADDRESS
 *  - Sender address from: DEPOSIT_SENDER_ADDRESS (preferred) or BRIDGE_ENDPOINT_<TAG>
 *
 * Usage examples:
 *   SPOKE_OUTBOX_ADDRESS=0x... DEPOSIT_SENDER_ADDRESS=0x... npx hardhat run scripts/grant-outbox-sender-role.js --network polygon
 *   SPOKE_OUTBOX_ADDRESS=0x... BRIDGE_ENDPOINT_POLYGON=0x... npx hardhat run scripts/grant-outbox-sender-role.js --network polygon
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function upperTagFromNetwork(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai")) return "POLYGON";
  if (n.includes("arbitrum")) return "ARBITRUM";
  return n.toUpperCase();
}

async function feeOverridesForNetwork(networkName) {
  // Conservative fee overrides to avoid stuck tx on L2/L1s where feeData can be sparse
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
  // Pad maxFee to comfortably outbid base + priority under fluctuation
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const tag = upperTagFromNetwork(networkName);
  const DEPOSIT_SENDER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE")
  );

  console.log("\n🔒 Grant DEPOSIT_SENDER_ROLE (Spoke Outbox)");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (${tag})`);
  console.log(`Admin/Deployer: ${deployer.address}`);

  if (!(tag === "POLYGON" || tag === "ARBITRUM")) {
    throw new Error("This script is intended for spoke networks (polygon/arbitrum)");
  }

  const outboxAddr = process.env.SPOKE_OUTBOX_ADDRESS;
  const sender =
    process.env.DEPOSIT_SENDER_ADDRESS || process.env[`BRIDGE_ENDPOINT_${tag}`];

  if (!outboxAddr) {
    throw new Error("SPOKE_OUTBOX_ADDRESS is required on spoke network");
  }
  if (!sender) {
    throw new Error(
      "DEPOSIT_SENDER_ADDRESS (or BRIDGE_ENDPOINT_<TAG>) is required on spoke network"
    );
  }

  console.log(`Outbox: ${outboxAddr}`);
  console.log(`Sender: ${sender}`);

  const outbox = await ethers.getContractAt(
    "SpokeBridgeOutboxWormhole",
    outboxAddr
  );
  const has = await outbox.hasRole(DEPOSIT_SENDER_ROLE, sender);
  if (!has) {
    const feeOv = await feeOverridesForNetwork(networkName);
    console.log(
      `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
    );
    const tx = await outbox.grantRole(DEPOSIT_SENDER_ROLE, sender, {
      ...feeOv,
      gasLimit: 150000n,
    });
    await tx.wait();
    console.log("  ✅ Granted DEPOSIT_SENDER_ROLE on SPOKE_OUTBOX");
  } else {
    console.log("  ℹ️ Sender already has DEPOSIT_SENDER_ROLE on SPOKE_OUTBOX");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


