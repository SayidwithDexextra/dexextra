#!/usr/bin/env node

/**
 * Configure remote app allowlists and endpoint roles on hub/spoke Wormhole adapters.
 *
 * Hub mode (run on HyperLiquid):
 *  - Requires HUB_INBOX_ADDRESS, HUB_OUTBOX_ADDRESS
 *  - Optionally sets:
 *     - inbox.setRemoteApp(BRIDGE_DOMAIN_POLYGON, BRIDGE_REMOTE_APP_POLYGON || bytes32(SPOKE_OUTBOX_ADDRESS))
 *     - inbox.setRemoteApp(BRIDGE_DOMAIN_ARBITRUM, BRIDGE_REMOTE_APP_ARBITRUM || bytes32(SPOKE_OUTBOX_ADDRESS_ARBITRUM))
 *     - outbox.setRemoteApp(BRIDGE_DOMAIN_POLYGON, bytes32(SPOKE_INBOX_ADDRESS))
 *     - outbox.setRemoteApp(BRIDGE_DOMAIN_ARBITRUM, bytes32(SPOKE_INBOX_ADDRESS_ARBITRUM))
 *     - inbox.grantRole(BRIDGE_ENDPOINT_ROLE, BRIDGE_ENDPOINT_HUB)
 *
 * Spoke mode (run on Polygon/Arbitrum):
 *  - Requires SPOKE_INBOX_ADDRESS (this chain)
 *  - Optionally sets:
 *     - inbox.setRemoteApp(BRIDGE_DOMAIN_HUB, BRIDGE_REMOTE_APP_HUB || bytes32(HUB_OUTBOX_ADDRESS))
 *     - inbox.grantRole(BRIDGE_ENDPOINT_ROLE, BRIDGE_ENDPOINT_<TAG>)
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function toBytes32Address(addr) {
  if (!addr) return "0x" + "00".repeat(32);
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
  return "0x" + "0".repeat(24) + hex;
}

function upperTagFromNetwork(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai")) return "POLYGON";
  if (n.includes("arbitrum")) return "ARBITRUM";
  return n.toUpperCase();
}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [deployer] = await ethers.getSigners();
  const tag = upperTagFromNetwork(networkName);
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));

  console.log("\n⚙️ Configure Wormhole allowlists");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (${tag})`);

  // Hub mode
  if (tag !== "POLYGON" && tag !== "ARBITRUM") {
    const hubInbox = process.env.HUB_INBOX_ADDRESS;
    const hubOutbox = process.env.HUB_OUTBOX_ADDRESS;
    if (!hubInbox || !hubOutbox) throw new Error("HUB_INBOX_ADDRESS and HUB_OUTBOX_ADDRESS are required on hub");
    const inbox = await ethers.getContractAt("HubBridgeInboxWormhole", hubInbox);
    const outbox = await ethers.getContractAt("HubBridgeOutboxWormhole", hubOutbox);

    const domainPolygon = process.env.BRIDGE_DOMAIN_POLYGON;
    const remoteAppPolygon =
      process.env.BRIDGE_REMOTE_APP_POLYGON ||
      (process.env.SPOKE_OUTBOX_ADDRESS_POLYGON
        ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_POLYGON)
        : process.env.SPOKE_OUTBOX_ADDRESS
        ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS)
        : null);
    if (domainPolygon && remoteAppPolygon) {
      await inbox.setRemoteApp(Number(domainPolygon), remoteAppPolygon);
      console.log(`  ✅ HUB_INBOX: set POLYGON remote app ${remoteAppPolygon}`);
    }
    const polygonInbox =
      process.env.SPOKE_INBOX_ADDRESS_POLYGON
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_POLYGON)
        : process.env.SPOKE_INBOX_ADDRESS
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS)
        : null;
    if (domainPolygon && polygonInbox) {
      await outbox.setRemoteApp(Number(domainPolygon), polygonInbox);
      console.log(`  ✅ HUB_OUTBOX: set POLYGON inbox ${polygonInbox}`);
    }

    // ARBITRUM mapping
    const domainArbitrum = process.env.BRIDGE_DOMAIN_ARBITRUM;
    const remoteAppArbitrum =
      process.env.BRIDGE_REMOTE_APP_ARBITRUM ||
      (process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM
        ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM)
        : null);
    if (domainArbitrum && remoteAppArbitrum) {
      await inbox.setRemoteApp(Number(domainArbitrum), remoteAppArbitrum);
      console.log(`  ✅ HUB_INBOX: set ARBITRUM remote app ${remoteAppArbitrum}`);
    }
    const arbitrumInbox = process.env.SPOKE_INBOX_ADDRESS_ARBITRUM
      ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM)
      : null;
    if (domainArbitrum && arbitrumInbox) {
      await outbox.setRemoteApp(Number(domainArbitrum), arbitrumInbox);
      console.log(`  ✅ HUB_OUTBOX: set ARBITRUM inbox ${arbitrumInbox}`);
    }

    const endpointHub = process.env.BRIDGE_ENDPOINT_HUB;
    if (endpointHub) {
      const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
      if (!has) {
        await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
        console.log(`  ✅ HUB_INBOX: granted BRIDGE_ENDPOINT_ROLE to ${endpointHub}`);
      }
    }

    console.log("Done (hub).");
    return;
  }

  // Spoke mode
  const spokeInbox = process.env.SPOKE_INBOX_ADDRESS;
  if (!spokeInbox) throw new Error("SPOKE_INBOX_ADDRESS is required on spoke");
  const inbox = await ethers.getContractAt("SpokeBridgeInboxWormhole", spokeInbox);

  const hubDomain = process.env.BRIDGE_DOMAIN_HUB;
  const hubRemote = process.env.BRIDGE_REMOTE_APP_HUB || (process.env.HUB_OUTBOX_ADDRESS ? toBytes32Address(process.env.HUB_OUTBOX_ADDRESS) : null);
  if (hubDomain && hubRemote) {
    await inbox.setRemoteApp(Number(hubDomain), hubRemote);
    console.log(`  ✅ SPOKE_INBOX: set HUB remote app ${hubRemote}`);
  }

  const endpointKey = `BRIDGE_ENDPOINT_${tag}`;
  const endpoint = process.env[endpointKey];
  if (endpoint) {
    const has = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpoint);
    if (!has) {
      await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpoint);
      console.log(`  ✅ SPOKE_INBOX: granted BRIDGE_ENDPOINT_ROLE to ${endpoint}`);
    }
  }

  console.log("Done (spoke).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



