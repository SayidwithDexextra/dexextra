import "dotenv/config";
import { ethers } from "ethers";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL;

const SAFE_RELAYER = "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec";
const NEW_ADMIN = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Contract addresses from .env.local
const CONTRACTS = {
  // HyperEVM (Hub)
  HubBridgeInbox: process.env.HUB_INBOX_ADDRESS || "0xB373b0538079f3cB61971F26abB11a89817BF072",
  HubBridgeOutbox: process.env.HUB_OUTBOX_ADDRESS || "0x4c32ff22b927a134a3286d5E33212debF951AcF5",
  CollateralHub: process.env.COLLATERAL_HUB_ADDRESS || "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5",
  // Arbitrum (Spoke)
  SpokeBridgeOutbox: process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM || "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7",
  SpokeBridgeInbox: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18",
  SpokeVault: process.env.SPOKE_ARBITRUM_VAULT_ADDRESS || "0x12684fE7d4b44c0Ef02AC2815742b46107E86091",
};

const ROLE_HASHES = {
  DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
  BRIDGE_ENDPOINT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")),
  WITHDRAW_SENDER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_SENDER_ROLE")),
  WITHDRAW_REQUESTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_REQUESTER_ROLE")),
  DEPOSIT_SENDER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_SENDER_ROLE")),
};

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

// Known addresses to check
const ADDRESSES_TO_CHECK = [
  { address: SAFE_RELAYER, label: "Safe Relayer" },
  { address: NEW_ADMIN, label: "New Admin" },
  { address: "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500", label: "Compromised Admin" },
  { address: "0x84b1e48e10D6326eD70a1947AaABF49AC8e290C7", label: "Old Relayer (compromised)" },
];

async function getRoleMembers(contract: ethers.Contract, roleName: string, roleHash: string): Promise<string[]> {
  try {
    const count = await contract.getRoleMemberCount(roleHash);
    const members: string[] = [];
    for (let i = 0; i < count; i++) {
      const member = await contract.getRoleMember(roleHash, i);
      members.push(member);
    }
    return members;
  } catch (e: any) {
    // Contract might not support enumeration
    return [];
  }
}

