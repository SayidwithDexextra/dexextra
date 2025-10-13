#!/usr/bin/env node

/**
 * Grant ORDERBOOK_ROLE to TradingRouter (Hardhat Script)
 *
 * This fixes the AccessControlUnauthorizedAccount error in placeLimitOrder
 * by granting the required ORDERBOOK_ROLE to TradingRouter in VaultRouter.
 *
 * Run with: npx hardhat run scripts/grant-trading-router-role-hardhat.js --network polygon
 */

const hre = require("hardhat");

async function main() {
  console.log("🔧 Granting ORDERBOOK_ROLE to TradingRouter...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses from your deployment
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const TRADING_ROUTER_ADDRESS = "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B";

  console.log("📋 Contract Addresses:");
  console.log(`   VaultRouter: ${VAULT_ROUTER_ADDRESS}`);
  console.log(`   TradingRouter: ${TRADING_ROUTER_ADDRESS}\n`);

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
      TRADING_ROUTER_ADDRESS
    );
    console.log("📋 TradingRouter has ORDERBOOK_ROLE (before):", hasRoleBefore);

    if (hasRoleBefore) {
      console.log("✅ TradingRouter already has the required role!");
      console.log(
        "✅ The AccessControlUnauthorizedAccount error is not caused by missing roles."
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
      console.log(
        "\n🔑 You need to use an account with DEFAULT_ADMIN_ROLE to grant permissions."
      );
      return;
    }

    console.log("✅ Account has admin role, proceeding...");

    // Grant the role
    console.log("\n🚀 Granting ORDERBOOK_ROLE to TradingRouter...");
    const tx = await vaultRouter.grantRole(
      ORDERBOOK_ROLE,
      TRADING_ROUTER_ADDRESS
    );
    console.log("📋 Transaction hash:", tx.hash);

    // Wait for confirmation
    console.log("⏳ Waiting for transaction confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    // Verify the role was granted
    const hasRoleAfter = await vaultRouter.hasRole(
      ORDERBOOK_ROLE,
      TRADING_ROUTER_ADDRESS
    );
    console.log("📋 TradingRouter has ORDERBOOK_ROLE (after):", hasRoleAfter);

    if (hasRoleAfter) {
      console.log("\n🎉 SUCCESS! TradingRouter now has ORDERBOOK_ROLE");
      console.log(
        "✅ This should fix the placeLimitOrder AccessControlUnauthorizedAccount error"
      );
      console.log(
        "🔧 Users should now be able to place limit orders through TradingRouter"
      );
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
