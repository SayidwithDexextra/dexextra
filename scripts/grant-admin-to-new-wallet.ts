#!/usr/bin/env tsx
/**
 * Grant DEFAULT_ADMIN_ROLE to new admin wallet using compromised admin key.
 * This must be run IMMEDIATELY before the attacker revokes our access.
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// Compromised admin key that currently has DEFAULT_ADMIN_ROLE
const COMPROMISED_ADMIN_KEY = "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7";

// New admin address to grant roles to (from relayers.generated.v2.json)
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
];

interface ContractToGrant {
  name: string;
  address: string;
  chain: "hub" | "arbitrum";
  type: "accessControl" | "ownable";
}

const CONTRACTS: ContractToGrant[] = [
  // Hub chain - AccessControl
  { name: "CoreVault", address: "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F", chain: "hub", type: "accessControl" },
  { name: "HubBridgeInbox", address: "0xB373b0538079f3cB61971F26abB11a89817BF072", chain: "hub", type: "accessControl" },
  { name: "HubBridgeOutbox", address: "0x4c32ff22b927a134a3286d5E33212debF951AcF5", chain: "hub", type: "accessControl" },
  { name: "CollateralHub", address: "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5", chain: "hub", type: "accessControl" },
  { name: "LiquidationManager", address: "0x5eF9e96317F918e6a04c6D03C31A20dDC5839A4d", chain: "hub", type: "accessControl" },
  // Hub chain - Ownable
  { name: "GlobalSessionRegistry", address: "0xC547B198aFECd6BA4B30d639a045DB3cD30d8EF9", chain: "hub", type: "ownable" },
  { name: "MarketBondManager", address: "0xa68EfcC230aC76EE34c8AB6566F141d504d42270", chain: "hub", type: "ownable" },
  // Arbitrum - AccessControl
  { name: "SpokeVault (Arbitrum)", address: "0x12684fE7d4b44c0Ef02AC2815742b46107E86091", chain: "arbitrum", type: "accessControl" },
  { name: "SpokeBridgeOutbox (Arbitrum)", address: "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7", chain: "arbitrum", type: "accessControl" },
  { name: "SpokeBridgeInbox (Arbitrum)", address: "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18", chain: "arbitrum", type: "accessControl" },
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
    hub: new ethers.Wallet(COMPROMISED_ADMIN_KEY, providers.hub),
    arbitrum: new ethers.Wallet(COMPROMISED_ADMIN_KEY, providers.arbitrum),
  };

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("          GRANTING DEFAULT_ADMIN_ROLE TO NEW WALLET");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log(`Using compromised admin: ${signers.hub.address}`);
  console.log(`Granting to new admin:   ${NEW_ADMIN_ADDRESS}\n`);

  const results: { contract: string; chain: string; status: string; tx?: string }[] = [];

  for (const contract of CONTRACTS) {
    const provider = providers[contract.chain];
    const signer = signers[contract.chain];

    process.stdout.write(`[${contract.chain.toUpperCase().padEnd(8)}] ${contract.name.padEnd(30)} `);

    try {
      if (contract.type === "accessControl") {
        const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, signer);
        const adminRole = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE

        // Check if already has role
        const hasRole = await c.hasRole(adminRole, NEW_ADMIN_ADDRESS);
        if (hasRole) {
          console.log("✅ Already has DEFAULT_ADMIN_ROLE");
          results.push({ contract: contract.name, chain: contract.chain, status: "already_granted" });
          continue;
        }

        // Grant role
        const tx = await c.grantRole(adminRole, NEW_ADMIN_ADDRESS);
        console.log(`⏳ Granting... tx: ${tx.hash.slice(0, 18)}...`);
        await tx.wait();
        console.log(`  └─ ✅ Granted! tx: ${tx.hash}`);
        results.push({ contract: contract.name, chain: contract.chain, status: "granted", tx: tx.hash });

      } else if (contract.type === "ownable") {
        const c = new ethers.Contract(contract.address, OWNABLE_ABI, signer);

        // Check current owner
        const currentOwner = await c.owner();
        if (currentOwner.toLowerCase() === NEW_ADMIN_ADDRESS.toLowerCase()) {
          console.log("✅ Already owner");
          results.push({ contract: contract.name, chain: contract.chain, status: "already_owner" });
          continue;
        }

        // Transfer ownership
        const tx = await c.transferOwnership(NEW_ADMIN_ADDRESS);
        console.log(`⏳ Transferring ownership... tx: ${tx.hash.slice(0, 18)}...`);
        await tx.wait();
        console.log(`  └─ ✅ Transferred! tx: ${tx.hash}`);
        results.push({ contract: contract.name, chain: contract.chain, status: "ownership_transferred", tx: tx.hash });
      }

    } catch (e: any) {
      const errMsg = e.message?.slice(0, 60) || String(e);
      console.log(`❌ Error: ${errMsg}`);
      results.push({ contract: contract.name, chain: contract.chain, status: `error: ${errMsg}` });
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("                              SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const granted = results.filter(r => r.status === "granted" || r.status === "ownership_transferred");
  const alreadyDone = results.filter(r => r.status === "already_granted" || r.status === "already_owner");
  const errors = results.filter(r => r.status.startsWith("error"));

  console.log(`Successfully granted/transferred: ${granted.length}`);
  console.log(`Already had access:               ${alreadyDone.length}`);
  console.log(`Errors:                           ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) {
      console.log(`  - ${e.contract}: ${e.status}`);
    }
  }

  console.log("\n");
  console.log("NEW ADMIN ADDRESS: " + NEW_ADMIN_ADDRESS);
  console.log("\n⚠️  NEXT STEPS:");
  console.log("  1. Verify the new admin has roles by running: npx tsx scripts/audit-compromised-roles.ts");
  console.log("  2. Update .env.local with new ADMIN_PRIVATE_KEY");
  console.log("  3. Revoke roles from compromised addresses");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
