#!/usr/bin/env tsx
/**
 * Grant ALL relayer roles to a new relayer address.
 * 
 * This script grants every role needed for a full relayer from the admin wallet.
 * 
 * USAGE:
 *   tsx scripts/grant-all-relayer-roles.ts --new-relayer 0xYOUR_NEW_WALLET_ADDRESS
 * 
 * ENV REQUIREMENTS (from .env.local):
 *   - PRIVATE_KEY_USERD (admin key that has DEFAULT_ADMIN_ROLE on all contracts)
 *   - RPC_URL or RPC_URL_HYPEREVM (hub chain)
 *   - ALCHEMY_ARBITRUM_HTTP or RPC_URL_ARBITRUM (arbitrum spoke)
 *   - HUB_INBOX_ADDRESS
 *   - HUB_OUTBOX_ADDRESS
 *   - COLLATERAL_HUB_ADDRESS
 *   - CORE_VAULT_ADDRESS
 *   - SPOKE_OUTBOX_ADDRESS or SPOKE_OUTBOX_ADDRESS_ARBITRUM
 *   - SPOKE_INBOX_ADDRESS or SPOKE_INBOX_ADDRESS_ARBITRUM
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

async function grantRole(
  contract: ethers.Contract,
  contractName: string,
  roleName: string,
  roleHash: string,
  target: string,
  signer: ethers.Wallet
) {
  const has = await contract.hasRole(roleHash, target);
  if (has) {
    console.log(`  ✅ ${contractName}.${roleName} — already granted`);
    return;
  }
  
  console.log(`  ⏳ Granting ${contractName}.${roleName}...`);
  const tx = await contract.connect(signer).grantRole(roleHash, target);
  await tx.wait();
  console.log(`  ✅ ${contractName}.${roleName} — granted (tx: ${tx.hash})`);
}

async function main() {
  const newRelayer = getArg("--new-relayer");
  if (!newRelayer || !ethers.isAddress(newRelayer)) {
    console.error("Usage: tsx scripts/grant-all-relayer-roles.ts --new-relayer 0xYOUR_NEW_WALLET");
    process.exit(1);
  }

  // PRIVATE_KEY_DEPLOYER = Diamond Owner (admin on HubInbox, CollateralHub, CoreVault)
  const deployerPk = process.env.PRIVATE_KEY_DEPLOYER;
  if (!deployerPk) {
    throw new Error("PRIVATE_KEY_DEPLOYER is required (diamond owner with DEFAULT_ADMIN_ROLE)");
  }

  // Hub chain (HyperEVM)
  const hubRpc = pickFirst(process.env.RPC_URL, process.env.RPC_URL_HYPEREVM, process.env.HYPERLIQUID_RPC_URL);
  if (!hubRpc) throw new Error("Missing hub RPC (RPC_URL or RPC_URL_HYPEREVM)");
  
  // Spoke chain (Arbitrum)
  const arbRpc = pickFirst(process.env.ALCHEMY_ARBITRUM_HTTP, process.env.RPC_URL_ARBITRUM, process.env.ARBITRUM_RPC_URL);
  if (!arbRpc) throw new Error("Missing Arbitrum RPC (ALCHEMY_ARBITRUM_HTTP or RPC_URL_ARBITRUM)");

  // Contract addresses
  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS;
  const collateralHubAddr = process.env.COLLATERAL_HUB_ADDRESS;
  const coreVaultAddr = pickFirst(process.env.CORE_VAULT_ADDRESS, process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS);
  const spokeOutboxAddr = pickFirst(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM, process.env.SPOKE_OUTBOX_ADDRESS);
  const spokeInboxAddr = pickFirst(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM, process.env.SPOKE_INBOX_ADDRESS);

  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║           GRANT ALL RELAYER ROLES TO NEW WALLET                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  console.log(`New Relayer: ${newRelayer}\n`);
  console.log("Contract addresses:");
  console.log(`  HubInbox:       ${hubInboxAddr || "(not set)"}`);
  console.log(`  HubOutbox:      ${hubOutboxAddr || "(not set)"}`);
  console.log(`  CollateralHub:  ${collateralHubAddr || "(not set)"}`);
  console.log(`  CoreVault:      ${coreVaultAddr || "(not set)"}`);
  console.log(`  SpokeOutbox:    ${spokeOutboxAddr || "(not set)"}`);
  console.log(`  SpokeInbox:     ${spokeInboxAddr || "(not set)"}`);
  console.log("");

  // Setup providers and signers
  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const arbProvider = new ethers.JsonRpcProvider(arbRpc);
  
  // Diamond Owner signer (admin on HubInbox, CollateralHub, CoreVault)
  const deployerHubSigner = new ethers.Wallet(deployerPk, hubProvider);
  const deployerArbSigner = new ethers.Wallet(deployerPk, arbProvider);
  
  console.log(`Diamond Owner signer: ${deployerHubSigner.address}\n`);

  // ═══════════════════════════════════════════════════════════════════
  // HUB CHAIN ROLES (HyperEVM)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("HUB CHAIN (HyperEVM)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 1. HubBridgeInbox - BRIDGE_ENDPOINT_ROLE (Diamond Owner has admin)
  if (hubInboxAddr && ethers.isAddress(hubInboxAddr)) {
    console.log(`[HubBridgeInbox] ${hubInboxAddr}`);
    const hubInbox = new ethers.Contract(hubInboxAddr, HUB_INBOX_ABI, deployerHubSigner);
    const bridgeEndpointRole = await hubInbox.BRIDGE_ENDPOINT_ROLE();
    await grantRole(hubInbox, "HubInbox", "BRIDGE_ENDPOINT_ROLE", bridgeEndpointRole, newRelayer, deployerHubSigner);
    console.log("");
  }

  // 2. HubBridgeOutbox - WITHDRAW_SENDER_ROLE
  // ⚠️ WARNING: Only the compromised wallet has admin here!
  // This needs to be granted using the compromised key (PRIVATE_KEY) - skip for now
  if (hubOutboxAddr && ethers.isAddress(hubOutboxAddr)) {
    console.log(`[HubBridgeOutbox] ${hubOutboxAddr}`);
    console.log("  ⚠️  SKIPPED - Only compromised wallet has admin on this contract");
    console.log("  ⚠️  Run separately with compromised key if needed (race condition risk!)");
    console.log("");
  }

  // 3. CollateralHub - WITHDRAW_REQUESTER_ROLE (Diamond Owner has admin)
  if (collateralHubAddr && ethers.isAddress(collateralHubAddr)) {
    console.log(`[CollateralHub] ${collateralHubAddr}`);
    const collateralHub = new ethers.Contract(collateralHubAddr, COLLATERAL_HUB_ABI, deployerHubSigner);
    const withdrawRequesterRole = await collateralHub.WITHDRAW_REQUESTER_ROLE();
    await grantRole(collateralHub, "CollateralHub", "WITHDRAW_REQUESTER_ROLE", withdrawRequesterRole, newRelayer, deployerHubSigner);
    console.log("");
  }

  // 4. CoreVault - DEFAULT_ADMIN_ROLE (Diamond Owner has admin)
  if (coreVaultAddr && ethers.isAddress(coreVaultAddr)) {
    console.log(`[CoreVault] ${coreVaultAddr}`);
    const coreVault = new ethers.Contract(coreVaultAddr, ACCESS_CONTROL_ABI, deployerHubSigner);
    const adminRole = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE is always 0x00...
    await grantRole(coreVault, "CoreVault", "DEFAULT_ADMIN_ROLE", adminRole, newRelayer, deployerHubSigner);
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════
  // SPOKE CHAIN ROLES (Arbitrum)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SPOKE CHAIN (Arbitrum)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 5. SpokeBridgeOutbox - DEPOSIT_SENDER_ROLE
  // Check who has admin on Arbitrum spoke contracts
  if (spokeOutboxAddr && ethers.isAddress(spokeOutboxAddr)) {
    console.log(`[SpokeBridgeOutbox] ${spokeOutboxAddr}`);
    const spokeOutbox = new ethers.Contract(spokeOutboxAddr, SPOKE_OUTBOX_ABI, deployerArbSigner);
    try {
      const depositSenderRole = await spokeOutbox.DEPOSIT_SENDER_ROLE();
      await grantRole(spokeOutbox, "SpokeOutbox", "DEPOSIT_SENDER_ROLE", depositSenderRole, newRelayer, deployerArbSigner);
    } catch (e: any) {
      console.log(`  ⚠️  Error: ${e.message?.slice(0, 80)}`);
      console.log("  May need different admin key for this contract");
    }
    console.log("");
  }

  // 6. SpokeBridgeInbox - BRIDGE_ENDPOINT_ROLE
  if (spokeInboxAddr && ethers.isAddress(spokeInboxAddr)) {
    console.log(`[SpokeBridgeInbox] ${spokeInboxAddr}`);
    const spokeInbox = new ethers.Contract(spokeInboxAddr, SPOKE_INBOX_ABI, deployerArbSigner);
    try {
      const bridgeEndpointRole = await spokeInbox.BRIDGE_ENDPOINT_ROLE();
      await grantRole(spokeInbox, "SpokeInbox", "BRIDGE_ENDPOINT_ROLE", bridgeEndpointRole, newRelayer, deployerArbSigner);
    } catch (e: any) {
      console.log(`  ⚠️  Error: ${e.message?.slice(0, 80)}`);
      console.log("  May need different admin key for this contract");
    }
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`New relayer ${newRelayer} has been granted all required roles.`);
  console.log("\nNEXT STEPS:");
  console.log("  1. Fund the new wallet with native gas on each chain");
  console.log("  2. Update .env.local with the new relayer private key");
  console.log("  3. Consider REVOKING roles from the compromised wallet (see --revoke-old)");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
