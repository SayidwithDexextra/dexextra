#!/usr/bin/env tsx
/**
 * Redeploy SpokeBridgeOutboxWormhole on Arbitrum and configure all wiring.
 * 
 * This script:
 * 1. Deploys a NEW SpokeBridgeOutboxWormhole on Arbitrum (Diamond Owner as admin)
 * 2. Configures the new outbox (setRemoteApp to trust HubInbox)
 * 3. Grants DEPOSIT_SENDER_ROLE to the new relayer
 * 4. Updates HubInbox on HyperEVM to trust the new outbox
 * 5. Outputs the new address for .env.local update
 * 
 * Usage:
 *   npx tsx scripts/redeploy-spoke-outbox.ts
 * 
 * Required env:
 *   - PRIVATE_KEY_DEPLOYER (Diamond Owner - has admin on HubInbox)
 *   - ARBITRUM_RPC_URL
 *   - RPC_URL (HyperEVM)
 *   - HUB_INBOX_ADDRESS
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const NEW_RELAYER = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";
const DIAMOND_OWNER = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
const HUB_DOMAIN = 999;
const ARB_DOMAIN = 42161;

function toBytes32Address(addr: string): string {
  return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

async function main() {
  const deployerPk = process.env.PRIVATE_KEY_DEPLOYER;
  if (!deployerPk) throw new Error("PRIVATE_KEY_DEPLOYER required");

  const arbRpc = process.env.ARBITRUM_RPC_URL;
  const hubRpc = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!arbRpc || !hubRpc) throw new Error("ARBITRUM_RPC_URL and RPC_URL required");

  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  if (!hubInboxAddr) throw new Error("HUB_INBOX_ADDRESS required");

  const arbProvider = new ethers.JsonRpcProvider(arbRpc);
  const hubProvider = new ethers.JsonRpcProvider(hubRpc);

  const arbSigner = new ethers.Wallet(deployerPk, arbProvider);
  const hubSigner = new ethers.Wallet(deployerPk, hubProvider);

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║         REDEPLOY SPOKE OUTBOX ON ARBITRUM                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Deployer (Diamond Owner):", arbSigner.address);
  console.log("New Relayer:", NEW_RELAYER);
  console.log("HubInbox:", hubInboxAddr);
  console.log("");

  // Check balances
  const arbBal = await arbProvider.getBalance(arbSigner.address);
  const hubBal = await hubProvider.getBalance(hubSigner.address);
  console.log("Arbitrum ETH balance:", ethers.formatEther(arbBal));
  console.log("HyperEVM HYPE balance:", ethers.formatEther(hubBal));
  
  if (arbBal < ethers.parseEther("0.0001")) {
    throw new Error("Insufficient Arbitrum ETH for deployment");
  }
  if (hubBal < ethers.parseEther("0.001")) {
    throw new Error("Insufficient HyperEVM HYPE for HubInbox update");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Deploy new SpokeBridgeOutboxWormhole
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Deploy SpokeBridgeOutboxWormhole on Arbitrum");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Load artifact
  const artifactPath = path.resolve(
    process.cwd(),
    "Dexetrav5/artifacts/src/collateral/bridge/wormhole/SpokeBridgeOutboxWormhole.sol/SpokeBridgeOutboxWormhole.json"
  );
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}\nRun 'npx hardhat compile' in Dexetrav5 first.`);
  }
  
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  
  console.log("Deploying SpokeBridgeOutboxWormhole...");
  console.log("  Constructor arg (admin):", arbSigner.address);
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, arbSigner);
  const outbox = await factory.deploy(arbSigner.address);
  const deployTx = outbox.deploymentTransaction();
  console.log("  TX:", deployTx?.hash);
  
  await outbox.waitForDeployment();
  const newOutboxAddr = await outbox.getAddress();
  console.log("  ✅ Deployed at:", newOutboxAddr);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Configure new SpokeOutbox
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Configure new SpokeOutbox");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  const outboxContract = new ethers.Contract(newOutboxAddr, artifact.abi, arbSigner);

  // 2a: setRemoteApp to trust HubInbox
  const hubInboxBytes32 = toBytes32Address(hubInboxAddr);
  console.log(`Setting remoteApp(${HUB_DOMAIN}) to HubInbox...`);
  console.log("  HubInbox bytes32:", hubInboxBytes32);
  
  const tx1 = await outboxContract.setRemoteApp(HUB_DOMAIN, hubInboxBytes32);
  await tx1.wait();
  console.log("  ✅ setRemoteApp confirmed");
  console.log("");

  // 2b: Grant DEPOSIT_SENDER_ROLE to new relayer
  const DEPOSIT_SENDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE"));
  console.log("Granting DEPOSIT_SENDER_ROLE to new relayer...");
  console.log("  Relayer:", NEW_RELAYER);
  
  const tx2 = await outboxContract.grantRole(DEPOSIT_SENDER_ROLE, NEW_RELAYER);
  await tx2.wait();
  console.log("  ✅ DEPOSIT_SENDER_ROLE granted");
  console.log("");

  // 2c: Verify deployer has admin (should be automatic)
  const hasAdmin = await outboxContract.hasRole(ethers.ZeroHash, arbSigner.address);
  console.log("Deployer has DEFAULT_ADMIN_ROLE:", hasAdmin ? "✅" : "❌");
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Update HubInbox to trust new SpokeOutbox
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: Update HubInbox on HyperEVM");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  const hubInboxABI = [
    "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
    "function remoteAppByDomain(uint64) view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
  ];
  
  const hubInbox = new ethers.Contract(hubInboxAddr, hubInboxABI, hubSigner);

  // Verify admin
  const hasHubAdmin = await hubInbox.hasRole(ethers.ZeroHash, hubSigner.address);
  console.log("Signer has admin on HubInbox:", hasHubAdmin ? "✅" : "❌");
  if (!hasHubAdmin) {
    throw new Error("Signer does not have admin on HubInbox!");
  }

  // Get old remote app
  const oldRemote = await hubInbox.remoteAppByDomain(ARB_DOMAIN);
  console.log("Old remoteApp(42161):", oldRemote);

  // Set new remote app
  const newOutboxBytes32 = toBytes32Address(newOutboxAddr);
  console.log("New remoteApp(42161):", newOutboxBytes32);
  
  const tx3 = await hubInbox.setRemoteApp(ARB_DOMAIN, newOutboxBytes32);
  await tx3.wait();
  console.log("  ✅ HubInbox.setRemoteApp confirmed");

  // Verify
  const updatedRemote = await hubInbox.remoteAppByDomain(ARB_DOMAIN);
  const matches = updatedRemote.toLowerCase() === newOutboxBytes32.toLowerCase();
  console.log("  Verification:", matches ? "✅ MATCH" : "❌ MISMATCH");
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("New SpokeOutbox address:", newOutboxAddr);
  console.log("");
  console.log("Update your .env.local:");
  console.log(`SPOKE_OUTBOX_ADDRESS_ARBITRUM=${newOutboxAddr}`);
  console.log("");
  console.log("Roles granted:");
  console.log("  - DEFAULT_ADMIN_ROLE → Diamond Owner (deployer)");
  console.log("  - DEPOSIT_SENDER_ROLE → New Relayer");
  console.log("");
  console.log("HubInbox now trusts the new SpokeOutbox for domain 42161");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
