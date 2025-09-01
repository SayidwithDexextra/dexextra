const {
  createWalletClient,
  createPublicClient,
  hashTypedData,
  recoverTypedDataAddress,
  http,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { polygon } = require("viem/chains");

// Load environment variables
require("dotenv").config({ path: ".env.local" });

// Configuration
const MARKET_ID = "SILVER_Relayed_Meridian_2025_85969"; // Metric ID for the market
const ORDER_ROUTER_ADDRESS = "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";
const CENTRAL_VAULT_ADDRESS = "0x602B4B1fe6BBC10096970D4693D94376527D04ab";
const MOCK_USDC_ADDRESS = "0x194b4517a61D569aC8DBC47a22ed6F665B77a331";

// Price action configuration
const START_PRICE = 20; // Start from current price
const TARGET_PRICE = 22.75; // Target price
const PRICE_INCREMENT = 0.25; // $0.25 increments
const MIN_SIZE = 10; // Small order sizes
const MAX_SIZE = 30;
const TICK_SIZE = 0.01;

// Collateral configuration - Much smaller amount for $10-$15 range
const COLLATERAL_AMOUNT = BigInt(5000) * BigInt(1e6); // 5K USDC (enough for price action)

// EIP-712 domain and types
const ORDER_DOMAIN = {
  name: "DexextraOrderRouter", // Must match your system exactly
  version: "1",
  chainId: 137, // Polygon mainnet
  verifyingContract: ORDER_ROUTER_ADDRESS,
};

const ORDER_TYPES = {
  Order: [
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
    { name: "nonce", type: "uint256" },
  ],
};

// Wallet configuration - REPLACE WITH YOUR VALUES
const PRIVATE_KEY =
  "0x210a154ad78862f09a89e5f9a916fdaf457eecbe0045423008267a64cf1d8ec5";
const API_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

console.log("🔑 Using hardcoded private key for price action generation");

// Initialize wallet and public clients
const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(process.env.RPC_URL || "https://polygon-rpc.com/"),
});

const publicClient = createPublicClient({
  chain: polygon,
  transport: http(process.env.RPC_URL || "https://polygon-rpc.com/"),
});

// Helper functions
function roundToTick(price) {
  return Math.round(price / TICK_SIZE) * TICK_SIZE;
}

