#!/usr/bin/env node

/**
 * Grant BRIDGE_ENDPOINT_ROLE on the current network's inbox to a relayer EOA/contract.
 *
 * Hub (HyperLiquid):
 *  - Requires: HUB_INBOX_ADDRESS, BRIDGE_ENDPOINT_HUB
 *  - Grants BRIDGE_ENDPOINT_ROLE to BRIDGE_ENDPOINT_HUB on HubBridgeInboxWormhole
 *
 * Spoke (Polygon/Arbitrum):
 *  - Requires: SPOKE_INBOX_ADDRESS, BRIDGE_ENDPOINT_<TAG>
 *  - Grants BRIDGE_ENDPOINT_ROLE to BRIDGE_ENDPOINT_<TAG> on SpokeBridgeInboxWormhole
 *
 * Optional override via CLI:
 *  - --endpoint 0xYourRelayerAddress  (overrides the env endpoint address)
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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--endpoint" && args[i + 1]) {
      out.endpoint = args[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const tag = upperTagFromNetwork(networkName);
  const { endpoint: endpointArg } = parseArgs();
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")
  );

  console.log("\n🔒 Grant BRIDGE_ENDPOINT_ROLE");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (${tag})`);
  console.log(`Admin/Deployer: ${deployer.address}`);

  if (tag === "POLYGON" || tag === "ARBITRUM") {
    const spokeInbox = process.env.SPOKE_INBOX_ADDRESS;
    const endpointKey = `BRIDGE_ENDPOINT_${tag}`;
    const endpoint =
      endpointArg || process.env[endpointKey];
    if (!spokeInbox) {
      throw new Error("SPOKE_INBOX_ADDRESS is required on spoke network");
    }
    if (!endpoint) {
      throw new Error(`${endpointKey} (or --endpoint) is required on spoke network`);
    }
    console.log(`Inbox: ${spokeInbox}`);
    console.log(`Endpoint: ${endpoint}`);

    const inbox = await ethers.getContractAt(
      "SpokeBridgeInboxWormhole",
      spokeInbox
    );
    const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpoint);
    if (!has) {
      const tx = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpoint);
      await tx.wait();
      console.log("  ✅ Granted BRIDGE_ENDPOINT_ROLE on SPOKE_INBOX");
    } else {
      console.log("  ℹ️ Endpoint already has BRIDGE_ENDPOINT_ROLE on SPOKE_INBOX");
    }
    return;
  }

  // Hub mode
  const hubInbox = process.env.HUB_INBOX_ADDRESS;
  const endpointHub = endpointArg || process.env.BRIDGE_ENDPOINT_HUB;
  if (!hubInbox) {
    throw new Error("HUB_INBOX_ADDRESS is required on hub network");
  }
  if (!endpointHub) {
    throw new Error("BRIDGE_ENDPOINT_HUB (or --endpoint) is required on hub network");
  }
  console.log(`Inbox: ${hubInbox}`);
  console.log(`Endpoint: ${endpointHub}`);

  const inbox = await ethers.getContractAt(
    "HubBridgeInboxWormhole",
    hubInbox
  );
  const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
  if (!has) {
    const tx = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
    await tx.wait();
    console.log("  ✅ Granted BRIDGE_ENDPOINT_ROLE on HUB_INBOX");
  } else {
    console.log("  ℹ️ Endpoint already has BRIDGE_ENDPOINT_ROLE on HUB_INBOX");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





