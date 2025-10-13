const { ethers } = require("hardhat");

/**
 * Grant ORDERBOOK_ROLE to the OrderBook contract on VaultRouter
 * This fixes the "missing revert data" errors in TradingRouter
 */

async function main() {
  console.log("🔧 Granting ORDERBOOK_ROLE to OrderBook contract...\n");

  const [deployer] = await ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  const VAULT_ROUTER_ADDRESS = "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5";
  const ORDERBOOK_ADDRESS = "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926";

  // Get VaultRouter contract
  const vaultRouter = await ethers.getContractAt(
    "VaultRouter",
    VAULT_ROUTER_ADDRESS
  );

  // Get the ORDERBOOK_ROLE
  const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
  console.log("📋 ORDERBOOK_ROLE:", ORDERBOOK_ROLE);

  // Check current status
  const hasRoleBefore = await vaultRouter.hasRole(
    ORDERBOOK_ROLE,
    ORDERBOOK_ADDRESS
  );
  console.log("📋 OrderBook has ORDERBOOK_ROLE (before):", hasRoleBefore);

  if (hasRoleBefore) {
    console.log("✅ OrderBook already has the required role!");
    return;
  }

  // Check if deployer has admin role
  const DEFAULT_ADMIN_ROLE = await vaultRouter.DEFAULT_ADMIN_ROLE();
  const isAdmin = await vaultRouter.hasRole(
    DEFAULT_ADMIN_ROLE,
    deployer.address
  );

  if (!isAdmin) {
    console.error("❌ Current account does not have admin role!");
    console.log("📋 Current account:", deployer.address);
    console.log("📋 Required role:", DEFAULT_ADMIN_ROLE);
    return;
  }

  console.log("✅ Account has admin role, proceeding...");

  // Grant the role
  console.log("\n🚀 Granting ORDERBOOK_ROLE to OrderBook...");
  const tx = await vaultRouter.grantRole(ORDERBOOK_ROLE, ORDERBOOK_ADDRESS);
  console.log("📋 Transaction hash:", tx.hash);

  // Wait for confirmation
  console.log("⏳ Waiting for transaction confirmation...");
  const receipt = await tx.wait();
  console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

  // Verify the role was granted
  const hasRoleAfter = await vaultRouter.hasRole(
    ORDERBOOK_ROLE,
    ORDERBOOK_ADDRESS
  );
  console.log("📋 OrderBook has ORDERBOOK_ROLE (after):", hasRoleAfter);

  if (hasRoleAfter) {
    console.log("\n🎉 SUCCESS! OrderBook now has ORDERBOOK_ROLE");
    console.log(
      "🔧 This should fix the TradingRouter getMultiMarketPrices errors"
    );
  } else {
    console.log("\n❌ FAILED! Role was not granted properly");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
