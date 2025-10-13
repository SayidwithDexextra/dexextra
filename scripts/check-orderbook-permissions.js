#!/usr/bin/env node

/**
 * Check OrderBook Permissions in VaultRouter
 *
 * The issue might be that the OrderBook contract itself doesn't have
 * ORDERBOOK_ROLE in VaultRouter to call reserveMargin()
 */

const { createPublicClient, http } = require("viem");
const { polygon } = require("viem/chains");

// Contract addresses
const CONTRACT_ADDRESSES = {
  vaultRouter: "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7",
  tradingRouter: "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B",
  aluminumOrderBook: "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE", // From contractConfig.ts
};

// VaultRouter ABI
const VAULT_ROUTER_ABI = [
  {
    inputs: [],
    name: "ORDERBOOK_ROLE",
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
];

const publicClient = createPublicClient({
  chain: polygon,
  transport: http("https://polygon-rpc.com/"),
});

async function checkPermissions() {
  console.log("🔍 Checking ORDERBOOK_ROLE Permissions...\n");

  try {
    // Get ORDERBOOK_ROLE
    const orderbookRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "ORDERBOOK_ROLE",
      args: [],
    });

    console.log(`📋 ORDERBOOK_ROLE: ${orderbookRole}\n`);

    // Check TradingRouter permissions
    const tradingRouterHasRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "hasRole",
      args: [orderbookRole, CONTRACT_ADDRESSES.tradingRouter],
    });

    console.log(`✅ TradingRouter has ORDERBOOK_ROLE: ${tradingRouterHasRole}`);

    // Check OrderBook permissions
    const orderBookHasRole = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.vaultRouter,
      abi: VAULT_ROUTER_ABI,
      functionName: "hasRole",
      args: [orderbookRole, CONTRACT_ADDRESSES.aluminumOrderBook],
    });

    console.log(`📋 OrderBook has ORDERBOOK_ROLE: ${orderBookHasRole}`);

    console.log("\n🔍 DIAGNOSIS:");
    console.log("=".repeat(50));

    if (!orderBookHasRole) {
      console.log("❌ ISSUE FOUND: OrderBook contract missing ORDERBOOK_ROLE!");
      console.log("🔧 The call flow is:");
      console.log("   1. User → TradingRouter.placeLimitOrder() ✅");
      console.log("   2. TradingRouter → OrderBook.placeLimitOrder() ✅");
      console.log(
        "   3. OrderBook → VaultRouter.reserveMargin() ❌ (NO PERMISSION)"
      );
      console.log("");
      console.log("🎯 SOLUTION: Grant ORDERBOOK_ROLE to OrderBook contract");
      console.log(
        `   OrderBook Address: ${CONTRACT_ADDRESSES.aluminumOrderBook}`
      );

      return {
        success: true,
        needsOrderBookRole: true,
        orderBookAddress: CONTRACT_ADDRESSES.aluminumOrderBook,
        orderbookRole,
      };
    } else {
      console.log(
        "✅ Both TradingRouter and OrderBook have required permissions"
      );
      console.log("🤔 The error might be caused by something else:");
      console.log("   1. Insufficient user collateral");
      console.log("   2. Market not authorized");
      console.log("   3. Order validation issues");

      return { success: true, permissionsOk: true };
    }
  } catch (error) {
    console.error("❌ Error checking permissions:", error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("🚀 OrderBook Permission Diagnostic\n");

  const result = await checkPermissions();

  if (result.success && result.needsOrderBookRole) {
    console.log("\n🔧 TO FIX THE ISSUE:");
    console.log("Run the following command in Hardhat:");
    console.log("");
    console.log("```javascript");
    console.log(
      `const vaultRouter = await ethers.getContractAt("VaultRouter", "${CONTRACT_ADDRESSES.vaultRouter}");`
    );
    console.log("const ORDERBOOK_ROLE = await vaultRouter.ORDERBOOK_ROLE();");
    console.log(
      `await vaultRouter.grantRole(ORDERBOOK_ROLE, "${result.orderBookAddress}");`
    );
    console.log("```");
  }

  console.log("\n✅ Diagnostic complete!");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkPermissions };


