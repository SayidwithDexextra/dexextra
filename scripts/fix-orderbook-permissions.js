const { ethers } = require("ethers");

/**
 * Script to grant ORDERBOOK_ROLE to the OrderBook contract
 * This should fix the "missing revert data" errors
 */

const CONTRACTS = {
  vaultRouter: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
  aluminumOrderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
};

const VAULT_ROUTER_ABI = [
  "function ORDERBOOK_ROLE() external view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function getRoleAdmin(bytes32 role) external view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
];

async function main() {
  console.log("🔧 Fixing OrderBook Permissions...\n");

  // Note: This script shows the EXACT commands needed
  // You'll need to run these with the admin wallet that has permission

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");
  const vaultRouter = new ethers.Contract(
    CONTRACTS.vaultRouter,
    VAULT_ROUTER_ABI,
    provider
  );

  try {
    // Get the ORDERBOOK_ROLE constant
    const orderbookRole = await vaultRouter.ORDERBOOK_ROLE();
    console.log(`📋 ORDERBOOK_ROLE: ${orderbookRole}`);

    // Check current status
    const hasRole = await vaultRouter.hasRole(
      orderbookRole,
      CONTRACTS.aluminumOrderBook
    );
    console.log(`📋 Current status: OrderBook has ORDERBOOK_ROLE = ${hasRole}`);

    if (hasRole) {
      console.log("✅ OrderBook already has the required role!");
      return;
    }

    // Get role admin
    const roleAdmin = await vaultRouter.getRoleAdmin(orderbookRole);
    console.log(`📋 ORDERBOOK_ROLE admin: ${roleAdmin}`);

    const defaultAdmin = await vaultRouter.DEFAULT_ADMIN_ROLE();
    console.log(`📋 DEFAULT_ADMIN_ROLE: ${defaultAdmin}`);

    console.log("\n🔧 TO FIX THE ISSUE:");
    console.log("You need to execute this transaction from an admin wallet:");
    console.log("");
    console.log("Contract: VaultRouter");
    console.log(`Address: ${CONTRACTS.vaultRouter}`);
    console.log("Function: grantRole");
    console.log("Parameters:");
    console.log(`  role: ${orderbookRole}`);
    console.log(`  account: ${CONTRACTS.aluminumOrderBook}`);
    console.log("");
    console.log("📝 Hardhat command:");
    console.log(
      `npx hardhat run scripts/grant-orderbook-role.ts --network polygon`
    );
    console.log("");
    console.log("📝 Cast command (if using Foundry):");
    console.log(`cast send ${CONTRACTS.vaultRouter} \\`);
    console.log(`  "grantRole(bytes32,address)" \\`);
    console.log(`  ${orderbookRole} \\`);
    console.log(`  ${CONTRACTS.aluminumOrderBook} \\`);
    console.log(`  --rpc-url https://polygon-rpc.com/ \\`);
    console.log(`  --private-key $PRIVATE_KEY`);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main()
  .then(() => {
    console.log("\n✅ Permission check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
