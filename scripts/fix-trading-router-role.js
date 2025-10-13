#!/usr/bin/env node

/**
 * Fix TradingRouter Permission Issue
 *
 * The error "AccessControlUnauthorizedAccount" (0xe2517d3f) occurs because
 * TradingRouter needs ORDERBOOK_ROLE in VaultRouter to call reserveMargin()
 *
 * This script grants the required role to fix placeLimitOrder functionality.
 */

const { createPublicClient, http } = require("viem");
const { polygon } = require("viem/chains");

// Contract addresses from contractConfig.ts
const CONTRACT_ADDRESSES = {
  vaultRouter: "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7",
  tradingRouter: "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B",
};

// VaultRouter ABI - only the functions we need
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

// Create clients
const publicClient = createPublicClient({
  chain: polygon,
  transport: http("https://polygon-rpc.com/"),
});

async function fixTradingRouterRole() {
  console.log("🔧 Fixing TradingRouter Role Permission Issue...\n");

  console.log("📋 Contract Addresses:");
  console.log(`   VaultRouter: ${CONTRACT_ADDRESSES.vaultRouter}`);
  console.log(`   TradingRouter: ${CONTRACT_ADDRESSES.tradingRouter}\n`);

  try {
    // 1. Get the ORDERBOOK_ROLE from VaultRouter
    const orderbookRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "ORDERBOOK_ROLE",
      args: [],
    });

    console.log(`✅ ORDERBOOK_ROLE: ${orderbookRole}\n`);

    // 2. Check if TradingRouter already has the role
    const hasRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "hasRole",
      args: [orderbookRole, CONTRACT_ADDRESSES.tradingRouter],
    });

    console.log(`📋 TradingRouter has ORDERBOOK_ROLE: ${hasRole}`);

    if (hasRole) {
      console.log("✅ TradingRouter already has ORDERBOOK_ROLE!");
      console.log("🤔 The permission issue might be caused by something else.");
      return { success: true, alreadyGranted: true };
    }

    console.log("\n❌ TradingRouter is missing ORDERBOOK_ROLE!");
    console.log(
      "🔧 This is the cause of the AccessControlUnauthorizedAccount error."
    );

    console.log("\n📋 To fix this issue, an admin needs to run:");
    console.log("");
    console.log("```javascript");
    console.log(`// Grant ORDERBOOK_ROLE to TradingRouter`);
    console.log(
      `const vaultRouter = await ethers.getContractAt("VaultRouter", "${CONTRACT_ADDRESSES.vaultRouter}");`
    );
    console.log(`const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();`);
    console.log(
      `await vaultRouter.grantRole(ORDERBOOK_ROLE, "${CONTRACT_ADDRESSES.tradingRouter}");`
    );
    console.log("```");

    console.log(
      "\n🎯 This will allow TradingRouter to call reserveMargin() in VaultRouter,"
    );
    console.log("   which is required for placeLimitOrder to work properly.");

    return { success: true, roleNeeded: true };
  } catch (error) {
    console.error("❌ Error checking TradingRouter role:", error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("🚀 TradingRouter Permission Diagnostic\n");

  const result = await fixTradingRouterRole();

  console.log("\n📊 DIAGNOSIS RESULTS");
  console.log("=".repeat(50));

  if (result.success) {
    if (result.alreadyGranted) {
      console.log("✅ TradingRouter has correct permissions");
      console.log("🔍 The placeLimitOrder error might be caused by:");
      console.log("   1. Insufficient user collateral in VaultRouter");
      console.log("   2. Market not authorized in VaultRouter");
      console.log("   3. Different permission issue in OrderBook contract");
    } else if (result.roleNeeded) {
      console.log("❌ ISSUE IDENTIFIED: TradingRouter missing ORDERBOOK_ROLE");
      console.log(
        "🔧 SOLUTION: Grant ORDERBOOK_ROLE to TradingRouter in VaultRouter"
      );
      console.log(
        "🎯 IMPACT: This will fix the placeLimitOrder AccessControlUnauthorizedAccount error"
      );
    }
  } else {
    console.log("❌ Diagnostic failed");
    console.log(`   Error: ${result.error}`);
  }

  console.log("\n✅ Diagnostic complete!");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { fixTradingRouterRole };


