#!/usr/bin/env node

/**
 * Deploy spoke-side contracts (SpokeVault + Wormhole Inbox/Outbox) and wire roles.
 *
 * Run with --network polygon (or arbitrum). Reads envs per chain tag:
 * - SPOKE_<TAG>_USDC_ADDRESS (required unless USE_MOCK_<TAG>_USDC truthy)
 * - USE_MOCK_<TAG>_USDC (optional)
 * - SPOKE_<TAG>_VAULT_ADDRESS (optional; deploys if empty)
 * - SPOKE_INBOX_ADDRESS, SPOKE_OUTBOX_ADDRESS (outputs)
 * - BRIDGE_DOMAIN_HUB (optional for allowlists)
 * - BRIDGE_REMOTE_APP_HUB (optional; if absent, will use HUB_OUTBOX_ADDRESS when available)
 * - BRIDGE_ENDPOINT_<TAG> (optional; will be granted BRIDGE_ENDPOINT_ROLE on spoke inbox)
 */

const { ethers } = require("hardhat");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
require("dotenv").config();

async function feeOverridesForNetwork(networkName) {
  // Conservative EIP-1559 fee overrides to avoid pending tx stall on L2/L1s
  // Falls back to 30 gwei tip when provider doesn't supply values
  let fee;
  try {
    fee = await Promise.race([
      ethers.provider.getFeeData(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("feeDataTimeout")), 8000)
      ),
    ]);
  } catch (e) {
    fee = {};
    console.log(
      `  ℹ️ feeData unavailable (${e?.message || e}), using default overrides`
    );
  }
  const isPolygon = String(networkName || "")
    .toLowerCase()
    .includes("polygon");
  const defaultTip = ethers.parseUnits(isPolygon ? "35" : "3", "gwei");
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas || defaultTip;
  const base = fee?.maxFeePerGas || fee?.gasPrice || defaultTip * 2n;
  // Pad maxFee to comfortably outbid base + priority under fluctuation
  const maxFeePerGas = base + maxPriorityFeePerGas * 2n;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function deployWithLog(factoryName, args, overrides, confirmations = 1) {
  const Factory = await ethers.getContractFactory(factoryName);
  const contract = await Factory.deploy(...args, overrides || {});
  const tx = contract.deploymentTransaction && contract.deploymentTransaction();
  if (tx?.hash) {
    console.log(`  ↳ ${factoryName} tx: ${tx.hash}`);
  }
  // Wait for N confirmations to reduce reorg/fee replacement issues
  if (tx?.wait) {
    await tx.wait(confirmations);
  }
  await contract.waitForDeployment();
  return contract;
}

