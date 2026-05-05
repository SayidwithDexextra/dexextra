#!/usr/bin/env tsx
/**
 * Transfer HubBridgeOutbox admin from compromised key to new admin
 * 
 * This script grants DEFAULT_ADMIN_ROLE on HubBridgeOutbox to the new admin,
 * then updates the remote app to point to the new SpokeInboxAdapter.
 * 
 * Usage:
 *   COMPROMISED_KEY=0x... npx tsx scripts/transfer-hub-outbox-admin.ts
 *   COMPROMISED_KEY=0x... npx tsx scripts/transfer-hub-outbox-admin.ts --dry-run
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");

const HUB_OUTBOX_ADDRESS = process.env.HUB_OUTBOX_ADDRESS || "0x4c32ff22b927a134a3286d5E33212debF951AcF5";
const NEW_ADMIN = process.env.DIAMOND_OWNER_ADDRESS || "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";
const NEW_SPOKE_INBOX_ADAPTER = process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || "0x8FDFAF6146318DD893E89E5ac2e3FD73554c02b6";
const ARB_DOMAIN = 42161;

const HUB_OUTBOX_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setRemoteApp(uint64 remoteDomain, bytes32 remoteApp) external",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

function toBytes32Address(addr: string): string {
  return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║         TRANSFER HUB OUTBOX ADMIN                                         ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  if (DRY_RUN) {
    console.log("🔸 DRY RUN MODE - No transactions will be sent\n");
  }

  // Get compromised key from environment
  const compromisedKey = process.env.COMPROMISED_KEY;
  if (!compromisedKey) {
    console.log("❌ COMPROMISED_KEY environment variable required");
    console.log("");
    console.log("Usage:");
    console.log("  COMPROMISED_KEY=0x... npx tsx scripts/transfer-hub-outbox-admin.ts");
    console.log("");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!rpcUrl) {
    throw new Error("RPC_URL required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const compromisedWallet = new ethers.Wallet(compromisedKey, provider);
  const compromisedAddr = compromisedWallet.address;

  console.log("Configuration:");
  console.log("  HubOutbox:", HUB_OUTBOX_ADDRESS);
  console.log("  Compromised Admin:", compromisedAddr);
  console.log("  New Admin:", NEW_ADMIN);
  console.log("  New SpokeInboxAdapter:", NEW_SPOKE_INBOX_ADAPTER);
  console.log("");

  // Check balance
  const balance = await provider.getBalance(compromisedAddr);
  console.log("Compromised wallet balance:", ethers.formatEther(balance), "HYPE");
  
  if (balance === 0n) {
    console.log("");
    console.log("⚠️  WARNING: Wallet has 0 HYPE. You need to fund it first.");
    console.log("   Send a small amount (~0.001 HYPE) to:", compromisedAddr);
    console.log("");
    if (!DRY_RUN) {
      process.exit(1);
    }
  }
  console.log("");

  const hubOutbox = new ethers.Contract(HUB_OUTBOX_ADDRESS, HUB_OUTBOX_ABI, compromisedWallet);
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Verify compromised wallet has admin
  const hasAdmin = await hubOutbox.hasRole(DEFAULT_ADMIN_ROLE, compromisedAddr);
  if (!hasAdmin) {
    console.log("❌ Compromised wallet does NOT have admin role on HubOutbox");
    process.exit(1);
  }
  console.log("✅ Compromised wallet has admin role");

  // Check if new admin already has role
  const newAdminHasRole = await hubOutbox.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN);
  if (newAdminHasRole) {
    console.log("✅ New admin already has admin role");
  } else {
    console.log("  New admin does NOT have admin role yet");
  }
  console.log("");

  if (DRY_RUN) {
    console.log("Would execute:");
    console.log("  1. grantRole(DEFAULT_ADMIN_ROLE, newAdmin)");
    console.log("  2. setRemoteApp(42161, newSpokeInboxAdapter)");
    console.log("");
    console.log("DRY RUN complete.");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Grant admin to new admin
  // ═══════════════════════════════════════════════════════════════════════════
  if (!newAdminHasRole) {
    console.log("Step 1: Granting admin role to new admin...");
    try {
      const tx1 = await hubOutbox.grantRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN, {
        gasLimit: 100000,
      });
      console.log("  Tx:", tx1.hash);
      await tx1.wait();
      console.log("  ✅ Admin role granted to", NEW_ADMIN);
    } catch (e: any) {
      console.log("  ❌ Failed:", e.message?.slice(0, 100));
      process.exit(1);
    }
  } else {
    console.log("Step 1: Skipped (new admin already has role)");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Update remote app to point to new SpokeInboxAdapter
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("Step 2: Updating remote app for Arbitrum...");
  try {
    const remoteAppBytes32 = toBytes32Address(NEW_SPOKE_INBOX_ADAPTER);
    const tx2 = await hubOutbox.setRemoteApp(ARB_DOMAIN, remoteAppBytes32, {
      gasLimit: 100000,
    });
    console.log("  Tx:", tx2.hash);
    await tx2.wait();
    console.log("  ✅ Remote app updated to", NEW_SPOKE_INBOX_ADAPTER);
  } catch (e: any) {
    console.log("  ❌ Failed:", e.message?.slice(0, 100));
    console.log("");
    console.log("  Note: You may need to run this step separately with the new admin.");
    process.exit(1);
  }
  console.log("");

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("✅ HUB OUTBOX ADMIN TRANSFER COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("New admin", NEW_ADMIN, "now has control of HubBridgeOutbox.");
  console.log("Remote app for Arbitrum (42161) now points to:", NEW_SPOKE_INBOX_ADAPTER);
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
