#!/usr/bin/env node

/**
 * Deploy hub-side (HyperLiquid) contracts for Wormhole messaging and wire roles.
 *
 * Produces/uses envs:
 * - CORE_VAULT_ADDRESS (required)
 * - COLLATERAL_HUB_ADDRESS (optional; deploys if empty)
 * - HUB_INBOX_ADDRESS (output)
 * - HUB_OUTBOX_ADDRESS (output)
 * - BRIDGE_DOMAIN_POLYGON, BRIDGE_DOMAIN_ARBITRUM (optional for allowlists)
 * - BRIDGE_REMOTE_APP_POLYGON, BRIDGE_REMOTE_APP_ARBITRUM (optional; if absent, will use SPOKE_OUTBOX_ADDRESS when available)
 * - BRIDGE_ENDPOINT_HUB (optional; will be granted BRIDGE_ENDPOINT_ROLE on inbox)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

function toBytes32Address(addr) {
  if (!addr) return "0x" + "00".repeat(32);
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
  return "0x" + "0".repeat(24) + hex;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";

  console.log("\n🌐 Hub Wormhole Deploy");
  console.log("─".repeat(60));
  console.log(`Network: ${networkName} (chainId ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  if (!coreVaultAddr) {
    throw new Error("CORE_VAULT_ADDRESS is required in env");
  }

  // Deploy or attach CollateralHub
  let collateralHubAddr = process.env.COLLATERAL_HUB_ADDRESS;
  let collateralHub;
  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  if (!collateralHubAddr) {
    console.log("Deploying CollateralHub...");
    // Operator not used by v2 math-only credits, but constructor requires it
    const operator = process.env.CORE_VAULT_OPERATOR_ADDRESS || deployer.address;
    collateralHub = await CollateralHub.deploy(deployer.address, coreVaultAddr, operator);
    await collateralHub.waitForDeployment();
    collateralHubAddr = await collateralHub.getAddress();
    console.log("  ✅ CollateralHub:", collateralHubAddr);
  } else {
    collateralHub = await ethers.getContractAt("CollateralHub", collateralHubAddr);
    console.log("Using existing CollateralHub:", collateralHubAddr);
  }

  // Grant EXTERNAL_CREDITOR_ROLE on CoreVault to CollateralHub
  try {
    const coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);
    const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
    const hasRole = await coreVault.hasRole(EXTERNAL_CREDITOR_ROLE, collateralHubAddr);
    if (!hasRole) {
      console.log("Granting EXTERNAL_CREDITOR_ROLE to CollateralHub on CoreVault...");
      await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, collateralHubAddr);
      console.log("  ✅ Role granted");
    } else {
      console.log("EXTERNAL_CREDITOR_ROLE already granted to CollateralHub");
    }
  } catch (e) {
    console.log("⚠️ Could not verify/grant EXTERNAL_CREDITOR_ROLE on CoreVault:", e?.message || e);
  }

  // Deploy Hub inbox/outbox (Wormhole)
  console.log("\nDeploying Hub Wormhole Inbox/Outbox...");
  const HubBridgeInbox = await ethers.getContractFactory("HubBridgeInboxWormhole");
  const inbox = await HubBridgeInbox.deploy(collateralHubAddr, deployer.address);
  await inbox.waitForDeployment();
  const inboxAddr = await inbox.getAddress();
  console.log("  ✅ HUB_INBOX_ADDRESS:", inboxAddr);

  const HubBridgeOutbox = await ethers.getContractFactory("HubBridgeOutboxWormhole");
  const outbox = await HubBridgeOutbox.deploy(deployer.address);
  await outbox.waitForDeployment();
  const outboxAddr = await outbox.getAddress();
  console.log("  ✅ HUB_OUTBOX_ADDRESS:", outboxAddr);

  // Wire roles on hub
  console.log("\nWiring hub roles...");
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  const hasInboxRole = await collateralHub.hasRole(BRIDGE_INBOX_ROLE, inboxAddr);
  if (!hasInboxRole) {
    await collateralHub.grantRole(BRIDGE_INBOX_ROLE, inboxAddr);
    console.log("  ✅ BRIDGE_INBOX_ROLE granted on CollateralHub to HUB_INBOX");
  } else {
    console.log("  ℹ️ BRIDGE_INBOX_ROLE already granted to HUB_INBOX");
  }

  // Optional: allow hub outbox to be used by requester (not strictly necessary)
  const WITHDRAW_SENDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_SENDER_ROLE"));
  try {
    const hasSender = await outbox.hasRole(WITHDRAW_SENDER_ROLE, deployer.address);
    if (!hasSender) {
      await outbox.grantRole(WITHDRAW_SENDER_ROLE, deployer.address);
      console.log("  ✅ WITHDRAW_SENDER_ROLE granted to deployer on HUB_OUTBOX");
    }
  } catch {}

  // Optional: set remote apps if envs provided
  console.log("\nConfiguring remote app allowlists (optional)...");
  const polygonDomain = process.env.BRIDGE_DOMAIN_POLYGON;
  const polygonRemoteApp =
    process.env.BRIDGE_REMOTE_APP_POLYGON ||
    (process.env.SPOKE_OUTBOX_ADDRESS ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS) : null);
  if (polygonDomain && polygonRemoteApp) {
    await inbox.setRemoteApp(Number(polygonDomain), polygonRemoteApp);
    console.log(`  ✅ HUB_INBOX trusts POLYGON app ${polygonRemoteApp} @ domain ${polygonDomain}`);
  } else {
    console.log("  ℹ️ Skipped setting POLYGON remote app on HUB_INBOX");
  }

  const hubDomain = process.env.BRIDGE_DOMAIN_HUB;
  const polygonInboxApp =
    process.env.SPOKE_INBOX_ADDRESS ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS) : null;
  if (polygonDomain && polygonInboxApp) {
    await outbox.setRemoteApp(Number(polygonDomain), polygonInboxApp);
    console.log(`  ✅ HUB_OUTBOX targets POLYGON inbox ${polygonInboxApp} @ domain ${polygonDomain}`);
  } else {
    console.log("  ℹ️ Skipped setting POLYGON remote app on HUB_OUTBOX");
  }

  // Optional: grant endpoint role to relayer/endpoint
  const endpointHub = process.env.BRIDGE_ENDPOINT_HUB;
  if (endpointHub) {
    const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
    const hasEp = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
    if (!hasEp) {
      await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpointHub);
      console.log("  ✅ Granted BRIDGE_ENDPOINT_ROLE on HUB_INBOX to", endpointHub);
    }
  }

  // Output helpful env lines
  console.log("\n🔑 Env values to set:");
  console.log(`HUB_INBOX_ADDRESS=${inboxAddr}`);
  console.log(`HUB_OUTBOX_ADDRESS=${outboxAddr}`);
  console.log(`COLLATERAL_HUB_ADDRESS=${collateralHubAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});






