#!/usr/bin/env tsx
/**
 * Deploy Secure Spoke Infrastructure V3 (Full Suite)
 * 
 * This deploys ALL security contracts:
 * 1. AnomalyDetector - On-chain pattern detection
 * 2. WithdrawalVerifier - Co-signer management
 * 3. SecureSpokeVaultV3 - Main vault with 8-layer security
 * 4. SpokeInboxAdapter - Backward-compatible bridge inbox
 * 5. SpokeBridgeOutboxWormhole - Deposit sender (unchanged)
 * 
 * Then configures all contracts and updates Hub trust.
 * 
 * Usage:
 *   npx tsx scripts/deploy-secure-spoke-v3.ts
 *   npx tsx scripts/deploy-secure-spoke-v3.ts --dry-run
 *   npx tsx scripts/deploy-secure-spoke-v3.ts --skip-hub-update
 * 
 * Required env:
 *   - ADMIN_PRIVATE_KEY (or NEW_ADMIN_PRIVATE_KEY)
 *   - ARBITRUM_RPC_URL  
 *   - RPC_URL (HyperEVM)
 *   - HUB_OUTBOX_ADDRESS
 *   - HUB_INBOX_ADDRESS
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_HUB = process.argv.includes("--skip-hub-update");

const NEW_ADMIN = process.env.NEW_ADMIN_ADDRESS || "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";
const SAFE_RELAYER = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";

// All relayers that need BRIDGE_INBOX_ROLE (for deposits + withdrawals)
const ALL_RELAYERS = [
  "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec", // safe_relayer
  "0x0258eDbF16cD01537Fde74a57D49fb10500Ee4b7",
  "0xF12cFFf4A024a20CbffE5F6CFa621127d9f619ae",
  "0xef2e2399af7F5f7Fb3Bc41952D7B1F3901f437Fe",
  "0xbd748Da20dAC89288e50EFaf3eD8644a1279Aace",
  "0xdceCa7290c008acb5e27e7B83f59f25599D6fc28",
  "0xED7D9eCA75c8d73A9396b1427Bf1d3E37DA73B65",
  "0x432005115A972DF329f015cF200D53d9168AeB4d",
  "0x0f80e0e0743a65B0e958a87615a63B3F448603b5",
  "0xF989598Bf514a6B82Cb9cC2B77f67DbCA644E20C",
  "0x8e15e8b84174BdCfD3DE7e4D690Ab0A71aED878F",
  "0xa1eb9C885785D8474be9929244f43A6bac9a4435",
  "0x4389Dd387Efa4fcb4088036de6919b6623b07251",
];

const HUB_DOMAIN = 999;
const ARB_DOMAIN = 42161;

const ARB_NATIVE_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_BRIDGED_USDC = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

// V3 Security Configuration
const SECURITY_CONFIG = {
  instantWithdrawalThreshold: ethers.parseUnits("1000", 6),   // 1,000 USDC
  timelockDelay: 3600n,                                        // 1 hour
  dailyLimitPerToken: ethers.parseUnits("50000", 6),          // 50,000 USDC
  userRateLimitWindow: 3600n,                                  // 1 hour
  userMaxWithdrawalsPerWindow: 5n,                             // 5/hour
  globalHourlyLimit: ethers.parseUnits("100000", 6),          // 100,000 USDC
  hotWalletLimit: ethers.parseUnits("200000", 6),             // 200,000 USDC
  adminTimelockDelay: 86400n,                                  // 24 hours
  requireCoSignerForLarge: false,                              // Enable later
  requireMerkleProof: false,                                   // Enable later
  requireDepositHistory: true,                                 // Only depositors can withdraw
  circuitBreakerEnabled: true,                                 // Auto-pause on anomaly
};

function toBytes32Address(addr: string): string {
  return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPILED ARTIFACTS (inline for simplicity)
// ═══════════════════════════════════════════════════════════════════════════

async function loadArtifacts() {
  const artifactsDir = path.resolve(process.cwd(), "contracts/secure-spoke/artifacts");
  const dexetrav5Dir = path.resolve(process.cwd(), "Dexetrav5/artifacts/src/collateral/bridge/wormhole");
  
  const artifacts: Record<string, { abi: any[]; bytecode: string }> = {};
  
  // Try to load from Foundry output
  const contractFiles = [
    ["SecureSpokeVaultV3", `${artifactsDir}/SecureSpokeVaultV3.sol/SecureSpokeVaultV3.json`],
    ["SpokeInboxAdapter", `${artifactsDir}/SpokeInboxAdapter.sol/SpokeInboxAdapter.json`],
    ["AnomalyDetector", `${artifactsDir}/AnomalyDetector.sol/AnomalyDetector.json`],
    ["WithdrawalVerifier", `${artifactsDir}/WithdrawalVerifier.sol/WithdrawalVerifier.json`],
    ["SpokeBridgeOutboxWormhole", `${dexetrav5Dir}/SpokeBridgeOutboxWormhole.sol/SpokeBridgeOutboxWormhole.json`],
  ];
  
  for (const [name, filePath] of contractFiles) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      // Foundry output: bytecode.object (no 0x prefix)
      // Hardhat output: bytecode (with 0x prefix)
      let bc = data.bytecode?.object || data.bytecode;
      if (bc && !bc.startsWith("0x")) bc = `0x${bc}`;
      artifacts[name] = {
        abi: data.abi,
        bytecode: bc,
      };
    }
  }
  
  // Check what we're missing
  const required = ["SecureSpokeVaultV3", "SpokeInboxAdapter", "SpokeBridgeOutboxWormhole"];
  const missing = required.filter(name => !artifacts[name]);
  
  if (missing.length > 0) {
    console.log("");
    console.log("⚠️  Missing compiled artifacts:", missing.join(", "));
    console.log("");
    console.log("Please compile contracts first:");
    console.log("");
    console.log("  cd contracts/secure-spoke && forge build");
    console.log("  cd Dexetrav5 && npx hardhat compile");
    console.log("");
    throw new Error("Missing compiled artifacts");
  }
  
  return artifacts;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║         DEPLOY SECURE SPOKE INFRASTRUCTURE V3                            ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log("");
  
  if (DRY_RUN) {
    console.log("🔸 DRY RUN MODE - No transactions will be sent");
    console.log("");
  }

  // Load environment
  const adminPk = process.env.ADMIN_PRIVATE_KEY || process.env.NEW_ADMIN_PRIVATE_KEY;
  if (!adminPk) throw new Error("ADMIN_PRIVATE_KEY or NEW_ADMIN_PRIVATE_KEY required");

  const arbRpc = process.env.ARBITRUM_RPC_URL;
  const hubRpc = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!arbRpc || !hubRpc) throw new Error("ARBITRUM_RPC_URL and RPC_URL required");

  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS || "0x4c32ff22b927a134a3286d5E33212debF951AcF5";
  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS || "0xB373b0538079f3cB61971F26abB11a89817BF072";

  const arbProvider = new ethers.JsonRpcProvider(arbRpc);
  const hubProvider = new ethers.JsonRpcProvider(hubRpc);

  const arbSigner = new ethers.Wallet(adminPk, arbProvider);
  const hubSigner = new ethers.Wallet(adminPk, hubProvider);

  console.log("Configuration:");
  console.log("  Admin:", arbSigner.address);
  console.log("  Guardian:", arbSigner.address);
  console.log("  Relayer:", SAFE_RELAYER);
  console.log("  HubOutbox:", hubOutboxAddr);
  console.log("  HubInbox:", hubInboxAddr);
  console.log("");

  // Check balances
  const arbBal = await arbProvider.getBalance(arbSigner.address);
  const hubBal = await hubProvider.getBalance(hubSigner.address);
  console.log("Balances:");
  console.log("  Arbitrum ETH:", ethers.formatEther(arbBal));
  console.log("  HyperEVM HYPE:", ethers.formatEther(hubBal));
  console.log("");

  // Balance check removed - proceed with deployment attempt

  // Load artifacts
  console.log("Loading compiled contracts...");
  const artifacts = await loadArtifacts();
  console.log("  ✅ Loaded:", Object.keys(artifacts).join(", "));
  console.log("");

  if (DRY_RUN) {
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("DRY RUN COMPLETE - Would deploy:");
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("1. AnomalyDetector");
    console.log("2. WithdrawalVerifier (if artifact available)");
    console.log("3. SecureSpokeVaultV3");
    console.log("4. SpokeInboxAdapter");
    console.log("5. SpokeBridgeOutboxWormhole");
    console.log("6. Configure all + update Hub trust");
    return;
  }

  const deployed: Record<string, string> = {};

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: Deploy AnomalyDetector (optional)
  // ═══════════════════════════════════════════════════════════════════════
  
  if (artifacts.AnomalyDetector) {
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("PHASE 1: Deploy AnomalyDetector");
    console.log("═══════════════════════════════════════════════════════════════════════");
    
    const factory = new ethers.ContractFactory(
      artifacts.AnomalyDetector.abi,
      artifacts.AnomalyDetector.bytecode,
      arbSigner
    );
    
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    deployed.AnomalyDetector = await contract.getAddress();
    console.log("  ✅ AnomalyDetector:", deployed.AnomalyDetector);
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: Deploy WithdrawalVerifier (optional)
  // ═══════════════════════════════════════════════════════════════════════
  
  if (artifacts.WithdrawalVerifier) {
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("PHASE 2: Deploy WithdrawalVerifier");
    console.log("═══════════════════════════════════════════════════════════════════════");
    
    const factory = new ethers.ContractFactory(
      artifacts.WithdrawalVerifier.abi,
      artifacts.WithdrawalVerifier.bytecode,
      arbSigner
    );
    
    // Initialize with admin as the only co-signer (1-of-1 for now)
    const contract = await factory.deploy([arbSigner.address], 1);
    await contract.waitForDeployment();
    deployed.WithdrawalVerifier = await contract.getAddress();
    console.log("  ✅ WithdrawalVerifier:", deployed.WithdrawalVerifier);
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: Deploy SecureSpokeVaultV3
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 3: Deploy SecureSpokeVaultV3");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const allowedTokens = [ARB_NATIVE_USDC, ARB_BRIDGED_USDC];
  
  const vaultFactory = new ethers.ContractFactory(
    artifacts.SecureSpokeVaultV3.abi,
    artifacts.SecureSpokeVaultV3.bytecode,
    arbSigner
  );
  
  const vault = await vaultFactory.deploy(
    allowedTokens,
    arbSigner.address, // admin
    arbSigner.address, // guardian
    [
      SECURITY_CONFIG.instantWithdrawalThreshold,
      SECURITY_CONFIG.timelockDelay,
      SECURITY_CONFIG.dailyLimitPerToken,
      SECURITY_CONFIG.userRateLimitWindow,
      SECURITY_CONFIG.userMaxWithdrawalsPerWindow,
      SECURITY_CONFIG.globalHourlyLimit,
      SECURITY_CONFIG.hotWalletLimit,
      SECURITY_CONFIG.adminTimelockDelay,
      SECURITY_CONFIG.requireCoSignerForLarge,
      SECURITY_CONFIG.requireMerkleProof,
      SECURITY_CONFIG.requireDepositHistory,
      SECURITY_CONFIG.circuitBreakerEnabled,
    ]
  );
  
  await vault.waitForDeployment();
  deployed.SecureSpokeVaultV3 = await vault.getAddress();
  console.log("  ✅ SecureSpokeVaultV3:", deployed.SecureSpokeVaultV3);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: Deploy SpokeInboxAdapter
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 4: Deploy SpokeInboxAdapter");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const adapterFactory = new ethers.ContractFactory(
    artifacts.SpokeInboxAdapter.abi,
    artifacts.SpokeInboxAdapter.bytecode,
    arbSigner
  );
  
  const adapter = await adapterFactory.deploy(
    deployed.SecureSpokeVaultV3,
    arbSigner.address,
    arbSigner.address
  );
  
  await adapter.waitForDeployment();
  deployed.SpokeInboxAdapter = await adapter.getAddress();
  console.log("  ✅ SpokeInboxAdapter:", deployed.SpokeInboxAdapter);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5: Deploy SpokeBridgeOutboxWormhole
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 5: Deploy SpokeBridgeOutboxWormhole");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const outboxFactory = new ethers.ContractFactory(
    artifacts.SpokeBridgeOutboxWormhole.abi,
    artifacts.SpokeBridgeOutboxWormhole.bytecode,
    arbSigner
  );
  
  const outbox = await outboxFactory.deploy(arbSigner.address);
  await outbox.waitForDeployment();
  deployed.SpokeBridgeOutboxWormhole = await outbox.getAddress();
  console.log("  ✅ SpokeBridgeOutboxWormhole:", deployed.SpokeBridgeOutboxWormhole);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 6: Configure Vault
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 6: Configure Vault");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const vaultContract = new ethers.Contract(
    deployed.SecureSpokeVaultV3,
    [
      "function setBridgeInbox(address) external",
      "function lockBridgeInbox() external",
    ],
    arbSigner
  );
  
  console.log("  Setting bridge inbox...");
  let tx = await vaultContract.setBridgeInbox(deployed.SpokeInboxAdapter);
  await tx.wait();
  console.log("  ✅ Bridge inbox set");
  
  console.log("  Locking bridge inbox (PERMANENT)...");
  tx = await vaultContract.lockBridgeInbox();
  await tx.wait();
  console.log("  ✅ Bridge inbox LOCKED");
  
  // Grant BRIDGE_INBOX_ROLE to all relayers on vault (for recordPassiveDeposit + depositFor)
  const vaultWithRoles = new ethers.Contract(
    deployed.SecureSpokeVaultV3,
    ["function grantRole(bytes32 role, address account) external"],
    arbSigner
  );
  const BRIDGE_INBOX_ROLE_VAULT = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  console.log("  Granting BRIDGE_INBOX_ROLE on vault to all relayers (" + ALL_RELAYERS.length + ")...");
  for (const relayer of ALL_RELAYERS) {
    tx = await vaultWithRoles.grantRole(BRIDGE_INBOX_ROLE_VAULT, relayer);
    await tx.wait();
    console.log("    ✅", relayer);
  }
  console.log("  ✅ All relayers can now record deposits on vault");
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 7: Configure Adapter
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 7: Configure Adapter");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const adapterContract = new ethers.Contract(
    deployed.SpokeInboxAdapter,
    [
      "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
      "function lockDomain(uint64 domain) external",
      "function grantRole(bytes32 role, address account) external",
      "function setAnomalyDetector(address) external",
    ],
    arbSigner
  );
  
  // Trust HubOutbox
  const hubOutboxBytes32 = toBytes32Address(hubOutboxAddr);
  console.log("  Setting trusted remote app (HubOutbox)...");
  tx = await adapterContract.setRemoteApp(HUB_DOMAIN, hubOutboxBytes32);
  await tx.wait();
  console.log("  ✅ Remote app set");
  
  console.log("  Locking domain (PERMANENT)...");
  tx = await adapterContract.lockDomain(HUB_DOMAIN);
  await tx.wait();
  console.log("  ✅ Domain LOCKED");
  
  // Grant BRIDGE_ENDPOINT_ROLE to ALL relayers
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  console.log("  Granting BRIDGE_ENDPOINT_ROLE to all relayers (" + ALL_RELAYERS.length + ")...");
  for (const relayer of ALL_RELAYERS) {
    tx = await adapterContract.grantRole(BRIDGE_ENDPOINT_ROLE, relayer);
    await tx.wait();
    console.log("    ✅", relayer);
  }
  console.log("  ✅ BRIDGE_ENDPOINT_ROLE granted to all relayers");
  
  // Connect anomaly detector if deployed
  if (deployed.AnomalyDetector) {
    console.log("  Connecting AnomalyDetector...");
    tx = await adapterContract.setAnomalyDetector(deployed.AnomalyDetector);
    await tx.wait();
    console.log("  ✅ AnomalyDetector connected");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 8: Configure Outbox
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PHASE 8: Configure Outbox");
  console.log("═══════════════════════════════════════════════════════════════════════");
  
  const outboxContract = new ethers.Contract(
    deployed.SpokeBridgeOutboxWormhole,
    [
      "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
      "function grantRole(bytes32 role, address account) external",
    ],
    arbSigner
  );
  
  const hubInboxBytes32 = toBytes32Address(hubInboxAddr);
  console.log("  Setting trusted remote app (HubInbox)...");
  tx = await outboxContract.setRemoteApp(HUB_DOMAIN, hubInboxBytes32);
  await tx.wait();
  console.log("  ✅ Remote app set");
  
  const DEPOSIT_SENDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE"));
  console.log("  Granting DEPOSIT_SENDER_ROLE to all relayers (" + ALL_RELAYERS.length + ")...");
  for (const relayer of ALL_RELAYERS) {
    tx = await outboxContract.grantRole(DEPOSIT_SENDER_ROLE, relayer);
    await tx.wait();
    console.log("    ✅", relayer);
  }
  console.log("  ✅ DEPOSIT_SENDER_ROLE granted to all relayers");
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 9: Update Hub (if not skipped)
  // ═══════════════════════════════════════════════════════════════════════
  
  if (!SKIP_HUB) {
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("PHASE 9: Update Hub Contracts");
    console.log("═══════════════════════════════════════════════════════════════════════");
    
    const HUB_ABI = [
      "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
      "function hasRole(bytes32 role, address account) view returns (bool)",
    ];
    
    const hubInbox = new ethers.Contract(hubInboxAddr, HUB_ABI, hubSigner);
    const hubOutbox = new ethers.Contract(hubOutboxAddr, HUB_ABI, hubSigner);
    
    // Update HubInbox to trust new SpokeOutbox
    const newOutboxBytes32 = toBytes32Address(deployed.SpokeBridgeOutboxWormhole);
    console.log("  Updating HubInbox to trust new SpokeOutbox...");
    tx = await hubInbox.setRemoteApp(ARB_DOMAIN, newOutboxBytes32);
    await tx.wait();
    console.log("  ✅ HubInbox updated");
    
    // Update HubOutbox to target new SpokeInboxAdapter
    const newAdapterBytes32 = toBytes32Address(deployed.SpokeInboxAdapter);
    console.log("  Updating HubOutbox to target new SpokeInboxAdapter...");
    tx = await hubOutbox.setRemoteApp(ARB_DOMAIN, newAdapterBytes32);
    await tx.wait();
    console.log("  ✅ HubOutbox updated");
    console.log("");
  } else {
    console.log("⏭️  Skipping Hub update (--skip-hub-update flag)");
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Deployed Contracts:");
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`  ${name}: ${addr}`);
  }
  console.log("");
  console.log("Security Status:");
  console.log("  ✅ Bridge inbox locked on vault");
  console.log("  ✅ Domain 999 locked on adapter");
  console.log("  ✅ Circuit breaker enabled");
  console.log("  ✅ Daily limit: 50,000 USDC");
  console.log("  ✅ Hot wallet limit: 200,000 USDC");
  console.log("  ✅ Large withdrawal timelock: 1 hour");
  console.log("");
  console.log("Update your .env.local:");
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log(`SPOKE_ARBITRUM_VAULT_ADDRESS=${deployed.SecureSpokeVaultV3}`);
  console.log(`SPOKE_INBOX_ADDRESS_ARBITRUM=${deployed.SpokeInboxAdapter}`);
  console.log(`SPOKE_OUTBOX_ADDRESS_ARBITRUM=${deployed.SpokeBridgeOutboxWormhole}`);
  if (deployed.AnomalyDetector) {
    console.log(`ANOMALY_DETECTOR_ADDRESS=${deployed.AnomalyDetector}`);
  }
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("⚠️  IMPORTANT NEXT STEPS:");
  console.log("  1. Fund the vault with USDC: " + deployed.SecureSpokeVaultV3);
  console.log("  2. Update Vercel env vars");
  console.log("  3. Start guardian monitor: npx tsx scripts/guardian-monitor.ts --auto-pause");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