async function mintAndApproveCollateral() {
  // Create contract instances
  const mockUSDC = {
    address: MOCK_USDC_ADDRESS,
    abi: [
      {
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "mint",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
      {
        inputs: [{ name: "owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ],
  };

  // Mint USDC to our wallet
  console.log(`🏦 Minting ${COLLATERAL_AMOUNT} USDC to ${account.address}...`);
  const mintTx = await walletClient.writeContract({
    ...mockUSDC,
    functionName: "mint",
    args: [account.address, COLLATERAL_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });

  // Approve USDC spending by CentralVault
  console.log(`✅ Approving USDC spending by CentralVault...`);
  const approveTx = await walletClient.writeContract({
    ...mockUSDC,
    functionName: "approve",
    args: [CENTRAL_VAULT_ADDRESS, COLLATERAL_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  console.log("✅ Collateral minted and approved");
}

async function depositCollateral() {
  // Create CentralVault contract instance
  const centralVault = {
    address: CENTRAL_VAULT_ADDRESS,
    abi: [
      {
        inputs: [{ name: "amount", type: "uint256" }],
        name: "depositPrimaryCollateral",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
      {
        inputs: [{ name: "user", type: "address" }],
        name: "getPrimaryCollateralBalance",
        outputs: [
          { name: "available", type: "uint256" },
          { name: "allocated", type: "uint256" },
          { name: "locked", type: "uint256" },
        ],
        stateMutability: "view",
        type: "function",
      },
    ],
  };

  // Deposit USDC into CentralVault
  console.log(`💰 Depositing ${COLLATERAL_AMOUNT} USDC into CentralVault...`);
  const depositTx = await walletClient.writeContract({
    ...centralVault,
    functionName: "depositPrimaryCollateral",
    args: [COLLATERAL_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositTx });

  // Check our balance
  const balance = await walletClient.readContract({
    ...centralVault,
    functionName: "getPrimaryCollateralBalance",
    args: [account.address],
  });

  console.log("✅ Collateral deposited. Balance:", {
    available: balance[0],
    allocated: balance[1],
    locked: balance[2],
  });
}

async function checkCollateralBalance() {
  const centralVault = {
    address: CENTRAL_VAULT_ADDRESS,
    abi: [
      {
        inputs: [{ name: "user", type: "address" }],
        name: "getPrimaryCollateralBalance",
        outputs: [
          { name: "available", type: "uint256" },
          { name: "allocated", type: "uint256" },
          { name: "locked", type: "uint256" },
        ],
        stateMutability: "view",
        type: "function",
      },
    ],
  };

  const balance = await walletClient.readContract({
    ...centralVault,
    functionName: "getPrimaryCollateralBalance",
    args: [account.address],
  });

  return {
    available: balance[0],
    allocated: balance[1],
    locked: balance[2],
  };
}

async function placeOrder(side, quantity, price = null) {
  const orderType = price ? "LIMIT" : "MARKET";
  const timeInForce = price ? "GTC" : "IOC";
  const timestamp = Date.now();
  const nonce = Math.floor(Math.random() * 1000000); // In production, this should be tracked/incremented

  // Convert order data to the exact format expected by the contract
  const order = {
    orderId: BigInt(0), // Will be assigned by contract
    trader: account.address,
    metricId: MARKET_ID,
    orderType: orderType === "MARKET" ? 0 : 1, // 0 = MARKET, 1 = LIMIT
    side: side === "BUY" ? 0 : 1, // 0 = BUY, 1 = SELL
    quantity: BigInt(Math.floor(quantity * 1e18)), // Convert to wei
    price: price ? BigInt(Math.floor(price * 1e18)) : BigInt(0),
    filledQuantity: BigInt(0),
    timestamp: BigInt(0), // Will be set by contract
    expiryTime: BigInt(0),
    status: 0, // PENDING
    timeInForce: timeInForce === "GTC" ? 0 : 1, // 0 = GTC, 1 = IOC
    stopPrice: BigInt(0),
    icebergQty: BigInt(0),
    postOnly: false,
    metadataHash: `0x${"0".repeat(64)}`,
    nonce: BigInt(nonce),
  };

  // Sign the order using EIP-712
  const signature = await walletClient.signTypedData({
    domain: ORDER_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  // Prepare API request
  const apiOrder = {
    metricId: MARKET_ID,
    orderType: orderType,
    side: side,
    quantity: quantity.toString(),
    price: price ? price.toString() : undefined,
    timeInForce: timeInForce,
    postOnly: false,
    reduceOnly: false,
    signature: signature,
    walletAddress: account.address,
    nonce: nonce,
    timestamp: timestamp,
  };

  // Submit order to API
  const response = await fetch(`${API_URL}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(apiOrder),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Order submission failed:", errorText);
    throw new Error(`Failed to place order: ${errorText}`);
  }

  return await response.json();
}

async function generatePriceAction(currentPrice) {
  try {
    // Calculate next target price
    const nextPrice = roundToTick(
      Math.min(currentPrice + PRICE_INCREMENT, TARGET_PRICE)
    );
    const quantity = Math.round(
      MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE)
    );

    // First place a limit buy order at current price to provide liquidity
    console.log(
      `📈 Placing BUY order for ${quantity} units at ${currentPrice}`
    );
    await placeOrder("BUY", quantity, currentPrice);

    // Then place a market sell order at a slightly higher price
    const sellQuantity = Math.round(quantity * 0.7); // Sell 70% to maintain some buy pressure
    console.log(
      `📉 Placing SELL order for ${sellQuantity} units at ${nextPrice}`
    );
    await placeOrder("SELL", sellQuantity, nextPrice);

    return nextPrice;
  } catch (error) {
    console.error("Error generating price action:", error);
    return currentPrice;
  }
}

// Simplified price action generator - just place orders
async function startPriceActionGenerator() {
  try {
    console.log(`🚀 Moving price from $${START_PRICE} to $${TARGET_PRICE}`);
    console.log("=".repeat(60));

    let currentPrice = START_PRICE;
    let step = 1;

    while (currentPrice < TARGET_PRICE) {
      const nextPrice = Math.min(currentPrice + PRICE_INCREMENT, TARGET_PRICE);

      console.log(`\n📈 Step ${step}: $${currentPrice} → $${nextPrice}`);

      // Place a limit sell order at the next price level
      console.log(`📊 Placing LIMIT SELL: 25 units @ $${nextPrice}`);
      await placeOrder("SELL", 25, nextPrice);

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Place a market buy to push price up
      console.log(`📊 Placing MARKET BUY: 25 units`);
      await placeOrder("BUY", 25);

      currentPrice = nextPrice;
      step++;

      console.log(`💰 New price level: $${currentPrice}`);

      // Short wait between steps
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log(`\n🎉 Target price of $${TARGET_PRICE} reached!`);
    console.log("📊 Check your UI to see the updated price!");
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

// Start the generator if run directly
if (require.main === module) {
  startPriceActionGenerator().catch(console.error);
}
