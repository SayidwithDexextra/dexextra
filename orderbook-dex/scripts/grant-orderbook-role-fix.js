const { ethers } = require("hardhat");

/**
 * Grant ORDERBOOK_ROLE to the current OrderBook contract that's being called
 * This fixes the AccessControlUnauthorizedAccount error
 */

async function main() {
  console.log("🔧 Granting ORDERBOOK_ROLE to current OrderBook contract...\n");

  const [deployer] = await ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Current addresses from the error and contract summary
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const ORDERBOOK_ADDRESS = "0xaA5662ab1bF7BA1055B8C63281b764aF65553fec"; // From error message
  const ALUMINUM_ORDERBOOK_ADDRESS =
    "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE"; // From contract summary

  console.log("📋 VaultRouter:", VAULT_ROUTER_ADDRESS);
  console.log("📋 OrderBook (from error):", ORDERBOOK_ADDRESS);
  console.log("📋 Aluminum OrderBook (expected):", ALUMINUM_ORDERBOOK_ADDRESS);

  // Get CentralVault contract
  const vaultRouter = await ethers.getContractAt(
    "contracts/core/CentralVault.sol:CentralVault",
    VAULT_ROUTER_ADDRESS
  );

  // Get the ORDERBOOK_ROLE
  const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
  console.log("📋 ORDERBOOK_ROLE hash:", ORDERBOOK_ROLE);

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

  // Check and grant role for both OrderBook addresses
  const addresses = [ORDERBOOK_ADDRESS, ALUMINUM_ORDERBOOK_ADDRESS];

  for (const address of addresses) {
    console.log(`\n🔍 Checking OrderBook: ${address}`);

    // Check current status
    const hasRole = await vaultRouter.hasRole(ORDERBOOK_ROLE, address);
    console.log(`📋 Has ORDERBOOK_ROLE: ${hasRole}`);

    if (hasRole) {
      console.log("✅ OrderBook already has the required role!");
      continue;
    }

    // Grant the role
    console.log("🚀 Granting ORDERBOOK_ROLE...");
    try {
      const tx = await vaultRouter.grantRole(ORDERBOOK_ROLE, address);
      console.log("📋 Transaction hash:", tx.hash);

      // Wait for confirmation
      console.log("⏳ Waiting for transaction confirmation...");
      const receipt = await tx.wait();
      console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

      // Verify the role was granted
      const hasRoleAfter = await vaultRouter.hasRole(ORDERBOOK_ROLE, address);
      console.log("📋 Has ORDERBOOK_ROLE (after):", hasRoleAfter);

      if (hasRoleAfter) {
        console.log("🎉 SUCCESS! OrderBook now has ORDERBOOK_ROLE");
      } else {
        console.log("❌ FAILED! Role was not granted properly");
      }
    } catch (error) {
      console.error("❌ Error granting role:", error);
    }
  }

  console.log("\n🎯 Summary:");
  for (const address of addresses) {
    const hasRole = await vaultRouter.hasRole(ORDERBOOK_ROLE, address);
    console.log(`📋 ${address}: ${hasRole ? "✅ HAS ROLE" : "❌ NO ROLE"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
