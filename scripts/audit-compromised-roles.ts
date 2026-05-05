#!/usr/bin/env tsx
/**
 * Audit all roles held by compromised private keys across all contracts.
 * Outputs a table showing which addresses have which roles on which contracts.
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// COMPROMISED PRIVATE KEYS (from .env.local)
// ═══════════════════════════════════════════════════════════════════════════

const COMPROMISED_KEYS: { name: string; privateKey: string }[] = [
  { name: "PRIVATE_KEY (main relayer)", privateKey: "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319" },
  { name: "SETTLEMENT_PRIVATE_KEY", privateKey: "0x5cad9f985bf1b219040d07801a2ad52d6cd45caf889d2a2963a664f16aa0fffa" },
  { name: "SECOND_PRIVATE_KEY", privateKey: "0x210a154ad78862f09a89e5f9a916fdaf457eecbe0045423008267a64cf1d8ec5" },
  { name: "ADMIN_PRIVATE_KEY (diamond owner)", privateKey: "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7" },
  { name: "PRIVATE_KEY_USERD", privateKey: "0xd47ba93de6a68b6d6b2beaba8c21aaffd7786aca8f59c1a20f57a4ff72cd6fb9" },
  { name: "PRIVATE_KEY_USER2", privateKey: "0x8ab734a14de1ffd0b6120a42f07cbd187cadd6bf80db5202590f7b0b89be8f4b" },
  { name: "PRIVATE_KEY_USER3", privateKey: "0xe13859b1831fb1d3b8940cdf494c1683b959321c89e1b84deeb50341926cbb54" },
  { name: "PRIVATE_KEY_USER4/USER6", privateKey: "0x51e0d6871afc7949f3c415902a74292c20b15c91b2a2d6ee85f401c39c6ee141" },
  { name: "PRIVATE_KEY_USER5", privateKey: "0x17d275c2c3c49e10281a0f955c60a645620f20b48d879cb4ab632a76ebe033b6" },
  { name: "OPTIMISTIC_OVERLAY_PRIVATE_KEY", privateKey: "0xfd98524cfd92bcce4ef36699a6f5fcc62d7485476b868a5f6fd3006d40fdf8e0" },
  // Relayer pool keys
  { name: "RELAYER_POOL[1]", privateKey: "0xc999bab1eff3709fe4ea622b53ff79f6f610aead4e1dea11e99a8ad9049357c5" },
  { name: "RELAYER_POOL[2]", privateKey: "0x389b3d9a8cd8617bf1b297bec87ff448d1ea22abc833deecbd5c3c9602587a72" },
  { name: "RELAYER_POOL[3]", privateKey: "0x71a25ced49771d5b9c201e5e10abd9876e00aba5e18b8c97bedb19bc10a33d04" },
  { name: "RELAYER_POOL[4]", privateKey: "0x6deaa89ec2547ea51616e62d1e3d269174f194f428fb9e4f002ef7abb8d03f0d" },
  { name: "RELAYER_POOL[5]", privateKey: "0x71ef455362f78034f6c571df86492a644c7db7416d4096ecce6364930da74c9d" },
  { name: "RELAYER_POOL[6]", privateKey: "0x03b153bf73d42db8d3e6181ea4cdb33b3acc8347717bfa9de94c91d9b5ca8809" },
  { name: "RELAYER_POOL[7]", privateKey: "0xbb0b43558bb7768df991066629ad1d54f873e94e92e4b12301cf39092d7cedf0" },
  { name: "RELAYER_POOL[8]", privateKey: "0xd956e213c229178058779daa5671df90b922c507a97602b109396f4f5973ec3f" },
  { name: "RELAYER_POOL[9]", privateKey: "0x7c63a2a8c75803b36e1301cd9bab2721a16e16e451c06b70ed9c45312b3059bc" },
  { name: "RELAYER_POOL[10]", privateKey: "0x29248473ea5c6745cb438c9bdf0024aa5bf45fbce4359061e5b20787a2a39e28" },
];

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACTS TO CHECK
// ═══════════════════════════════════════════════════════════════════════════

interface ContractConfig {
  name: string;
  address: string;
  chain: "hub" | "arbitrum" | "polygon";
  roles: { name: string; hash: string }[];
}

const ROLE_HASHES = {
  DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
  ORDERBOOK_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE")),
  SETTLEMENT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE")),
  LIQUIDATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE")),
  BRIDGE_ENDPOINT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")),
  WITHDRAW_SENDER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_SENDER_ROLE")),
  WITHDRAW_REQUESTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_REQUESTER_ROLE")),
  DEPOSIT_SENDER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE")),
  OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
  MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
  PAUSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")),
};

const CONTRACTS: ContractConfig[] = [
  // Hub chain (HyperEVM)
  {
    name: "CoreVault",
    address: "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "ORDERBOOK_ROLE", hash: ROLE_HASHES.ORDERBOOK_ROLE },
      { name: "SETTLEMENT_ROLE", hash: ROLE_HASHES.SETTLEMENT_ROLE },
      { name: "LIQUIDATOR_ROLE", hash: ROLE_HASHES.LIQUIDATOR_ROLE },
    ],
  },
  {
    name: "HubBridgeInbox",
    address: "0xB373b0538079f3cB61971F26abB11a89817BF072",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
    ],
  },
  {
    name: "HubBridgeOutbox",
    address: "0x4c32ff22b927a134a3286d5E33212debF951AcF5",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "WITHDRAW_SENDER_ROLE", hash: ROLE_HASHES.WITHDRAW_SENDER_ROLE },
    ],
  },
  {
    name: "CollateralHub",
    address: "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "WITHDRAW_REQUESTER_ROLE", hash: ROLE_HASHES.WITHDRAW_REQUESTER_ROLE },
    ],
  },
  {
    name: "FuturesMarketFactory",
    address: "0x33E42A7c7edB23fbB2c5014269F760BC71279A36",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "GlobalSessionRegistry",
    address: "0xC547B198aFECd6BA4B30d639a045DB3cD30d8EF9",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "FeeRegistry",
    address: "0xFD6c0698Fc91317c815EB6694b592a18f076DFD0",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "FacetRegistry",
    address: "0x8B4188ba820F0cffE2ef77900F818DEFC8Ec743D",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "MarketBondManager",
    address: "0xa68EfcC230aC76EE34c8AB6566F141d504d42270",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "SettlementManager",
    address: "0x4410b72119B339DDd8FD69AdD3e094E568bd244c",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "LiquidationManager",
    address: "0x5eF9e96317F918e6a04c6D03C31A20dDC5839A4d",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "PositionManager",
    address: "0xd16e71fB31e1ce5958139C9E295b6B5cf30673E8",
    chain: "hub",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  // Arbitrum spoke
  {
    name: "SpokeVault (Arbitrum)",
    address: "0x12684fE7d4b44c0Ef02AC2815742b46107E86091",
    chain: "arbitrum",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "SpokeBridgeOutbox (Arbitrum)",
    address: "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7",
    chain: "arbitrum",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "DEPOSIT_SENDER_ROLE", hash: ROLE_HASHES.DEPOSIT_SENDER_ROLE },
    ],
  },
  {
    name: "SpokeBridgeInbox (Arbitrum)",
    address: "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18",
    chain: "arbitrum",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
    ],
  },
  // Polygon spoke
  {
    name: "SpokeVault (Polygon)",
    address: "0x53afe34f40B745406183d1cde53Ae37b6Ff2f0f9",
    chain: "polygon",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    ],
  },
  {
    name: "SpokeBridgeOutbox (Polygon)",
    address: "0x93b97Ed6d8f335e4E746Bc3b7b111447177d5d79",
    chain: "polygon",
    roles: [
      { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
      { name: "DEPOSIT_SENDER_ROLE", hash: ROLE_HASHES.DEPOSIT_SENDER_ROLE },
    ],
  },
];

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
];

const OWNABLE_ABI = [
  "function owner() view returns (address)",
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

interface RoleResult {
  keyName: string;
  address: string;
  contract: string;
  contractAddress: string;
  chain: string;
  role: string;
  hasRole: boolean;
}

async function main() {
  const hubRpc = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;
  const arbRpc = process.env.ARBITRUM_RPC_URL || process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;
  const polygonRpc = process.env.POLYGON_RPC_URL;

  if (!hubRpc) throw new Error("Missing RPC_URL for hub chain");
  if (!arbRpc) throw new Error("Missing ARBITRUM_RPC_URL");
  if (!polygonRpc) throw new Error("Missing POLYGON_RPC_URL");

  const providers = {
    hub: new ethers.JsonRpcProvider(hubRpc),
    arbitrum: new ethers.JsonRpcProvider(arbRpc),
    polygon: new ethers.JsonRpcProvider(polygonRpc),
  };

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("                    COMPROMISED KEYS ROLE AUDIT");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Derive addresses from private keys
  const compromisedAddresses = COMPROMISED_KEYS.map((k) => ({
    name: k.name,
    address: new ethers.Wallet(k.privateKey).address,
  }));

  console.log("COMPROMISED ADDRESSES:\n");
  for (const { name, address } of compromisedAddresses) {
    console.log(`  ${name.padEnd(35)} → ${address}`);
  }
  console.log("\n");

  // Check all roles
  const results: RoleResult[] = [];
  const positiveResults: RoleResult[] = [];

  console.log("Checking roles on-chain...\n");

  for (const contract of CONTRACTS) {
    const provider = providers[contract.chain];
    const c = new ethers.Contract(contract.address, ACCESS_CONTROL_ABI, provider);

    process.stdout.write(`  [${contract.chain.toUpperCase().padEnd(8)}] ${contract.name.padEnd(30)} `);

    let foundCount = 0;

    for (const { name: keyName, address } of compromisedAddresses) {
      for (const role of contract.roles) {
        try {
          const hasRole = await c.hasRole(role.hash, address);
          const result: RoleResult = {
            keyName,
            address,
            contract: contract.name,
            contractAddress: contract.address,
            chain: contract.chain,
            role: role.name,
            hasRole,
          };
          results.push(result);
          if (hasRole) {
            positiveResults.push(result);
            foundCount++;
          }
        } catch (e: any) {
          // Contract might not support hasRole (e.g., Ownable instead of AccessControl)
        }
      }
    }

    // Also check Ownable.owner()
    try {
      const ownable = new ethers.Contract(contract.address, OWNABLE_ABI, provider);
      const owner = await ownable.owner();
      for (const { name: keyName, address } of compromisedAddresses) {
        if (owner.toLowerCase() === address.toLowerCase()) {
          const result: RoleResult = {
            keyName,
            address,
            contract: contract.name,
            contractAddress: contract.address,
            chain: contract.chain,
            role: "OWNER (Ownable)",
            hasRole: true,
          };
          positiveResults.push(result);
          foundCount++;
        }
      }
    } catch {
      // Not Ownable
    }

    console.log(foundCount > 0 ? `✅ ${foundCount} role(s) found` : "—");
  }

  console.log("\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT TABLE: Roles by Address
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("                         ROLES BY COMPROMISED ADDRESS");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Group by address
  const byAddress = new Map<string, RoleResult[]>();
  for (const r of positiveResults) {
    const key = r.address;
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key)!.push(r);
  }

  for (const [address, roles] of byAddress) {
    const keyName = roles[0].keyName;
    console.log(`┌─────────────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ ${keyName.padEnd(75)} │`);
    console.log(`│ ${address.padEnd(75)} │`);
    console.log(`├─────────────────────────────────────────────────────────────────────────────┤`);
    console.log(`│ ${"Contract".padEnd(30)} │ ${"Chain".padEnd(10)} │ ${"Role".padEnd(28)} │`);
    console.log(`├─────────────────────────────────────────────────────────────────────────────┤`);
    for (const r of roles) {
      console.log(`│ ${r.contract.padEnd(30)} │ ${r.chain.padEnd(10)} │ ${r.role.padEnd(28)} │`);
    }
    console.log(`└─────────────────────────────────────────────────────────────────────────────┘\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT TABLE: Roles by Contract
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("                          ROLES BY CONTRACT");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Group by contract
  const byContract = new Map<string, RoleResult[]>();
  for (const r of positiveResults) {
    const key = r.contract;
    if (!byContract.has(key)) byContract.set(key, []);
    byContract.get(key)!.push(r);
  }

  for (const [contractName, roles] of byContract) {
    const contractAddr = roles[0].contractAddress;
    const chain = roles[0].chain;
    console.log(`┌─────────────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ ${contractName.padEnd(55)} [${chain.toUpperCase()}] │`);
    console.log(`│ ${contractAddr.padEnd(75)} │`);
    console.log(`├─────────────────────────────────────────────────────────────────────────────┤`);
    console.log(`│ ${"Role".padEnd(25)} │ ${"Address".padEnd(44)} │`);
    console.log(`├─────────────────────────────────────────────────────────────────────────────┤`);
    for (const r of roles) {
      console.log(`│ ${r.role.padEnd(25)} │ ${r.address.padEnd(44)} │`);
    }
    console.log(`└─────────────────────────────────────────────────────────────────────────────┘\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("                              SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log(`Total compromised addresses checked: ${compromisedAddresses.length}`);
  console.log(`Total contracts checked:             ${CONTRACTS.length}`);
  console.log(`Total role grants found:             ${positiveResults.length}`);
  console.log("");

  // Count by role type
  const roleCounts = new Map<string, number>();
  for (const r of positiveResults) {
    roleCounts.set(r.role, (roleCounts.get(r.role) || 0) + 1);
  }

  console.log("Roles breakdown:");
  for (const [role, count] of [...roleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(30)} ${count}`);
  }

  console.log("\n");
  console.log("⚠️  CRITICAL: These roles must be revoked and re-granted to new addresses!");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
