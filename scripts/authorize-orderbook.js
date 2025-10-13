const { ethers } = require("ethers");
require("dotenv").config();

/**
 * Standalone JavaScript authorization script for OrderBook and VaultRouter integration
 * This script can be run independently without Hardhat
 */

// Contract addresses
const VAULTROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
const ORDERBOOK_ADDRESS = "0xaA5662ab1bF7BA1055B8C63281b764aF65553fec"; // Aluminum V2

// Derived from our diagnostic - these are the exact values needed
const ORDERBOOK_ROLE =
  "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
const MARKET_ID =
  "0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b";

// VaultRouter ABI - minimal required functions
const VAULTROUTER_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function authorizedMarkets(bytes32 marketId) view returns (bool)",
  "function setMarketAuthorization(bytes32 marketId, bool authorized) external",
];

async function main() {
  console.log("🚀 OrderBook Authorization Script (Standalone)");
  console.log("==============================================\n");

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(
    process.env.POLYGON_RPC_URL || "https://polygon-rpc.com/"
  );

  if (!process.env.ADMIN_PRIVATE_KEY) {
    console.error("❌ ADMIN_PRIVATE_KEY not found in environment variables");
    console.log("   Please add ADMIN_PRIVATE_KEY to your .env file");
    process.exit(1);
  }

  const signer = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
  console.log("📋 Admin wallet:", signer.address);

  const network = await provider.getNetwork();
  console.log("📋 Network:", network.name);
  console.log("📋 Chain ID:", network.chainId.toString());
  console.log("");

  // Check balance
  const balance = await provider.getBalance(signer.address);
  console.log("💰 Admin balance:", ethers.formatEther(balance), "MATIC");
  if (balance < ethers.parseEther("0.01")) {
    console.warn(
      "⚠️  Warning: Low MATIC balance. You may need more gas for transactions."
    );
  }
  console.log("");

  // Get VaultRouter contract
  console.log("🔗 Connecting to VaultRouter...");
  const vaultRouter = new ethers.Contract(
    VAULTROUTER_ADDRESS,
    VAULTROUTER_ABI,
    signer
  );
  console.log("✅ VaultRouter connected:", VAULTROUTER_ADDRESS);
  console.log("");

  // Check current status
  console.log("🔍 Checking current authorization status...");

  const hasRole = await vaultRouter.hasRole(ORDERBOOK_ROLE, ORDERBOOK_ADDRESS);
  const isMarketAuthorized = await vaultRouter.authorizedMarkets(MARKET_ID);

  console.log(
    `   OrderBook has ORDERBOOK_ROLE: ${hasRole ? "✅ YES" : "❌ NO"}`
  );
  console.log(
    `   Market is authorized: ${isMarketAuthorized ? "✅ YES" : "❌ NO"}`
  );
  console.log("");

  let transactionsNeeded = 0;

  // 1. Grant ORDERBOOK_ROLE if not already granted
  if (!hasRole) {
    console.log("1️⃣  Granting ORDERBOOK_ROLE...");
    console.log("   Role:", ORDERBOOK_ROLE);
    console.log("   Account:", ORDERBOOK_ADDRESS);

    try {
      const tx1 = await vaultRouter.grantRole(
        ORDERBOOK_ROLE,
        ORDERBOOK_ADDRESS
      );
      console.log("   Transaction hash:", tx1.hash);
      console.log("   ⏳ Waiting for confirmation...");

      const receipt1 = await tx1.wait();
      console.log("   ✅ ORDERBOOK_ROLE granted! Block:", receipt1.blockNumber);
      transactionsNeeded++;
    } catch (error) {
      console.error("   ❌ Failed to grant role:", error.message);
      throw error;
    }
  } else {
    console.log("1️⃣  ✅ ORDERBOOK_ROLE already granted");
  }
  console.log("");

  // 2. Authorize market if not already authorized
  if (!isMarketAuthorized) {
    console.log("2️⃣  Authorizing market...");
    console.log("   Market ID:", MARKET_ID);
    console.log("   Authorized:", true);

    try {
      const tx2 = await vaultRouter.setMarketAuthorization(MARKET_ID, true);
      console.log("   Transaction hash:", tx2.hash);
      console.log("   ⏳ Waiting for confirmation...");

      const receipt2 = await tx2.wait();
      console.log("   ✅ Market authorized! Block:", receipt2.blockNumber);
      transactionsNeeded++;
    } catch (error) {
      console.error("   ❌ Failed to authorize market:", error.message);
      throw error;
    }
  } else {
    console.log("2️⃣  ✅ Market already authorized");
  }
  console.log("");

  // Final verification
  console.log("🔍 Final verification...");
  const finalHasRole = await vaultRouter.hasRole(
    ORDERBOOK_ROLE,
    ORDERBOOK_ADDRESS
  );
  const finalIsMarketAuthorized = await vaultRouter.authorizedMarkets(
    MARKET_ID
  );

  console.log(
    `   OrderBook has ORDERBOOK_ROLE: ${finalHasRole ? "✅ YES" : "❌ NO"}`
  );
  console.log(
    `   Market is authorized: ${finalIsMarketAuthorized ? "✅ YES" : "❌ NO"}`
  );
  console.log("");

  if (finalHasRole && finalIsMarketAuthorized) {
    console.log("🎉 SUCCESS! OrderBook authorization complete!");
    console.log("");
    console.log("✅ The OrderBook can now:");
    console.log("   - Reserve margin for new orders");
    console.log("   - Lock margin for filled orders");
    console.log("   - Update user positions");
    console.log("   - Process settlements");
    console.log("");
    console.log("🚀 Trading should now work on the Aluminum V2 market!");

    if (transactionsNeeded > 0) {
      console.log("");
      console.log("📊 Summary:");
      console.log(`   Transactions executed: ${transactionsNeeded}`);
      console.log("   Status: Complete");
    }
  } else {
    console.log("❌ FAILED: Authorization incomplete");
    console.log("   Please check admin permissions and try again");
  }
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
