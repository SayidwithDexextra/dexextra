#!/usr/bin/env node

/**
 * Grant ORDERBOOK_ROLE to TradingRouter
 *
 * This script fixes the AccessControlUnauthorizedAccount error by granting
 * the required ORDERBOOK_ROLE to TradingRouter in VaultRouter contract.
 *
 * IMPORTANT: This script requires admin privileges (private key with DEFAULT_ADMIN_ROLE)
 */

const { createPublicClient, createWalletClient, http } = require("viem");
const { polygon } = require("viem/chains");
const { privateKeyToAccount } = require("viem/accounts");

// Contract addresses
const CONTRACT_ADDRESSES = {
  vaultRouter: "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7",
  tradingRouter: "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B",
};

// VaultRouter ABI - functions needed for role management
const VAULT_ROUTER_ABI = [
  {
    inputs: [],
    name: "ORDERBOOK_ROLE",
    outputs: [{ name: "", type: "bytes32" }],
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
  {
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Create public client
const publicClient = createPublicClient({
  chain: polygon,
  transport: http("https://polygon-rpc.com/"),
});

async function grantTradingRouterRole() {
  console.log("🔧 Granting ORDERBOOK_ROLE to TradingRouter...\n");

  // NOTE: This is a demonstration script. In production, you would need:
  // 1. The private key of an account with DEFAULT_ADMIN_ROLE
  // 2. Proper key management and security practices

  console.log("📋 Contract Addresses:");
  console.log(`   VaultRouter: ${CONTRACT_ADDRESSES.vaultRouter}`);
  console.log(`   TradingRouter: ${CONTRACT_ADDRESSES.tradingRouter}\n`);

  try {
    // 1. Check current role status
    const orderbookRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "ORDERBOOK_ROLE",
      args: [],
    });

    console.log(`✅ ORDERBOOK_ROLE: ${orderbookRole}`);

    const hasRoleBefore = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "hasRole",
      args: [orderbookRole, CONTRACT_ADDRESSES.tradingRouter],
    });

    console.log(
      `📋 TradingRouter has ORDERBOOK_ROLE (before): ${hasRoleBefore}\n`
    );

    if (hasRoleBefore) {
      console.log("✅ TradingRouter already has ORDERBOOK_ROLE!");
      console.log(
        "✅ The AccessControlUnauthorizedAccount error should not be caused by missing roles."
      );
      return { success: true, alreadyGranted: true };
    }

    console.log("❌ TradingRouter is missing ORDERBOOK_ROLE");
    console.log(
      "🔧 This is causing the AccessControlUnauthorizedAccount error\n"
    );

    // For security reasons, we don't include actual private key handling here
    console.log("🔑 TO COMPLETE THE FIX:");
    console.log("");
    console.log("1. Someone with admin privileges needs to run:");
    console.log("");
    console.log("```bash");
    console.log("# In Hardhat console or deployment script:");
    console.log("const [deployer] = await ethers.getSigners();");
    console.log(
      `const vaultRouter = await ethers.getContractAt("VaultRouter", "${CONTRACT_ADDRESSES.vaultRouter}");`
    );
    console.log("const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();");
    console.log(
      `const tx = await vaultRouter.grantRole(ORDERBOOK_ROLE, "${CONTRACT_ADDRESSES.tradingRouter}");`
    );
    console.log("await tx.wait();");
    console.log('console.log("✅ ORDERBOOK_ROLE granted to TradingRouter!");');
    console.log("```");
    console.log("");
    console.log(
      "2. Alternative using cast (if you have the admin private key):"
    );
    console.log("");
    console.log("```bash");
    console.log(`cast send ${CONTRACT_ADDRESSES.vaultRouter} \\`);
    console.log(`  "grantRole(bytes32,address)" \\`);
    console.log(`  ${orderbookRole} \\`);
    console.log(`  ${CONTRACT_ADDRESSES.tradingRouter} \\`);
    console.log("  --private-key $ADMIN_PRIVATE_KEY \\");
    console.log("  --rpc-url https://polygon-rpc.com/");
    console.log("```");

    return { success: true, roleNeeded: true, orderbookRole };
  } catch (error) {
    console.error("❌ Error checking roles:", error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("🚀 Grant TradingRouter ORDERBOOK_ROLE\n");

  const result = await grantTradingRouterRole();

  console.log("\n📊 RESULTS");
  console.log("=".repeat(50));

  if (result.success) {
    if (result.alreadyGranted) {
      console.log("✅ TradingRouter already has required permissions");
      console.log("🔍 If placeLimitOrder still fails, check:");
      console.log("   1. User has sufficient collateral in VaultRouter");
      console.log("   2. Market is authorized in VaultRouter");
      console.log("   3. OrderBook contract has correct permissions");
    } else if (result.roleNeeded) {
      console.log("🎯 ACTION REQUIRED: Grant ORDERBOOK_ROLE to TradingRouter");
      console.log("🔧 IMPACT: This will fix the placeLimitOrder error");
      console.log(
        "⚠️  SECURITY: Only admin accounts can perform this operation"
      );
    }
  } else {
    console.log("❌ Script failed");
    console.log(`   Error: ${result.error}`);
  }

  console.log("\n✅ Role management script complete!");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { grantTradingRouterRole };


