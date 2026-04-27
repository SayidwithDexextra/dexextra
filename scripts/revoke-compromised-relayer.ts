#!/usr/bin/env tsx
/**
 * REVOKE all roles from a compromised relayer wallet.
 * 
 * This script revokes every role from the specified address.
 * Run this AFTER granting roles to the new relayer.
 * 
 * USAGE:
 *   tsx scripts/revoke-compromised-relayer.ts --compromised 0xCOMPROMISED_WALLET
 * 
 * ENV REQUIREMENTS (from .env.local):
 *   - PRIVATE_KEY_USERD (admin key that has DEFAULT_ADMIN_ROLE on all contracts)
 *   - RPC_URL or RPC_URL_HYPEREVM (hub chain)
 *   - ALCHEMY_ARBITRUM_HTTP or RPC_URL_ARBITRUM (arbitrum spoke)
 *   - Contract addresses (HUB_INBOX_ADDRESS, etc.)
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

const HUB_INBOX_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function BRIDGE_ENDPOINT_ROLE() view returns (bytes32)",
];

const HUB_OUTBOX_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function WITHDRAW_SENDER_ROLE() view returns (bytes32)",
];

const COLLATERAL_HUB_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function WITHDRAW_REQUESTER_ROLE() view returns (bytes32)",
];

const SPOKE_OUTBOX_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function DEPOSIT_SENDER_ROLE() view returns (bytes32)",
];

const SPOKE_INBOX_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function BRIDGE_ENDPOINT_ROLE() view returns (bytes32)",
];

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function pickFirst(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return "";
}

async function revokeRole(
  contract: ethers.Contract,
  contractName: string,
  roleName: string,
  roleHash: string,
  target: string,
  signer: ethers.Wallet
) {
  const has = await contract.hasRole(roleHash, target);
  if (!has) {
    console.log(`  ⚪ ${contractName}.${roleName} — not granted (nothing to revoke)`);
    return;
  }
  
  console.log(`  ⏳ Revoking ${contractName}.${roleName}...`);
  const tx = await contract.connect(signer).revokeRole(roleHash, target);
  await tx.wait();
  console.log(`  🔴 ${contractName}.${roleName} — REVOKED (tx: ${tx.hash})`);
}

async function main() {
  const compromised = getArg("--compromised");
  if (!compromised || !ethers.isAddress(compromised)) {
    console.error("Usage: tsx scripts/revoke-compromised-relayer.ts --compromised 0xCOMPROMISED_WALLET");
    process.exit(1);
  }

  // We need different keys for different contracts:
  // - PRIVATE_KEY_DEPLOYER (Diamond Owner) has admin on: HubInbox, CollateralHub, CoreVault
  // - PRIVATE_KEY (Compromised) has admin on: HubOutbox, CoreVault, SpokeInbox
  const deployerPk = process.env.PRIVATE_KEY_DEPLOYER;
  const compromisedPk = process.env.PRIVATE_KEY;
  if (!deployerPk || !compromisedPk) {
    throw new Error("PRIVATE_KEY_DEPLOYER and PRIVATE_KEY required");
  }

  const hubRpc = pickFirst(process.env.RPC_URL, process.env.RPC_URL_HYPEREVM, process.env.HYPERLIQUID_RPC_URL);
  if (!hubRpc) throw new Error("Missing hub RPC");
  
  const arbRpc = pickFirst(process.env.ALCHEMY_ARBITRUM_HTTP, process.env.RPC_URL_ARBITRUM, process.env.ARBITRUM_RPC_URL);
  if (!arbRpc) throw new Error("Missing Arbitrum RPC");

  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS;
  const collateralHubAddr = process.env.COLLATERAL_HUB_ADDRESS;
  const coreVaultAddr = pickFirst(process.env.CORE_VAULT_ADDRESS, process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS);
  const spokeOutboxAddr = pickFirst(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM, process.env.SPOKE_OUTBOX_ADDRESS);
  const spokeInboxAddr = pickFirst(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM, process.env.SPOKE_INBOX_ADDRESS);

  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║      ⚠️  REVOKE ALL ROLES FROM COMPROMISED WALLET  ⚠️             ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  console.log(`Compromised wallet: ${compromised}\n`);

  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const arbProvider = new ethers.JsonRpcProvider(arbRpc);
  
  const hubSigner = new ethers.Wallet(adminPk, hubProvider);
  const arbSigner = new ethers.Wallet(adminPk, arbProvider);
  
  console.log(`Admin signer: ${hubSigner.address}\n`);

  // ═══════════════════════════════════════════════════════════════════
  // HUB CHAIN ROLES (HyperEVM)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("HUB CHAIN (HyperEVM) - REVOKING");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (hubInboxAddr && ethers.isAddress(hubInboxAddr)) {
    console.log(`[HubBridgeInbox] ${hubInboxAddr}`);
    const hubInbox = new ethers.Contract(hubInboxAddr, HUB_INBOX_ABI, hubSigner);
    const bridgeEndpointRole = await hubInbox.BRIDGE_ENDPOINT_ROLE();
    await revokeRole(hubInbox, "HubInbox", "BRIDGE_ENDPOINT_ROLE", bridgeEndpointRole, compromised, hubSigner);
    console.log("");
  }

  if (hubOutboxAddr && ethers.isAddress(hubOutboxAddr)) {
    console.log(`[HubBridgeOutbox] ${hubOutboxAddr}`);
    const hubOutbox = new ethers.Contract(hubOutboxAddr, HUB_OUTBOX_ABI, hubSigner);
    const withdrawSenderRole = await hubOutbox.WITHDRAW_SENDER_ROLE();
    await revokeRole(hubOutbox, "HubOutbox", "WITHDRAW_SENDER_ROLE", withdrawSenderRole, compromised, hubSigner);
    console.log("");
  }

  if (collateralHubAddr && ethers.isAddress(collateralHubAddr)) {
    console.log(`[CollateralHub] ${collateralHubAddr}`);
    const collateralHub = new ethers.Contract(collateralHubAddr, COLLATERAL_HUB_ABI, hubSigner);
    const withdrawRequesterRole = await collateralHub.WITHDRAW_REQUESTER_ROLE();
    await revokeRole(collateralHub, "CollateralHub", "WITHDRAW_REQUESTER_ROLE", withdrawRequesterRole, compromised, hubSigner);
    console.log("");
  }

  if (coreVaultAddr && ethers.isAddress(coreVaultAddr)) {
    console.log(`[CoreVault] ${coreVaultAddr}`);
    const coreVault = new ethers.Contract(coreVaultAddr, ACCESS_CONTROL_ABI, hubSigner);
    const adminRole = ethers.ZeroHash;
    await revokeRole(coreVault, "CoreVault", "DEFAULT_ADMIN_ROLE", adminRole, compromised, hubSigner);
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════
  // SPOKE CHAIN ROLES (Arbitrum)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SPOKE CHAIN (Arbitrum) - REVOKING");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (spokeOutboxAddr && ethers.isAddress(spokeOutboxAddr)) {
    console.log(`[SpokeBridgeOutbox] ${spokeOutboxAddr}`);
    const spokeOutbox = new ethers.Contract(spokeOutboxAddr, SPOKE_OUTBOX_ABI, arbSigner);
    const depositSenderRole = await spokeOutbox.DEPOSIT_SENDER_ROLE();
    await revokeRole(spokeOutbox, "SpokeOutbox", "DEPOSIT_SENDER_ROLE", depositSenderRole, compromised, arbSigner);
    console.log("");
  }

  if (spokeInboxAddr && ethers.isAddress(spokeInboxAddr)) {
    console.log(`[SpokeBridgeInbox] ${spokeInboxAddr}`);
    const spokeInbox = new ethers.Contract(spokeInboxAddr, SPOKE_INBOX_ABI, arbSigner);
    const bridgeEndpointRole = await spokeInbox.BRIDGE_ENDPOINT_ROLE();
    await revokeRole(spokeInbox, "SpokeInbox", "BRIDGE_ENDPOINT_ROLE", bridgeEndpointRole, compromised, arbSigner);
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("REVOCATION COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`All roles revoked from compromised wallet: ${compromised}`);
  console.log("\n⚠️  IMPORTANT: Also drain any remaining funds from the compromised wallet!");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
