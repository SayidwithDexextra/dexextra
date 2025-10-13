#!/usr/bin/env node

/**
 * Grant ORDERBOOK_ROLE to OrderBook Contract (Hardhat Script)
 *
 * This fixes the remaining AccessControlUnauthorizedAccount error by granting
 * ORDERBOOK_ROLE to the OrderBook contract in VaultRouter.
 *
 * The call flow is:
 * 1. User → TradingRouter.placeLimitOrder() ✅ (we already fixed this)
 * 2. TradingRouter → OrderBook.placeLimitOrder() ✅
 * 3. OrderBook → VaultRouter.reserveMargin() ❌ (THIS needs fixing)
 */

const hre = require("hardhat");

async function main() {
  console.log("🔧 Granting ORDERBOOK_ROLE to OrderBook contract...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses from deployment
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const ORDERBOOK_ADDRESS = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE"; // Aluminum OrderBook

  console.log("📋 Contract Addresses:");
  console.log(`   VaultRouter: ${VAULT_ROUTER_ADDRESS}`);
  console.log(`   OrderBook: ${ORDERBOOK_ADDRESS}\n`);

  try {
    // Get VaultRouter contract
    const vaultRouter = await hre.ethers.getContractAt(
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
      console.log(
        "🤔 The AccessControlUnauthorizedAccount error must be from something else."
      );
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
        "✅ This should fix the placeLimitOrder AccessControlUnauthorizedAccount error"
      );
      console.log("🔧 The complete permission chain is now set up:");
      console.log(
        "   ✅ TradingRouter has ORDERBOOK_ROLE (can call VaultRouter)"
      );
      console.log("   ✅ OrderBook has ORDERBOOK_ROLE (can call VaultRouter)");
      console.log("   ✅ Users can now place limit orders successfully!");
    } else {
      console.log("\n❌ FAILED! Role was not granted properly");
    }
  } catch (error) {
    console.error("❌ Error granting role:", error.message);

    if (error.message.includes("AccessControlUnauthorizedAccount")) {
      console.log(
        "\n🔑 Current account does not have permission to grant roles."
      );
      console.log(
        "   Please use an account with DEFAULT_ADMIN_ROLE in VaultRouter."
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });


