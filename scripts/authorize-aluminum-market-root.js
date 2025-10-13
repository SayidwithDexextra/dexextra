const { ethers } = require("ethers");

const VAULT_ROUTER_ADDRESS = "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5";
const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

// Load environment variables from root .env.local
require("dotenv").config({ path: ".env.local" });

const VAULT_ROUTER_ABI = [
  {
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "authorized", type: "bool" },
    ],
    name: "setMarketAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "bytes32" }],
    name: "authorizedMarkets",
    outputs: [{ name: "", type: "bool" }],
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
  {
    inputs: [],
    name: "DEFAULT_ADMIN_ROLE",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
];

async function main() {
  console.log("🔐 Authorizing Aluminum V1 Market in VaultRouter...\n");

  // Check if private key is available (using SETTLEMENT_PRIVATE_KEY)
  const privateKey =
    process.env.SETTLEMENT_PRIVATE_KEY || process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.log("❌ SETTLEMENT_PRIVATE_KEY not found in root .env.local");
    console.log("💡 Please check your .env.local file contains:");
    console.log("   SETTLEMENT_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`📱 Using wallet: ${wallet.address}`);

  // Create contract instance
  const vaultRouter = new ethers.Contract(
    VAULT_ROUTER_ADDRESS,
    VAULT_ROUTER_ABI,
    wallet
  );

  try {
    // Check current authorization status
    console.log("📋 Step 1: Checking current authorization status...");
    const currentAuth = await vaultRouter.authorizedMarkets(ALUMINUM_MARKET_ID);
    console.log(
      `   Current status: ${
        currentAuth ? "✅ AUTHORIZED" : "❌ NOT AUTHORIZED"
      }`
    );

    if (currentAuth) {
      console.log("✅ Market is already authorized! No action needed.");
      return;
    }

    // Check if wallet has admin role
    console.log("\n📋 Step 2: Checking admin permissions...");
    const defaultAdminRole = await vaultRouter.DEFAULT_ADMIN_ROLE();
    const hasAdminRole = await vaultRouter.hasRole(
      defaultAdminRole,
      wallet.address
    );

    console.log(`   DEFAULT_ADMIN_ROLE: ${defaultAdminRole}`);
    console.log(
      `   Wallet has admin role: ${hasAdminRole ? "✅ YES" : "❌ NO"}`
    );

    if (!hasAdminRole) {
      console.log("\n❌ ERROR: Wallet does not have DEFAULT_ADMIN_ROLE");
      console.log("💡 Only the admin can authorize markets");
      console.log(
        "   You may need to use a different wallet or ask the admin to run this"
      );
      process.exit(1);
    }

    // Authorize the market
    console.log("\n📋 Step 3: Authorizing market...");
    console.log(`   Market ID: ${ALUMINUM_MARKET_ID}`);
    console.log(`   Symbol: Aluminum V1`);

    const tx = await vaultRouter.setMarketAuthorization(
      ALUMINUM_MARKET_ID,
      true
    );
    console.log(`   📤 Transaction sent: ${tx.hash}`);

    console.log("   ⏳ Waiting for confirmation...");
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log("   ✅ Transaction confirmed!");

      // Verify authorization
      console.log("\n📋 Step 4: Verifying authorization...");
      const newAuth = await vaultRouter.authorizedMarkets(ALUMINUM_MARKET_ID);
      console.log(
        `   New status: ${newAuth ? "✅ AUTHORIZED" : "❌ NOT AUTHORIZED"}`
      );

      if (newAuth) {
        console.log(
          "\n🎉 SUCCESS! Aluminum V1 market is now authorized for trading!"
        );
        console.log("   You can now place orders on the market.");
      } else {
        console.log("\n❌ ERROR: Authorization failed to update");
      }
    } else {
      console.log("   ❌ Transaction failed");
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);

    if (error.message.includes("insufficient funds")) {
      console.log("💡 Make sure your wallet has enough MATIC for gas fees");
    } else if (error.message.includes("AccessControl")) {
      console.log("💡 Make sure your wallet has the required admin role");
    } else if (error.message.includes("missing revert data")) {
      console.log(
        "💡 The VaultRouter contract may have an issue - try checking the contract address"
      );
    }
  }
}

main().catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
});
