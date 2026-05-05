import "dotenv/config";
import { ethers } from "ethers";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// New admin (has DEFAULT_ADMIN_ROLE on secured contracts)
const NEW_ADMIN_KEY = "0xf06bafeaca1dad441517cdf6373c86c6766401a6c278593b9e471f50538b99a4";
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

// Compromised addresses to revoke
const COMPROMISED_ADMIN = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
const OLD_RELAYER = "0x84b1e48e10D6326eD70a1947AaABF49AC8e290C7";

// Contracts where new admin has control
const SECURED_CONTRACTS = {
  HubBridgeInbox: process.env.HUB_INBOX_ADDRESS || "0xB373b0538079f3cB61971F26abB11a89817BF072",
  CollateralHub: process.env.COLLATERAL_HUB_ADDRESS || "0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5",
  CoreVault: process.env.CORE_VAULT_ADDRESS || "0x13C0EE284eF74E10A6442077718D57e2C50Ee88F",
};

const ROLE_HASHES = {
  DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
  BRIDGE_ENDPOINT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE")),
  WITHDRAW_REQUESTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_REQUESTER_ROLE")),
  ORDERBOOK_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE")),
  SETTLEMENT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE")),
  LIQUIDATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE")),
};

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function revokeRole(bytes32 role, address account) external",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
];

async function revokeIfHasRole(
  contract: ethers.Contract,
  contractName: string,
  roleName: string,
  roleHash: string,
  addressToRevoke: string,
  addressLabel: string
) {
  try {
    const has = await contract.hasRole(roleHash, addressToRevoke);
    if (!has) {
      console.log(`  ⏭️  ${addressLabel} doesn't have ${roleName} - skipping`);
      return;
    }

    console.log(`  🔄 Revoking ${roleName} from ${addressLabel}...`);
    const tx = await contract.revokeRole(roleHash, addressToRevoke);
    console.log(`     TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`     ✅ Revoked in block ${receipt?.blockNumber}`);
  } catch (e: any) {
    console.log(`  ❌ Error revoking ${roleName} from ${addressLabel}: ${e.message?.slice(0, 80)}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        REVOKE COMPROMISED ADDRESSES FROM SECURED CONTRACTS");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const newAdmin = new ethers.Wallet(NEW_ADMIN_KEY, provider);

  console.log(`Revoking as: ${newAdmin.address}`);
  const balance = await provider.getBalance(newAdmin.address);
  console.log(`Balance: ${ethers.formatEther(balance)} HYPE\n`);

  if (balance < ethers.parseEther("0.001")) {
    console.log("❌ Insufficient balance for transactions!");
    process.exit(1);
  }

  const addressesToRevoke = [
    { address: COMPROMISED_ADMIN, label: "Compromised Admin" },
    { address: OLD_RELAYER, label: "Old Relayer" },
  ];

  // ===== HubBridgeInbox =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[HubBridgeInbox] ${SECURED_CONTRACTS.HubBridgeInbox}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const hubInbox = new ethers.Contract(SECURED_CONTRACTS.HubBridgeInbox, ACCESS_CONTROL_ABI, newAdmin);

  for (const { address, label } of addressesToRevoke) {
    await revokeIfHasRole(hubInbox, "HubBridgeInbox", "DEFAULT_ADMIN_ROLE", ROLE_HASHES.DEFAULT_ADMIN_ROLE, address, label);
    await revokeIfHasRole(hubInbox, "HubBridgeInbox", "BRIDGE_ENDPOINT_ROLE", ROLE_HASHES.BRIDGE_ENDPOINT_ROLE, address, label);
  }

  // ===== CollateralHub =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[CollateralHub] ${SECURED_CONTRACTS.CollateralHub}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const collateralHub = new ethers.Contract(SECURED_CONTRACTS.CollateralHub, ACCESS_CONTROL_ABI, newAdmin);

  for (const { address, label } of addressesToRevoke) {
    await revokeIfHasRole(collateralHub, "CollateralHub", "DEFAULT_ADMIN_ROLE", ROLE_HASHES.DEFAULT_ADMIN_ROLE, address, label);
    await revokeIfHasRole(collateralHub, "CollateralHub", "WITHDRAW_REQUESTER_ROLE", ROLE_HASHES.WITHDRAW_REQUESTER_ROLE, address, label);
  }

  // ===== CoreVault =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[CoreVault] ${SECURED_CONTRACTS.CoreVault}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const coreVault = new ethers.Contract(SECURED_CONTRACTS.CoreVault, ACCESS_CONTROL_ABI, newAdmin);

  for (const { address, label } of addressesToRevoke) {
    await revokeIfHasRole(coreVault, "CoreVault", "DEFAULT_ADMIN_ROLE", ROLE_HASHES.DEFAULT_ADMIN_ROLE, address, label);
    await revokeIfHasRole(coreVault, "CoreVault", "ORDERBOOK_ROLE", ROLE_HASHES.ORDERBOOK_ROLE, address, label);
    await revokeIfHasRole(coreVault, "CoreVault", "SETTLEMENT_ROLE", ROLE_HASHES.SETTLEMENT_ROLE, address, label);
    await revokeIfHasRole(coreVault, "CoreVault", "LIQUIDATOR_ROLE", ROLE_HASHES.LIQUIDATOR_ROLE, address, label);
  }

  // ===== Summary =====
  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("        REVOCATION COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log("Verify remaining roles by running: npx tsx scripts/check-deposit-withdrawal-roles.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
