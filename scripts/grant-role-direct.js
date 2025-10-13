const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Direct script to grant ORDERBOOK_ROLE using ethers.js
 * Run with: PRIVATE_KEY=<your_key> node scripts/grant-role-direct.js
 */

const CONTRACTS = {
  vaultRouter: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
  orderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
};

// Minimal VaultRouter ABI
const VAULT_ROUTER_ABI = [
  "function ORDERBOOK_ROLE() external view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
];

async function main() {
  console.log("🔧 Granting ORDERBOOK_ROLE directly...\n");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ Please set PRIVATE_KEY environment variable");
    console.log(
      "Usage: PRIVATE_KEY=<your_key> node scripts/grant-role-direct.js"
    );
    process.exit(1);
  }

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");
  const signer = new ethers.Wallet(privateKey, provider);

  console.log("👤 Using account:", signer.address);

  // Get contract
  const vaultRouter = new ethers.Contract(
    CONTRACTS.vaultRouter,
    VAULT_ROUTER_ABI,
    signer
  );

  try {
    // Get roles
    const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();
    const DEFAULT_ADMIN_ROLE = await vaultRouter.DEFAULT_ADMIN_ROLE();

    console.log("📋 ORDERBOOK_ROLE:", ORDERBOOK_ROLE);
    console.log("📋 DEFAULT_ADMIN_ROLE:", DEFAULT_ADMIN_ROLE);

    // Check current status
    const hasRoleBefore = await vaultRouter.hasRole(
      ORDERBOOK_ROLE,
      CONTRACTS.orderBook
    );
    console.log("📋 OrderBook has ORDERBOOK_ROLE (before):", hasRoleBefore);

    if (hasRoleBefore) {
      console.log("✅ OrderBook already has the required role!");
      return;
    }

    // Check if signer has admin role
    const isAdmin = await vaultRouter.hasRole(
      DEFAULT_ADMIN_ROLE,
      signer.address
    );

    if (!isAdmin) {
      console.error("❌ Current account does not have admin role!");
      console.log("📋 Current account:", signer.address);
      console.log("📋 Required role:", DEFAULT_ADMIN_ROLE);
      return;
    }

    console.log("✅ Account has admin role, proceeding...");

    // Grant the role
    console.log("\n🚀 Granting ORDERBOOK_ROLE to OrderBook...");
    const tx = await vaultRouter.grantRole(
      ORDERBOOK_ROLE,
      CONTRACTS.orderBook,
      {
        gasLimit: 100000,
      }
    );
    console.log("📋 Transaction hash:", tx.hash);

    // Wait for confirmation
    console.log("⏳ Waiting for transaction confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    // Verify the role was granted
    const hasRoleAfter = await vaultRouter.hasRole(
      ORDERBOOK_ROLE,
      CONTRACTS.orderBook
    );
    console.log("📋 OrderBook has ORDERBOOK_ROLE (after):", hasRoleAfter);

    if (hasRoleAfter) {
      console.log("\n🎉 SUCCESS! OrderBook now has ORDERBOOK_ROLE");
      console.log(
        "🔧 This should fix the TradingRouter getMultiMarketPrices errors"
      );
      console.log("\n🧪 Test the fix by running:");
      console.log("node scripts/test-orderbook-direct.js");
    } else {
      console.log("\n❌ FAILED! Role was not granted properly");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.code === "CALL_EXCEPTION") {
      console.log("💡 This might be due to:");
      console.log("   - Insufficient permissions");
      console.log("   - Wrong account");
      console.log("   - Network issues");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
