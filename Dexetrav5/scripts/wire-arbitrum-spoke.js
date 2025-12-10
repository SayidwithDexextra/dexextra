#!/usr/bin/env node

// Wires CollateralHub + HubInbox/Outbox for the Arbitrum spoke (no deployments).
// - Registers/enables the Arbitrum spoke on CollateralHub
// - Ensures roles: CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub; CollateralHub.BRIDGE_INBOX_ROLE -> HubInbox; HubInbox.BRIDGE_ENDPOINT_ROLE -> relayer
// - Ensures HubInbox points to CollateralHub (setCollateralHub)
// - Sets HubInbox.remoteAppByDomain to the Arbitrum SpokeOutbox
// - Sets HubOutbox.remoteAppByDomain to the Arbitrum SpokeInbox (for withdraw path)
//
// Required env:
//   HUB_INBOX_ADDRESS
//   HUB_OUTBOX_ADDRESS
//   COLLATERAL_HUB_ADDRESS
//   CORE_VAULT_ADDRESS
//   CORE_VAULT_OPERATOR_ADDRESS (used for setCoreVaultParams fallback)
//   BRIDGE_ENDPOINT_HUB               (relayer for HubInbox)
//   BRIDGE_DOMAIN_ARBITRUM=42161
//   SPOKE_ARBITRUM_VAULT_ADDRESS
//   SPOKE_ARBITRUM_USDC_ADDRESS
//   SPOKE_OUTBOX_ADDRESS_ARBITRUM     (for remoteApp on HubInbox)
//   SPOKE_INBOX_ADDRESS_ARBITRUM      (for remoteApp on HubOutbox)
//
// Usage:
//   npx hardhat run scripts/wire-arbitrum-spoke.js --network hyperliquid

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

function asAddress(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  try {
    return ethers.getAddress(v);
  } catch {
    throw new Error(`Invalid address for ${name}: ${v}`);
  }
}

function optAddress(name) {
  const v = (process.env[name] || "").trim();
  if (!v) return "";
  return ethers.getAddress(v);
}

function toBytes32Address(addr) {
  return ethers.hexlify(ethers.zeroPadValue(ethers.getAddress(addr), 32));
}

async function ensureRole(contract, role, account, label) {
  const has = await contract.hasRole(role, account);
  if (has) {
    console.log(`  ℹ️ ${label} already set -> ${account}`);
    return;
  }
  const tx = await contract.grantRole(role, account);
  await tx.wait();
  console.log(`  ✅ granted ${label} to ${account} (tx ${tx.hash})`);
}

async function setIfDifferent(contract, fn, args, label) {
  const tx = await contract[fn](...args);
  await tx.wait();
  console.log(`  ✅ ${label} (tx ${tx.hash})`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("\n🔧 Wire Arbitrum Spoke (no deploy)");
  console.log("────────────────────────────────────────");
  console.log(`Network: ${hre.network.name} (chainId ${net.chainId})`);
  console.log(`Signer:  ${await signer.getAddress()}`);

  const hubInboxAddr = asAddress("HUB_INBOX_ADDRESS");
  const hubOutboxAddr = asAddress("HUB_OUTBOX_ADDRESS");
  const collateralHubAddr = asAddress("COLLATERAL_HUB_ADDRESS");
  const coreVaultAddr = asAddress("CORE_VAULT_ADDRESS");
  const coreVaultOperator =
    optAddress("CORE_VAULT_OPERATOR_ADDRESS") || signer.address;
  const relayer = asAddress("BRIDGE_ENDPOINT_HUB");

  const domainRaw = process.env.BRIDGE_DOMAIN_ARBITRUM;
  if (!domainRaw) throw new Error("Missing BRIDGE_DOMAIN_ARBITRUM");
  const domain = Number(domainRaw);
  if (!Number.isFinite(domain) || domain <= 0)
    throw new Error("Invalid BRIDGE_DOMAIN_ARBITRUM");

  const spokeVault = asAddress("SPOKE_ARBITRUM_VAULT_ADDRESS");
  const spokeUsdc = asAddress("SPOKE_ARBITRUM_USDC_ADDRESS");
  const spokeOutbox = asAddress("SPOKE_OUTBOX_ADDRESS_ARBITRUM");
  const spokeInbox = optAddress("SPOKE_INBOX_ADDRESS_ARBITRUM");

  const hubInbox = await ethers.getContractAt(
    "HubBridgeInboxWormhole",
    hubInboxAddr,
    signer
  );
  const hubOutbox = await ethers.getContractAt(
    "HubBridgeOutboxWormhole",
    hubOutboxAddr,
    signer
  );
  const collateralHub = await ethers.getContractAt(
    "CollateralHub",
    collateralHubAddr,
    signer
  );
  const coreVault = await ethers.getContractAt(
    "CoreVault",
    coreVaultAddr,
    signer
  );

  // Ensure hub inbox points to the current collateral hub
  try {
    const cur = await hubInbox.collateralHub();
    if (ethers.getAddress(cur) !== collateralHubAddr) {
      const tx = await hubInbox.setCollateralHub(collateralHubAddr);
      await tx.wait();
      console.log(
        `  ✅ HubInbox.setCollateralHub -> ${collateralHubAddr} (tx ${tx.hash})`
      );
    } else {
      console.log("  ℹ️ HubInbox collateralHub already set");
    }
  } catch (e) {
    console.warn(
      "  ⚠️ Could not verify/set HubInbox.collateralHub",
      e?.message || e
    );
  }

  // Roles: CoreVault -> CollateralHub, CollateralHub -> HubInbox, HubInbox -> relayer
  await ensureRole(
    coreVault,
    await coreVault.EXTERNAL_CREDITOR_ROLE(),
    collateralHubAddr,
    "CoreVault.EXTERNAL_CREDITOR_ROLE"
  );
  await ensureRole(
    collateralHub,
    await collateralHub.BRIDGE_INBOX_ROLE(),
    hubInboxAddr,
    "CollateralHub.BRIDGE_INBOX_ROLE"
  );
  await ensureRole(
    hubInbox,
    await hubInbox.BRIDGE_ENDPOINT_ROLE(),
    relayer,
    "HubInbox.BRIDGE_ENDPOINT_ROLE"
  );

  // Point CollateralHub to CoreVault/operator (idempotent)
  await setIfDifferent(
    collateralHub,
    "setCoreVaultParams",
    [coreVaultAddr, coreVaultOperator],
    "CollateralHub.setCoreVaultParams"
  );

  // Register & enable Arbitrum spoke
  await setIfDifferent(
    collateralHub,
    "registerSpoke",
    [domain, [spokeVault, spokeUsdc, true]],
    `CollateralHub.registerSpoke(${domain})`
  );
  await setIfDifferent(
    collateralHub,
    "setSpokeEnabled",
    [domain, true],
    `CollateralHub.setSpokeEnabled(${domain})`
  );

  // Remote app allowlists
  await setIfDifferent(
    hubInbox,
    "setRemoteApp",
    [domain, toBytes32Address(spokeOutbox)],
    `HubInbox.setRemoteApp(${domain})`
  );
  if (spokeInbox) {
    await setIfDifferent(
      hubOutbox,
      "setRemoteApp",
      [domain, toBytes32Address(spokeInbox)],
      `HubOutbox.setRemoteApp(${domain})`
    );
  } else {
    console.log(
      "  ℹ️ Skipped HubOutbox remoteApp for Arbitrum (SPOKE_INBOX_ADDRESS_ARBITRUM missing)"
    );
  }

  console.log("\n✅ Arbitrum spoke wiring complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