async function checkContract(
  provider: ethers.JsonRpcProvider,
  contractName: string,
  contractAddress: string,
  rolesToCheck: { name: string; hash: string }[]
) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[${contractName}] ${contractAddress}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const contract = new ethers.Contract(contractAddress, ACCESS_CONTROL_ABI, provider);

  for (const role of rolesToCheck) {
    console.log(`\n  📋 ${role.name}:`);
    
    // Try to enumerate members
    const members = await getRoleMembers(contract, role.name, role.hash);
    if (members.length > 0) {
      console.log(`     Current holders:`);
      for (const member of members) {
        const known = ADDRESSES_TO_CHECK.find(a => a.address.toLowerCase() === member.toLowerCase());
        const label = known ? ` (${known.label})` : "";
        console.log(`       - ${member}${label}`);
      }
    }

    // Check specific addresses
    console.log(`     Checking key addresses:`);
    for (const addr of ADDRESSES_TO_CHECK) {
      try {
        const has = await contract.hasRole(role.hash, addr.address);
        const status = has ? "✅ HAS ROLE" : "❌ no role";
        console.log(`       ${status} - ${addr.label} (${addr.address.slice(0, 10)}...)`);
      } catch (e: any) {
        console.log(`       ⚠️  Error checking ${addr.label}: ${e.message?.slice(0, 50)}`);
      }
    }
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPOSIT/WITHDRAWAL ROLE CHECK");
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log(`\nSafe Relayer: ${SAFE_RELAYER}`);
  console.log(`New Admin: ${NEW_ADMIN}`);

  const hubProvider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const arbProvider = new ethers.JsonRpcProvider(ARBITRUM_RPC);

  // ===== HyperEVM Contracts =====
  console.log("\n\n🔷 HYPEREVM (Hub Chain) 🔷");

  await checkContract(hubProvider, "HubBridgeInbox", CONTRACTS.HubBridgeInbox, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    { name: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
  ]);

  await checkContract(hubProvider, "HubBridgeOutbox", CONTRACTS.HubBridgeOutbox, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    { name: "WITHDRAW_SENDER_ROLE", hash: ROLE_HASHES.WITHDRAW_SENDER_ROLE },
  ]);

  await checkContract(hubProvider, "CollateralHub", CONTRACTS.CollateralHub, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    { name: "WITHDRAW_REQUESTER_ROLE", hash: ROLE_HASHES.WITHDRAW_REQUESTER_ROLE },
  ]);

  // ===== Arbitrum Contracts =====
  console.log("\n\n🔶 ARBITRUM (Spoke Chain) 🔶");

  await checkContract(arbProvider, "SpokeBridgeOutbox", CONTRACTS.SpokeBridgeOutbox, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    { name: "DEPOSIT_SENDER_ROLE", hash: ROLE_HASHES.DEPOSIT_SENDER_ROLE },
  ]);

  await checkContract(arbProvider, "SpokeBridgeInbox", CONTRACTS.SpokeBridgeInbox, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
    { name: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
  ]);

  await checkContract(arbProvider, "SpokeVault", CONTRACTS.SpokeVault, [
    { name: "DEFAULT_ADMIN_ROLE", hash: ROLE_HASHES.DEFAULT_ADMIN_ROLE },
  ]);

  // ===== Summary =====
  console.log("\n\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("        SUMMARY: SAFE RELAYER ROLE STATUS");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const safeRelayerRoles: { contract: string; role: string; has: boolean }[] = [];

  // Check each role for safe relayer
  const checks = [
    { provider: hubProvider, contract: CONTRACTS.HubBridgeInbox, name: "HubBridgeInbox", role: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
    { provider: hubProvider, contract: CONTRACTS.HubBridgeOutbox, name: "HubBridgeOutbox", role: "WITHDRAW_SENDER_ROLE", hash: ROLE_HASHES.WITHDRAW_SENDER_ROLE },
    { provider: hubProvider, contract: CONTRACTS.CollateralHub, name: "CollateralHub", role: "WITHDRAW_REQUESTER_ROLE", hash: ROLE_HASHES.WITHDRAW_REQUESTER_ROLE },
    { provider: arbProvider, contract: CONTRACTS.SpokeBridgeOutbox, name: "SpokeBridgeOutbox", role: "DEPOSIT_SENDER_ROLE", hash: ROLE_HASHES.DEPOSIT_SENDER_ROLE },
    { provider: arbProvider, contract: CONTRACTS.SpokeBridgeInbox, name: "SpokeBridgeInbox", role: "BRIDGE_ENDPOINT_ROLE", hash: ROLE_HASHES.BRIDGE_ENDPOINT_ROLE },
  ];

  console.log("Deposit Flow:");
  console.log("─────────────");
  for (const check of checks.filter(c => c.role === "DEPOSIT_SENDER_ROLE" || (c.name === "HubBridgeInbox" && c.role === "BRIDGE_ENDPOINT_ROLE"))) {
    const c = new ethers.Contract(check.contract, ACCESS_CONTROL_ABI, check.provider);
    try {
      const has = await c.hasRole(check.hash, SAFE_RELAYER);
      const status = has ? "✅" : "❌";
      console.log(`  ${status} ${check.name}.${check.role}`);
    } catch {
      console.log(`  ⚠️  ${check.name}.${check.role} - Error`);
    }
  }

  console.log("\nWithdrawal Flow:");
  console.log("────────────────");
  for (const check of checks.filter(c => c.role === "WITHDRAW_REQUESTER_ROLE" || c.role === "WITHDRAW_SENDER_ROLE" || (c.name === "SpokeBridgeInbox" && c.role === "BRIDGE_ENDPOINT_ROLE"))) {
    const c = new ethers.Contract(check.contract, ACCESS_CONTROL_ABI, check.provider);
    try {
      const has = await c.hasRole(check.hash, SAFE_RELAYER);
      const status = has ? "✅" : "❌";
      console.log(`  ${status} ${check.name}.${check.role}`);
    } catch {
      console.log(`  ⚠️  ${check.name}.${check.role} - Error`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
