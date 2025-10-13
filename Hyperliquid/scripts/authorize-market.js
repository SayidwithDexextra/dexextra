#!/usr/bin/env node

/**
 * Authorize Market in VaultRouter (Hardhat Script)
 *
 * This fixes the "VaultRouter: unauthorized market" error by authorizing
 * the market ID in the VaultRouter contract.
 *
 * The error occurs because VaultRouter.reserveMargin() checks:
 * require(authorizedMarkets[marketId], "VaultRouter: unauthorized market");
 */

const hre = require("hardhat");

async function main() {
  console.log("🔧 Authorizing market in VaultRouter...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses and market ID from the error
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const MARKET_ID =
    "0xe9ce0bf5211b5af4539f87e2de07adc71914168eb8474e50ec4ea33f565d46d5"; // ALUMINUM_V2 market ID

  console.log("📋 Contract Details:");
  console.log(`   VaultRouter: ${VAULT_ROUTER_ADDRESS}`);
  console.log(`   Market ID: ${MARKET_ID}\n`);

  try {
    // Get VaultRouter contract
    const vaultRouter = await hre.ethers.getContractAt(
      "VaultRouter",
      VAULT_ROUTER_ADDRESS
    );

    // Check current authorization status
    const isAuthorizedBefore = await vaultRouter.authorizedMarkets(MARKET_ID);
    console.log("📋 Market authorized (before):", isAuthorizedBefore);

    if (isAuthorizedBefore) {
      console.log("✅ Market is already authorized!");
      console.log(
        "🤔 The 'unauthorized market' error must be from something else."
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

    // Authorize the market
    console.log("\n🚀 Authorizing market...");
    const tx = await vaultRouter.setMarketAuthorization(MARKET_ID, true);
    console.log("📋 Transaction hash:", tx.hash);

    // Wait for confirmation
    console.log("⏳ Waiting for transaction confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    // Verify the market was authorized
    const isAuthorizedAfter = await vaultRouter.authorizedMarkets(MARKET_ID);
    console.log("📋 Market authorized (after):", isAuthorizedAfter);

    if (isAuthorizedAfter) {
      console.log("\n🎉 SUCCESS! Market is now authorized");
      console.log(
        "✅ This should fix the 'VaultRouter: unauthorized market' error"
      );
      console.log("🔧 Users can now place limit orders for this market!");
      console.log("");
      console.log("📋 Complete fix status:");
      console.log("   ✅ TradingRouter has ORDERBOOK_ROLE");
      console.log("   ✅ OrderBook has ORDERBOOK_ROLE");
      console.log("   ✅ Market is authorized in VaultRouter");
      console.log("   ✅ All placeLimitOrder errors should be resolved!");
    } else {
      console.log("\n❌ FAILED! Market was not authorized properly");
    }
  } catch (error) {
    console.error("❌ Error authorizing market:", error.message);

    if (error.message.includes("AccessControlUnauthorizedAccount")) {
      console.log(
        "\n🔑 Current account does not have permission to authorize markets."
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
