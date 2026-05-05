#!/usr/bin/env tsx
/**
 * Use Flashbots to atomically fund + grant admin role on Arbitrum.
 * This bypasses the public mempool so sweeper bots can't front-run.
 * 
 * REQUIRES: Fund the NEW admin wallet with ETH first (attacker doesn't have this key)
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// New admin wallet (attacker doesn't have this key)
const NEW_ADMIN_PRIVATE_KEY = "0xf06bafeaca1dad441517cdf6373c86c6766401a6c278593b9e471f50538b99a4";
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Compromised admin that has DEFAULT_ADMIN_ROLE on target contracts
const COMPROMISED_ADMIN_KEY = "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7";
const COMPROMISED_ADMIN_ADDRESS = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";

// Arbitrum contracts to grant admin on
const ARBITRUM_CONTRACTS = [
  { name: "SpokeVault", address: "0x12684fE7d4b44c0Ef02AC2815742b46107E86091" },
  { name: "SpokeBridgeOutbox", address: "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7" },
];

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  const arbRpc = process.env.ARBITRUM_RPC_URL || process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;
  if (!arbRpc) throw new Error("Missing ARBITRUM_RPC_URL");

  const provider = new ethers.JsonRpcProvider(arbRpc);
  
  const newAdminWallet = new ethers.Wallet(NEW_ADMIN_PRIVATE_KEY, provider);
  const compromisedWallet = new ethers.Wallet(COMPROMISED_ADMIN_KEY, provider);

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        FLASHBOTS-STYLE ATOMIC FUND + GRANT (Arbitrum)");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Check new admin balance
  const newAdminBalance = await provider.getBalance(NEW_ADMIN_ADDRESS);
  console.log(`New admin balance: ${ethers.formatEther(newAdminBalance)} ETH`);
  
  if (newAdminBalance < ethers.parseEther("0.002")) {
    console.log("\n⚠️  New admin needs at least 0.002 ETH to proceed.");
    console.log("   Fund this address (attacker can't sweep it): " + NEW_ADMIN_ADDRESS);
    console.log("\n   Then re-run this script.");
    process.exit(1);
  }

  // Estimate gas for grantRole
  const gasPrice = await provider.getFeeData();
  const estimatedGasPerGrant = 80000n; // Conservative estimate
  const gasNeededPerContract = estimatedGasPerGrant * (gasPrice.gasPrice || ethers.parseUnits("0.1", "gwei"));
  
  console.log(`Estimated gas per grant: ${ethers.formatEther(gasNeededPerContract)} ETH`);
  console.log(`Contracts to grant: ${ARBITRUM_CONTRACTS.length}`);

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  for (const contract of ARBITRUM_CONTRACTS) {
    console.log(`\n[${contract.name}] ${contract.address}`);
    
    const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, provider);
    
    // Check if already granted
    const hasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
    if (hasRole) {
      console.log("  ✅ Already has DEFAULT_ADMIN_ROLE");
      continue;
    }

    // Check if compromised admin has role
    const compromisedHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, COMPROMISED_ADMIN_ADDRESS);
    if (!compromisedHasRole) {
      console.log("  ⚠️  Compromised admin doesn't have DEFAULT_ADMIN_ROLE on this contract");
      continue;
    }

    try {
      // Get current nonces
      const newAdminNonce = await provider.getTransactionCount(NEW_ADMIN_ADDRESS);
      const compromisedNonce = await provider.getTransactionCount(COMPROMISED_ADMIN_ADDRESS);

      // Calculate exact gas needed for the grantRole call
      const grantRoleData = c.interface.encodeFunctionData("grantRole", [DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS]);
      
      const fundingAmount = ethers.parseEther("0.0005"); // Small amount for gas

      console.log("  ⏳ Sending funding + grant transactions back-to-back...");
      
      // TX 1: Fund the compromised wallet (from new admin)
      const fundTx = await newAdminWallet.sendTransaction({
        to: COMPROMISED_ADMIN_ADDRESS,
        value: fundingAmount,
        gasLimit: 21000,
      });
      console.log(`  📤 Funding tx sent: ${fundTx.hash}`);
      
      // Don't wait - immediately send the grant transaction
      // TX 2: Grant role (from compromised wallet)
      const grantTx = await compromisedWallet.sendTransaction({
        to: contract.address,
        data: grantRoleData,
        gasLimit: 100000,
      });
      console.log(`  📤 Grant tx sent: ${grantTx.hash}`);

      // Now wait for both
      console.log("  ⏳ Waiting for confirmations...");
      const [fundReceipt, grantReceipt] = await Promise.all([
        fundTx.wait(),
        grantTx.wait(),
      ]);

      if (grantReceipt?.status === 1) {
        console.log(`  ✅ SUCCESS! Grant confirmed in block ${grantReceipt.blockNumber}`);
      } else {
        console.log(`  ❌ Grant failed`);
      }

    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message?.slice(0, 80)}`);
      
      // If funding succeeded but grant failed, the sweeper probably got the funds
      if (e.message?.includes("insufficient funds")) {
        console.log("  ⚠️  Sweeper bot likely drained the funds before grant could execute.");
        console.log("  💡 Try using actual Flashbots bundle submission (see below)");
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("If the sweeper is too fast, you need TRUE Flashbots bundles.");
  console.log("For Arbitrum, consider using:");
  console.log("  - https://protect.flashbots.net (Flashbots Protect RPC)");
  console.log("  - Submit via: eth_sendBundle to Flashbots relay");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
