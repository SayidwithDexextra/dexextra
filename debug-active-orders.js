#!/usr/bin/env node

/**
 * Debug script to test getUserActiveOrders function
 * This will help diagnose why the trading panel sell tab shows no active orders
 */

const { createPublicClient, http, getAddress } = require("viem");
const { polygon } = require("viem/chains");

// Contract configuration
const CONTRACT_ADDRESSES = {
  orderRouter: "0x836AaF8c558F7390d59591248e02435fc9Ea66aD",
  centralVault: "0x602B4B1fe6BBC10096970D4693D94376527D04ab",
  factory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d",
  umaOracleManager: "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4",
  mockUSDC: "0x194b4517a61D569aC8DBC47a22ed6F665B77a331",
};

// OrderRouter ABI - focused on getUserActiveOrders
const ORDER_ROUTER_ABI = [
  {
    inputs: [{ name: "trader", type: "address" }],
    name: "getUserActiveOrders",
    outputs: [
      {
        components: [
          { name: "orderId", type: "uint256" },
          { name: "trader", type: "address" },
          { name: "metricId", type: "string" },
          { name: "orderType", type: "uint8" },
          { name: "side", type: "uint8" },
          { name: "quantity", type: "uint256" },
          { name: "price", type: "uint256" },
          { name: "filledQuantity", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "expiryTime", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "timeInForce", type: "uint8" },
          { name: "stopPrice", type: "uint256" },
          { name: "icebergQty", type: "uint256" },
          { name: "postOnly", type: "bool" },
          { name: "metadataHash", type: "bytes32" },
        ],
        name: "orders",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "trader", type: "address" },
      { name: "limit", type: "uint256" },
      { name: "offset", type: "uint256" },
    ],
    name: "getUserOrderHistory",
    outputs: [
      {
        components: [
          { name: "orderId", type: "uint256" },
          { name: "trader", type: "address" },
          { name: "metricId", type: "string" },
          { name: "orderType", type: "uint8" },
          { name: "side", type: "uint8" },
          { name: "quantity", type: "uint256" },
          { name: "price", type: "uint256" },
          { name: "filledQuantity", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "expiryTime", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "timeInForce", type: "uint8" },
          { name: "stopPrice", type: "uint256" },
          { name: "icebergQty", type: "uint256" },
          { name: "postOnly", type: "bool" },
          { name: "metadataHash", type: "bytes32" },
        ],
        name: "orders",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// Create public client
const client = createPublicClient({
  chain: polygon,
  transport: http("https://polygon-rpc.com/"),
});

// Order status mapping
const ORDER_STATUS = {
  0: "PENDING",
  1: "PARTIALLY_FILLED",
  2: "FILLED",
  3: "CANCELLED",
  4: "EXPIRED",
};

// Order side mapping
const ORDER_SIDE = {
  0: "BUY",
  1: "SELL",
};

function transformContractOrder(contractOrder) {
  return {
    id: contractOrder.orderId.toString(),
    trader: contractOrder.trader,
    metricId: contractOrder.metricId,
    orderType: contractOrder.orderType,
    side: ORDER_SIDE[contractOrder.side] || "UNKNOWN",
    quantity: Number(contractOrder.quantity) / 1e18, // Convert from wei
    price: Number(contractOrder.price) / 1e18, // Convert from wei
    filledQuantity: Number(contractOrder.filledQuantity) / 1e18,
    timestamp: Number(contractOrder.timestamp) * 1000, // Convert to milliseconds
    expiryTime: Number(contractOrder.expiryTime) * 1000,
    status: ORDER_STATUS[contractOrder.status] || "UNKNOWN",
    timeInForce: contractOrder.timeInForce,
    stopPrice: Number(contractOrder.stopPrice) / 1e18,
    icebergQty: Number(contractOrder.icebergQty) / 1e18,
    postOnly: contractOrder.postOnly,
    metadataHash: contractOrder.metadataHash,
  };
}

async function debugUserActiveOrders(traderAddress) {
  console.log("🔍 Debug: Testing getUserActiveOrders function");
  console.log("📍 Trader Address:", traderAddress);
  console.log("📍 OrderRouter Contract:", CONTRACT_ADDRESSES.orderRouter);
  console.log("📍 Chain: Polygon (137)");
  console.log("");

  try {
    // Validate address format
    const validAddress = getAddress(traderAddress);
    console.log("✅ Address validation passed:", validAddress);

    // Test contract connection
    console.log("🔗 Testing contract connection...");

    // Call getUserActiveOrders
    console.log("📞 Calling getUserActiveOrders...");
    const activeOrdersResult = await client.readContract({
      address: CONTRACT_ADDRESSES.orderRouter,
      abi: ORDER_ROUTER_ABI,
      functionName: "getUserActiveOrders",
      args: [validAddress],
    });

    console.log("📊 Raw active orders result:", activeOrdersResult);
    console.log("📊 Active orders count:", activeOrdersResult.length);

    if (activeOrdersResult.length > 0) {
      console.log("✅ Found active orders:");
      activeOrdersResult.forEach((order, index) => {
        const transformed = transformContractOrder(order);
        console.log(`  ${index + 1}. Order ID: ${transformed.id}`);
        console.log(`     Metric: ${transformed.metricId}`);
        console.log(`     Side: ${transformed.side}`);
        console.log(`     Quantity: ${transformed.quantity}`);
        console.log(`     Price: ${transformed.price}`);
        console.log(`     Status: ${transformed.status}`);
        console.log(
          `     Filled: ${transformed.filledQuantity}/${transformed.quantity}`
        );
        console.log("");
      });
    } else {
      console.log("❌ No active orders found for this trader");
    }

    // Also test getUserOrderHistory for comparison
    console.log("📞 Calling getUserOrderHistory for comparison...");
    const orderHistoryResult = await client.readContract({
      address: CONTRACT_ADDRESSES.orderRouter,
      abi: ORDER_ROUTER_ABI,
      functionName: "getUserOrderHistory",
      args: [validAddress, 50n, 0n],
    });

    console.log("📊 Order history count:", orderHistoryResult.length);

    if (orderHistoryResult.length > 0) {
      console.log("✅ Found order history:");
      orderHistoryResult.slice(0, 5).forEach((order, index) => {
        const transformed = transformContractOrder(order);
        console.log(`  ${index + 1}. Order ID: ${transformed.id}`);
        console.log(`     Metric: ${transformed.metricId}`);
        console.log(`     Side: ${transformed.side}`);
        console.log(`     Status: ${transformed.status}`);
        console.log(
          `     Date: ${new Date(transformed.timestamp).toLocaleString()}`
        );
        console.log("");
      });

      if (orderHistoryResult.length > 5) {
        console.log(`  ... and ${orderHistoryResult.length - 5} more orders`);
      }
    } else {
      console.log("❌ No order history found for this trader");
    }
  } catch (error) {
    console.error("❌ Error testing getUserActiveOrders:", error);

    if (error.message.includes("execution reverted")) {
      console.log("💡 Contract call reverted - this could mean:");
      console.log("   - The contract address is incorrect");
      console.log("   - The ABI is mismatched");
      console.log("   - The function doesn't exist on the contract");
    }

    if (error.message.includes("invalid address")) {
      console.log("💡 Invalid address format provided");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node debug-active-orders.js <trader-address>");
    console.log(
      "Example: node debug-active-orders.js 0x742d35Cc6635C0532925a3b8D000C4Ff7c4c72d4"
    );
    process.exit(1);
  }

  const traderAddress = args[0];
  await debugUserActiveOrders(traderAddress);
}

if (require.main === module) {
  main().catch(console.error);
}
