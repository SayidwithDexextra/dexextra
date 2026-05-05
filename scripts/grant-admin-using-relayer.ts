#!/usr/bin/env tsx
/**
 * Grant DEFAULT_ADMIN_ROLE to new admin using the UNCOMPROMISED main relayer key.
 * 
 * Key: 0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319
 * Address: 0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec
 * 
 * This key has DEFAULT_ADMIN_ROLE on CoreVault and can grant to the new admin.
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// UNCOMPROMISED key that has DEFAULT_ADMIN_ROLE on CoreVault
const SAFE_ADMIN_KEY = "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319";
const SAFE_ADMIN_ADDRESS = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";

// New admin address to grant roles to (from relayers.generated.v2.json)
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

interface ContractToGrant {
  name: string;
  address: string;
  chain: "hub" | "arbitrum";
}

// Contracts where 0xE75aa08b... has DEFAULT_ADMIN_ROLE (based on audit)
const CONTRACTS: ContractToGrant[] = [
  // CoreVault - confirmed has DEFAULT_ADMIN_ROLE
  { name: "CoreVault", address: "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F", chain: "hub" },
];

async function main() {
  const hubRpc = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;
  const arbRpc = process.env.ARBITRUM_RPC_URL || process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;

  if (!hubRpc) throw new Error("Missing RPC_URL for hub chain");
  if (!arbRpc) throw new Error("Missing ARBITRUM_RPC_URL");

  const providers = {
    hub: new ethers.JsonRpcProvider(hubRpc),
    arbitrum: new ethers.JsonRpcProvider(arbRpc),
  };

  const signers = {
    hub: new ethers.Wallet(SAFE_ADMIN_KEY, providers.hub),
    arbitrum: new ethers.Wallet(SAFE_ADMIN_KEY, providers.arbitrum),
  };

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("    GRANTING ADMIN USING SAFE (UNCOMPROMISED) RELAYER KEY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log(`Using SAFE admin: ${SAFE_ADMIN_ADDRESS}`);
  console.log(`Granting to new admin: ${NEW_ADMIN_ADDRESS}\n`);

  // Check balances
  const hubBal = await providers.hub.getBalance(SAFE_ADMIN_ADDRESS);
  const arbBal = await providers.arbitrum.getBalance(SAFE_ADMIN_ADDRESS);
  console.log(`Balances:`);
  console.log(`  Hub (HYPE): ${ethers.formatEther(hubBal)}`);
  console.log(`  Arbitrum (ETH): ${ethers.formatEther(arbBal)}\n`);

  // First, check what roles the safe admin actually has
  console.log("Checking which contracts the safe admin has DEFAULT_ADMIN_ROLE on...\n");

  const contractsToCheck = [
    { name: "CoreVault", address: "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F", chain: "hub" as const },
    { name: "HubBridgeInbox", address: "0xB373b0538079f3cB61971F26abB11a89817BF072", chain: "hub" as const },
    { name: "HubBridgeOutbox", address: "0x4c32ff22b927a134a3286d5E33212debF951AcF5", chain: "hub" as const },
    { name: "CollateralHub", address: "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5", chain: "hub" as const },
    { name: "LiquidationManager", address: "0x5eF9e96317F918e6a04c6D03C31A20dDC5839A4d", chain: "hub" as const },
    { name: "SpokeVault (Arb)", address: "0x12684fE7d4b44c0Ef02AC2815742b46107E86091", chain: "arbitrum" as const },
    { name: "SpokeBridgeOutbox (Arb)", address: "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7", chain: "arbitrum" as const },
    { name: "SpokeBridgeInbox (Arb)", address: "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18", chain: "arbitrum" as const },
  ];

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const canGrantOn: ContractToGrant[] = [];

  for (const contract of contractsToCheck) {
    const provider = providers[contract.chain];
    const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, provider);
    
    try {
      const hasAdminRole = await c.hasRole(DEFAULT_ADMIN_ROLE, SAFE_ADMIN_ADDRESS);
      const newAdminHasRole = await c.hasRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
      
      if (hasAdminRole && !newAdminHasRole) {
        console.log(`  ${contract.name.padEnd(25)} ✅ Can grant (safe admin has DEFAULT_ADMIN_ROLE)`);
        canGrantOn.push(contract);
      } else if (hasAdminRole && newAdminHasRole) {
        console.log(`  ${contract.name.padEnd(25)} ✓ Already granted to new admin`);
      } else {
        console.log(`  ${contract.name.padEnd(25)} ❌ Safe admin doesn't have DEFAULT_ADMIN_ROLE`);
      }
    } catch (e) {
      console.log(`  ${contract.name.padEnd(25)} ⚠️ Error checking roles`);
    }
  }

  if (canGrantOn.length === 0) {
    console.log("\n✅ All contracts that safe admin controls already have new admin granted!");
    return;
  }

  console.log(`\n\nGranting DEFAULT_ADMIN_ROLE on ${canGrantOn.length} contract(s)...\n`);

  for (const contract of canGrantOn) {
    const signer = signers[contract.chain];
    const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, signer);

    process.stdout.write(`[${contract.chain.toUpperCase().padEnd(8)}] ${contract.name.padEnd(25)} `);

    try {
      const tx = await c.grantRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN_ADDRESS);
      console.log(`⏳ tx: ${tx.hash.slice(0, 20)}...`);
      await tx.wait();
      console.log(`  └─ ✅ Granted!`);
    } catch (e: any) {
      console.log(`❌ ${e.message?.slice(0, 60)}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("                              DONE");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");
  console.log(`New admin address: ${NEW_ADMIN_ADDRESS}`);
  console.log("\nRe-run scripts/audit-compromised-roles.ts to verify.\n");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