function upperTagFromNetwork(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("polygon") || n.includes("mumbai")) return "POLYGON";
  if (n.includes("arbitrum")) return "ARBITRUM";
  return n.toUpperCase();
}

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
  const TAG = upperTagFromNetwork(networkName);

  console.log("\n🌉 Spoke Wormhole Deploy");
  console.log("─".repeat(60));
  console.log(
    `Network: ${networkName} (chainId ${network.chainId}) TAG=${TAG}`
  );
  console.log(`Deployer: ${deployer.address}`);

  // Resolve USDC (or mock)
  const usdcKey = `SPOKE_${TAG}_USDC_ADDRESS`;
  const useMockKey = `USE_MOCK_${TAG}_USDC`;
  let usdcAddr = process.env[usdcKey] || "";
  const useMock =
    !usdcAddr ||
    /^(1|true|yes|on)$/i.test(String(process.env[useMockKey] || "0"));
  if (useMock) {
    console.log(`Deploying SpokeMockUSDC as mock USDC for ${TAG}...`);
    const feeOv = await feeOverridesForNetwork(networkName);
    console.log(
      `  ↳ fee overrides: maxPriorityFeePerGas=${feeOv.maxPriorityFeePerGas?.toString?.()} maxFeePerGas=${feeOv.maxFeePerGas?.toString?.()}`
    );
    const mock = await deployWithLog(
      "SpokeMockUSDC",
      [deployer.address],
      feeOv,
      2
    );
    usdcAddr = await mock.getAddress?.();
    console.log("  ✅ Mock USDC:", usdcAddr);
  } else {
    console.log(`Using existing ${TAG} USDC:`, usdcAddr);
  }

  // Deploy SpokeVault (or reuse)
  const vaultKey = `SPOKE_${TAG}_VAULT_ADDRESS`;
  let vaultAddr = process.env[vaultKey];
  let vault;
  if (!vaultAddr) {
    console.log("Deploying SpokeVault...");
    const feeOv2 = await feeOverridesForNetwork(networkName);
    const initialAllowed = [usdcAddr];
    vault = await deployWithLog(
      "SpokeVault",
      [initialAllowed, deployer.address, ethers.ZeroAddress],
      feeOv2,
      1
    );
    vaultAddr = await vault.getAddress?.();
    console.log("  ✅ SpokeVault:", vaultAddr);
  } else {
    vault = await ethers.getContractAt("SpokeVault", vaultAddr);
    console.log("Using existing SpokeVault:", vaultAddr);
  }

  // Deploy Spoke inbox/outbox
  console.log("\nDeploying Spoke Wormhole Inbox/Outbox...");
  const feeOv3 = await feeOverridesForNetwork(networkName);
  const inbox = await deployWithLog(
    "SpokeBridgeInboxWormhole",
    [vaultAddr, deployer.address],
    feeOv3,
    1
  );
  const inboxAddr = await inbox.getAddress?.();
  console.log("  ✅ SPOKE_INBOX_ADDRESS:", inboxAddr);

  const feeOv4 = await feeOverridesForNetwork(networkName);
  const outbox = await deployWithLog(
    "SpokeBridgeOutboxWormhole",
    [deployer.address],
    feeOv4,
    1
  );
  const outboxAddr = await outbox.getAddress?.();
  console.log("  ✅ SPOKE_OUTBOX_ADDRESS:", outboxAddr);

  // Grant inbox role on vault
  console.log("\nWiring spoke roles...");
  const BRIDGE_INBOX_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE")
  );
  const hasInbox = await vault.hasRole(BRIDGE_INBOX_ROLE, inboxAddr);
  if (!hasInbox) {
    await vault.grantRole(BRIDGE_INBOX_ROLE, inboxAddr);
    console.log("  ✅ BRIDGE_INBOX_ROLE granted on SpokeVault to SPOKE_INBOX");
  } else {
    console.log("  ℹ️ BRIDGE_INBOX_ROLE already granted to SPOKE_INBOX");
  }

  // Optional: set remote app allowlist towards hub
  const hubDomain = process.env.BRIDGE_DOMAIN_HUB;
  const hubRemoteApp =
    process.env.BRIDGE_REMOTE_APP_HUB ||
    (process.env.HUB_OUTBOX_ADDRESS
      ? toBytes32Address(process.env.HUB_OUTBOX_ADDRESS)
      : null);
  if (hubDomain && hubRemoteApp) {
    await inbox.setRemoteApp(Number(hubDomain), hubRemoteApp);
    console.log(
      `  ✅ SPOKE_INBOX trusts HUB app ${hubRemoteApp} @ domain ${hubDomain}`
    );
  } else {
    console.log("  ℹ️ Skipped setting HUB remote app on SPOKE_INBOX");
  }

  // Optional: grant endpoint role to provider/relayer on spoke
  const endpointKey = `BRIDGE_ENDPOINT_${TAG}`;
  const endpoint = process.env[endpointKey];
  if (endpoint) {
    const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")
    );
    const hasEp = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, endpoint);
    if (!hasEp) {
      await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, endpoint);
      console.log(
        `  ✅ Granted BRIDGE_ENDPOINT_ROLE on SPOKE_INBOX to ${endpoint}`
      );
    }
  }

  console.log("\n🔑 Env values to set:");
  console.log(`${vaultKey}=${vaultAddr}`);
  console.log(`SPOKE_INBOX_ADDRESS=${inboxAddr}`);
  console.log(`SPOKE_OUTBOX_ADDRESS=${outboxAddr}`);
  console.log(`${usdcKey}=${usdcAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
