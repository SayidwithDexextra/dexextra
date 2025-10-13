const { ethers } = require("ethers");

const VAULT_ROUTER_ADDRESS = "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5";

const VAULT_ROUTER_ABI = [
  {
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "index", type: "uint256" },
    ],
    name: "getRoleMember",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "role", type: "bytes32" }],
    name: "getRoleMemberCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "DEFAULT_ADMIN_ROLE",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    name: "hasRole",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

async function main() {
  console.log("🔍 Checking VaultRouter Admin Configuration...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");
  const vaultRouter = new ethers.Contract(
    VAULT_ROUTER_ADDRESS,
    VAULT_ROUTER_ABI,
    provider
  );

  try {
    // Get the DEFAULT_ADMIN_ROLE constant
    const defaultAdminRole = await vaultRouter.DEFAULT_ADMIN_ROLE();
    console.log(`📋 DEFAULT_ADMIN_ROLE: ${defaultAdminRole}`);

    // Get count of admin role members
    const adminCount = await vaultRouter.getRoleMemberCount(defaultAdminRole);
    console.log(`📋 Number of admins: ${adminCount}`);

    // List all admin addresses
    console.log("\n👥 Admin addresses:");
    for (let i = 0; i < adminCount; i++) {
      const adminAddress = await vaultRouter.getRoleMember(defaultAdminRole, i);
      console.log(`   ${i + 1}. ${adminAddress}`);
    }

    // Check specific addresses (if any known deployment addresses)
    const knownAddresses = [
      {
        name: "Your wallet",
        address: "0x1bc0a803de77a004086e6010cd3f72ca7684e444",
      }, // From the error
    ];

    console.log("\n🔍 Checking specific addresses:");
    for (const addr of knownAddresses) {
      const hasRole = await vaultRouter.hasRole(defaultAdminRole, addr.address);
      console.log(
        `   ${addr.name} (${addr.address}): ${
          hasRole ? "✅ HAS ADMIN" : "❌ NO ADMIN"
        }`
      );
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

main().catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
});
