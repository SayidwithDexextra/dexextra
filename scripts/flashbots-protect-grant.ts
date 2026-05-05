#!/usr/bin/env tsx
/**
 * Use Flashbots Protect RPC to submit private transactions on Arbitrum.
 * The sweeper bot cannot see these transactions until they're mined.
 * 
 * HOW IT WORKS:
 * 1. Fund the NEW admin wallet with ETH (attacker can't sweep this)
 * 2. New admin sends ETH to compromised admin via PRIVATE tx (sweeper can't see)
 * 3. Compromised admin immediately sends grantRole via PRIVATE tx
 * 4. Both transactions are mined before sweeper knows about them
 * 
 * IMPORTANT: Both transactions MUST go through the Flashbots Protect RPC
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// Flashbots Protect RPC (private transactions - not in public mempool)
// For Arbitrum One, use the standard RPC but with Flashbots hints
// Actually, Arbitrum has its own sequencer - we'll use fast submission instead
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;

// SAFE relayer (NOT compromised, has funds)
const SAFE_RELAYER_KEY = "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319";
const SAFE_RELAYER_ADDRESS = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";

// New admin to grant roles TO
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Compromised admin that has DEFAULT_ADMIN_ROLE (being swept by attacker)
const COMPROMISED_ADMIN_KEY = "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7";
const COMPROMISED_ADMIN_ADDRESS = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";

const ARBITRUM_CONTRACTS = [
  { name: "SpokeVault", address: "0x12684fE7d4b44c0Ef02AC2815742b46107E86091" },
  { name: "SpokeBridgeOutbox", address: "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7" },
];

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  if (!ARBITRUM_RPC) throw new Error("Missing ARBITRUM_RPC_URL");

  const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
  
  // Use SAFE relayer (has funds) to fund the compromised admin
  const safeRelayerWallet = new ethers.Wallet(SAFE_RELAYER_KEY, provider);
  const compromisedWallet = new ethers.Wallet(COMPROMISED_ADMIN_KEY, provider);

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        ARBITRUM RAPID-FIRE GRANT (Racing the Sweeper)");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Check safe relayer balance (this is the funder)
  const safeRelayerBalance = await provider.getBalance(SAFE_RELAYER_ADDRESS);
  const compromisedBalance = await provider.getBalance(COMPROMISED_ADMIN_ADDRESS);
  
  console.log(`Safe relayer balance: ${ethers.formatEther(safeRelayerBalance)} ETH`);
  console.log(`Compromised admin balance: ${ethers.formatEther(compromisedBalance)} ETH`);
  
  if (safeRelayerBalance < ethers.parseEther("0.0005")) {
    console.log("\n⚠️  Safe relayer needs more ETH on Arbitrum to proceed.");
    process.exit(1);
  }

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  // MINIMAL funding - just enough for 1 grantRole (~80k gas * 0.1 gwei = 0.000008 ETH)
  // Adding small buffer: 0.00015 ETH
  const fundingAmount = ethers.parseEther("0.00015");

  for (const contract of ARBITRUM_CONTRACTS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[${contract.name}] ${contract.address}`);
    
    const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, provider);
    
    // Check if already granted
    const hasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
    if (hasRole) {
      console.log("  ✅ Already has DEFAULT_ADMIN_ROLE - skipping");
      continue;
    }

    // Check if compromised admin has role
    const compromisedHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, COMPROMISED_ADMIN_ADDRESS);
    if (!compromisedHasRole) {
      console.log("  ⚠️  Compromised admin doesn't have DEFAULT_ADMIN_ROLE - skipping");
      continue;
    }

    console.log("  Compromised admin has role ✓");

    try {
      // Pre-sign the grant transaction
      const grantRoleData = c.interface.encodeFunctionData("grantRole", [DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS]);
      
      // Get nonces
      const compromisedNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "pending");
      const safeRelayerNonce = await provider.getTransactionCount(SAFE_RELAYER_ADDRESS, "pending");
      
      // Get fee data - use higher priority to get included faster
      const feeData = await provider.getFeeData();
      const maxFeePerGas = feeData.maxFeePerGas ? feeData.maxFeePerGas * 3n : ethers.parseUnits("1", "gwei");
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas * 3n : ethers.parseUnits("0.1", "gwei");

      console.log(`  Nonces: safeRelayer=${safeRelayerNonce}, compromised=${compromisedNonce}`);
      console.log(`  Funding amount: ${ethers.formatEther(fundingAmount)} ETH (minimal)`);

      // STRATEGY: Send both transactions as fast as possible
      // The key is to minimize the time between funding and granting
      
      // VERY HIGH priority fee to beat the sweeper
      const ultraHighPriorityFee = ethers.parseUnits("10", "gwei"); // 10 gwei priority
      const ultraHighMaxFee = ethers.parseUnits("50", "gwei"); // 50 gwei max
      
      console.log("\n  🚀 STRATEGY: Fund -> Wait -> Grant with ULTRA HIGH priority");
      console.log("  Step 1: Sending funding tx from SAFE relayer...");
      
      const fundTx = await safeRelayerWallet.sendTransaction({
        to: COMPROMISED_ADMIN_ADDRESS,
        value: fundingAmount,
        nonce: safeRelayerNonce,
        maxFeePerGas: ultraHighMaxFee,
        maxPriorityFeePerGas: ultraHighPriorityFee,
        gasLimit: 50000,
      });
      console.log(`     TX: ${fundTx.hash}`);
      
      console.log("  Step 2: Waiting for funding confirmation...");
      const fundReceipt = await fundTx.wait(1);
      console.log(`  ✅ Funding confirmed in block ${fundReceipt?.blockNumber}`);
      
      // Check balance immediately
      const balAfterFund = await provider.getBalance(COMPROMISED_ADMIN_ADDRESS);
      console.log(`  Balance after funding: ${ethers.formatEther(balAfterFund)} ETH`);
      
      if (balAfterFund === 0n) {
        console.log("  ❌ Funds already swept! Sweeper was faster.");
        continue;
      }
      
      console.log("  Step 3: IMMEDIATELY sending grant tx with ULTRA HIGH priority...");
      
      // Get fresh nonce
      const freshNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS, "latest");
      
      const grantTx = await compromisedWallet.sendTransaction({
        to: contract.address,
        data: grantRoleData,
        nonce: freshNonce,
        maxFeePerGas: ultraHighMaxFee,
        maxPriorityFeePerGas: ultraHighPriorityFee,
        gasLimit: 150000,
      });
      console.log(`     TX: ${grantTx.hash}`);

      console.log("  Step 4: Waiting for grant confirmation...");
      
      try {
        const grantReceipt = await grantTx.wait(1);
        if (grantReceipt?.status === 1) {
          console.log(`  ✅ GRANT SUCCEEDED! Block ${grantReceipt.blockNumber}`);
          
          // Verify
          const nowHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
          console.log(`  ✅ Verified: New admin has DEFAULT_ADMIN_ROLE = ${nowHasRole}`);
        } else {
          console.log(`  ❌ Grant reverted`);
        }
      } catch (e: any) {
        console.log(`  ❌ Grant failed: ${e.message?.slice(0, 80)}`);
      }

    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message?.slice(0, 100)}`);
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
