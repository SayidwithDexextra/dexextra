#!/usr/bin/env tsx
import dotenv from "dotenv";
import path from "path";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

async function main() {
  const hubRpc = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  const arbRpc = process.env.ALCHEMY_ARBITRUM_HTTP || process.env.RPC_URL_ARBITRUM;
  
  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const arbProvider = new ethers.JsonRpcProvider(arbRpc);

  const hubContracts = {
    HubInbox: "0xB373b0538079f3cB61971F26abB11a89817BF072",
    HubOutbox: "0x4c32ff22b927a134a3286d5E33212debF951AcF5",
    CollateralHub: "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5",
    CoreVault: "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F",
  };

  const spokeContracts = {
    SpokeOutbox: "0xE36D200966C82A4bb55860335840DEC93603119c",
    SpokeInbox: "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18",
  };

  const walletsToCheck = [
    { addr: "0xC1538bb07d7E526588Be67aBfA31330Df77d7f02", label: "PRIVATE_KEY_USERD" },
    { addr: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306", label: "compromised relayer" },
    { addr: process.env.DIAMOND_OWNER_ADDRESS, label: "DIAMOND_OWNER_ADDRESS" },
    { addr: process.env.DEPLOYER_ADDRESS, label: "DEPLOYER_ADDRESS" },
  ].filter(w => w.addr);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("CHECKING DEFAULT_ADMIN_ROLE ON ALL CONTRACTS");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Wallets being checked:");
  for (const w of walletsToCheck) {
    console.log(`  - ${w.addr} (${w.label})`);
  }
  console.log("");

  console.log("─── HUB CHAIN (HyperEVM) ───\n");
  
  for (const [name, addr] of Object.entries(hubContracts)) {
    console.log(`[${name}] ${addr}`);
    const c = new ethers.Contract(addr, ABI, hubProvider);
    const adminRole = ethers.ZeroHash;
    
    for (const wallet of walletsToCheck) {
      try {
        const has = await c.hasRole(adminRole, wallet.addr);
        console.log(`  ${wallet.addr} (${wallet.label}): ${has ? "✅ HAS ADMIN" : "❌ no admin"}`);
      } catch (e: any) {
        console.log(`  ${wallet.addr} (${wallet.label}): ⚠️ error - ${e.message?.slice(0, 50)}`);
      }
    }
    console.log("");
  }

  console.log("─── SPOKE CHAIN (Arbitrum) ───\n");
  
  for (const [name, addr] of Object.entries(spokeContracts)) {
    console.log(`[${name}] ${addr}`);
    const c = new ethers.Contract(addr, ABI, arbProvider);
    const adminRole = ethers.ZeroHash;
    
    for (const wallet of walletsToCheck) {
      try {
        const has = await c.hasRole(adminRole, wallet.addr);
        console.log(`  ${wallet.addr} (${wallet.label}): ${has ? "✅ HAS ADMIN" : "❌ no admin"}`);
      } catch (e: any) {
        console.log(`  ${wallet.addr} (${wallet.label}): ⚠️ error - ${e.message?.slice(0, 50)}`);
      }
    }
    console.log("");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
