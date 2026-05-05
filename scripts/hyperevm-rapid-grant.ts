#!/usr/bin/env tsx
/**
 * Rapid-fire grant on HyperEVM (Hyperliquid chain)
 * Uses the safe relayer to fund compromised admin, then immediately grant roles.
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const HYPEREVM_RPC = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;

// SAFE relayer (NOT compromised, has HYPE)
const SAFE_RELAYER_KEY = "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319";
const SAFE_RELAYER_ADDRESS = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";

// New admin to grant roles TO
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Compromised admin that has DEFAULT_ADMIN_ROLE (being swept by attacker)
const COMPROMISED_ADMIN_KEY = "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7";
const COMPROMISED_ADMIN_ADDRESS = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";

// HyperEVM contracts that need DEFAULT_ADMIN_ROLE granted
const HYPEREVM_CONTRACTS = [
  { name: "HubBridgeOutbox", address: "0x4c32ff22b927a134a3286d5E33212debF951AcF5", type: "accessControl" },
  { name: "LiquidationManager", address: "0x5eF9e96317F918e6a04c6D03C31A20dDC5839A4d", type: "accessControl" },
  { name: "GlobalSessionRegistry", address: "0xC547B198aFECd6BA4B30d639a045DB3cD30d8EF9", type: "ownable" },
  { name: "MarketBondManager", address: "0xa68EfcC230aC76EE34c8AB6566F141d504d42270", type: "ownable" },
];

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
];

async function main() {
  if (!HYPEREVM_RPC) throw new Error("Missing RPC_URL for HyperEVM");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  
  const safeRelayerWallet = new ethers.Wallet(SAFE_RELAYER_KEY, provider);
  const compromisedWallet = new ethers.Wallet(COMPROMISED_ADMIN_KEY, provider);

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        HYPEREVM (Hyperliquid) RAPID-FIRE GRANT");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Check balances
  const safeRelayerBalance = await provider.getBalance(SAFE_RELAYER_ADDRESS);
  const compromisedBalance = await provider.getBalance(COMPROMISED_ADMIN_ADDRESS);
  
  console.log(`Safe relayer balance: ${ethers.formatEther(safeRelayerBalance)} HYPE`);
  console.log(`Compromised admin balance: ${ethers.formatEther(compromisedBalance)} HYPE`);
  
  if (safeRelayerBalance < ethers.parseEther("0.001")) {
    console.log("\n⚠️  Safe relayer needs more HYPE to proceed.");
    process.exit(1);
  }

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  // Minimal funding - just enough for 1 transaction
  const fundingAmount = ethers.parseEther("0.001");

  for (const contract of HYPEREVM_CONTRACTS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[${contract.name}] ${contract.address}`);
    console.log(`  Type: ${contract.type}`);
    
    if (contract.type === "accessControl") {
      const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, provider);
      
      // Check if already granted
      const hasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
      if (hasRole) {
        console.log("  ✅ New admin already has DEFAULT_ADMIN_ROLE - skipping");
        continue;
      }

      // Check if compromised admin has role
      const compromisedHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, COMPROMISED_ADMIN_ADDRESS);
      if (!compromisedHasRole) {
        console.log("  ⚠️  Compromised admin doesn't have DEFAULT_ADMIN_ROLE - skipping");
        continue;
      }

      console.log("  ✓ Compromised admin has DEFAULT_ADMIN_ROLE");

      try {
        const grantRoleData = c.interface.encodeFunctionData("grantRole", [DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS]);
        
        // Get nonces
        const safeRelayerNonce = await provider.getTransactionCount(SAFE_RELAYER_ADDRESS, "pending");
        const compromisedNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "pending");
        
        // Get fee data
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ? feeData.gasPrice * 3n : ethers.parseUnits("1", "gwei");

        console.log(`  Nonces: safeRelayer=${safeRelayerNonce}, compromised=${compromisedNonce}`);
        console.log(`  Funding amount: ${ethers.formatEther(fundingAmount)} HYPE`);

        console.log("\n  🚀 RAPID FIRE SEQUENCE:");
        console.log("  Step 1: Sending funding tx...");
        
        const fundTx = await safeRelayerWallet.sendTransaction({
          to: COMPROMISED_ADMIN_ADDRESS,
          value: fundingAmount,
          nonce: safeRelayerNonce,
          gasPrice,
          gasLimit: 21000,
        });
        console.log(`     TX: ${fundTx.hash}`);
        
        console.log("  Step 2: Waiting for funding confirmation...");
        const fundReceipt = await fundTx.wait(1);
        console.log(`  ✅ Funding confirmed in block ${fundReceipt?.blockNumber}`);
        
        // Check balance immediately
        const balAfterFund = await provider.getBalance(COMPROMISED_ADMIN_ADDRESS);
        console.log(`  Balance after funding: ${ethers.formatEther(balAfterFund)} HYPE`);
        
        if (balAfterFund === 0n) {
          console.log("  ❌ Funds already swept! Sweeper was faster.");
          continue;
        }
        
        console.log("  Step 3: IMMEDIATELY sending grant tx...");
        
        const freshNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "latest");
        
        const grantTx = await compromisedWallet.sendTransaction({
          to: contract.address,
          data: grantRoleData,
          nonce: freshNonce,
          gasPrice: gasPrice * 2n, // Higher priority
          gasLimit: 150000,
        });
        console.log(`     TX: ${grantTx.hash}`);

        console.log("  Step 4: Waiting for grant confirmation...");
        
        const grantReceipt = await grantTx.wait(1);
        if (grantReceipt?.status === 1) {
          console.log(`  ✅ GRANT SUCCEEDED! Block ${grantReceipt.blockNumber}`);
          
          const nowHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
          console.log(`  ✅ Verified: New admin has DEFAULT_ADMIN_ROLE = ${nowHasRole}`);
        } else {
          console.log(`  ❌ Grant reverted`);
        }

      } catch (e: any) {
        console.log(`  ❌ Error: ${e.message?.slice(0, 100)}`);
      }
      
    } else if (contract.type === "ownable") {
      const c = new ethers.Contract(contract.address, OWNABLE_ABI, provider);
      
      // Check current owner
      const currentOwner = await c.owner();
      console.log(`  Current owner: ${currentOwner}`);
      
      if (currentOwner.toLowerCase() === NEW_ADMIN_ADDRESS.toLowerCase()) {
        console.log("  ✅ New admin is already owner - skipping");
        continue;
      }
      
      if (currentOwner.toLowerCase() !== COMPROMISED_ADMIN_ADDRESS.toLowerCase()) {
        console.log("  ⚠️  Compromised admin is not the owner - skipping");
        continue;
      }

      console.log("  ✓ Compromised admin is current owner");

      try {
        const transferData = c.interface.encodeFunctionData("transferOwnership", [NEW_ADMIN_ADDRESS]);
        
        const safeRelayerNonce = await provider.getTransactionCount(SAFE_RELAYER_ADDRESS, "pending");
        const compromisedNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "pending");
        
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ? feeData.gasPrice * 3n : ethers.parseUnits("1", "gwei");

        console.log(`  Nonces: safeRelayer=${safeRelayerNonce}, compromised=${compromisedNonce}`);
        console.log(`  Funding amount: ${ethers.formatEther(fundingAmount)} HYPE`);

        console.log("\n  🚀 RAPID FIRE SEQUENCE:");
        console.log("  Step 1: Sending funding tx...");
        
        const fundTx = await safeRelayerWallet.sendTransaction({
          to: COMPROMISED_ADMIN_ADDRESS,
          value: fundingAmount,
          nonce: safeRelayerNonce,
          gasPrice,
          gasLimit: 21000,
        });
        console.log(`     TX: ${fundTx.hash}`);
        
        console.log("  Step 2: Waiting for funding confirmation...");
        const fundReceipt = await fundTx.wait(1);
        console.log(`  ✅ Funding confirmed in block ${fundReceipt?.blockNumber}`);
        
        const balAfterFund = await provider.getBalance(COMPROMISED_ADMIN_ADDRESS);
        console.log(`  Balance after funding: ${ethers.formatEther(balAfterFund)} HYPE`);
        
        if (balAfterFund === 0n) {
          console.log("  ❌ Funds already swept! Sweeper was faster.");
          continue;
        }
        
        console.log("  Step 3: IMMEDIATELY sending transferOwnership tx...");
        
        const freshNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "latest");
        
        const transferTx = await compromisedWallet.sendTransaction({
          to: contract.address,
          data: transferData,
          nonce: freshNonce,
          gasPrice: gasPrice * 2n,
          gasLimit: 100000,
        });
        console.log(`     TX: ${transferTx.hash}`);

        console.log("  Step 4: Waiting for transfer confirmation...");
        
        const transferReceipt = await transferTx.wait(1);
        if (transferReceipt?.status === 1) {
          console.log(`  ✅ TRANSFER SUCCEEDED! Block ${transferReceipt.blockNumber}`);
          
          const newOwner = await c.owner();
          console.log(`  ✅ Verified: New owner = ${newOwner}`);
        } else {
          console.log(`  ❌ Transfer reverted`);
        }

      } catch (e: any) {
        console.log(`  ❌ Error: ${e.message?.slice(0, 100)}`);
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("                              DONE");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
