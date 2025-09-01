/**
 * OrderRouter ABI - Complete ABI with placeOrder function
 */

export const ORDER_ROUTER_ABI = [
  // placeOrder function
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "orderId", type: "uint256" },
          { internalType: "address", name: "trader", type: "address" },
          { internalType: "string", name: "metricId", type: "string" },
          { internalType: "enum IOrderRouter.OrderType", name: "orderType", type: "uint8" },
          { internalType: "enum IOrderRouter.Side", name: "side", type: "uint8" },
          { internalType: "uint256", name: "quantity", type: "uint256" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "filledQuantity", type: "uint256" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "uint256", name: "expiryTime", type: "uint256" },
          { internalType: "enum IOrderRouter.OrderStatus", name: "status", type: "uint8" },
          { internalType: "enum IOrderRouter.TimeInForce", name: "timeInForce", type: "uint8" },
          { internalType: "uint256", name: "stopPrice", type: "uint256" },
          { internalType: "uint256", name: "icebergQty", type: "uint256" },
          { internalType: "bool", name: "postOnly", type: "bool" },
          { internalType: "bytes32", name: "metadataHash", type: "bytes32" }
        ],
        internalType: "struct IOrderRouter.Order",
        name: "order",
        type: "tuple"
      }
    ],
    name: "placeOrder",
    outputs: [
      {
        internalType: "uint256",
        name: "orderId",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  // getNonce function (view)
  {
    inputs: [
      { internalType: "address", name: "trader", type: "address" }
    ],
    name: "getNonce",
    outputs: [
      { internalType: "uint256", name: "", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  },
  // placeOrderWithSig function (EIP-712 relayed)
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "orderId", type: "uint256" },
          { internalType: "address", name: "trader", type: "address" },
          { internalType: "string", name: "metricId", type: "string" },
          { internalType: "enum IOrderRouter.OrderType", name: "orderType", type: "uint8" },
          { internalType: "enum IOrderRouter.Side", name: "side", type: "uint8" },
          { internalType: "uint256", name: "quantity", type: "uint256" },
          { internalType: "uint256", name: "price", type: "uint256" },
          { internalType: "uint256", name: "filledQuantity", type: "uint256" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "uint256", name: "expiryTime", type: "uint256" },
          { internalType: "enum IOrderRouter.OrderStatus", name: "status", type: "uint8" },
          { internalType: "enum IOrderRouter.TimeInForce", name: "timeInForce", type: "uint8" },
          { internalType: "uint256", name: "stopPrice", type: "uint256" },
          { internalType: "uint256", name: "icebergQty", type: "uint256" },
          { internalType: "bool", name: "postOnly", type: "bool" },
          { internalType: "bytes32", name: "metadataHash", type: "bytes32" }
        ],
        internalType: "struct IOrderRouter.Order",
        name: "order",
        type: "tuple"
      },
      { internalType: "bytes", name: "signature", type: "bytes" }
    ],
    name: "placeOrderWithSig",
    outputs: [
      { internalType: "uint256", name: "orderId", type: "uint256" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  // View functions for orders
  {
    inputs: [{ name: 'orderId', type: 'uint256' }],
    name: 'getOrder',
    outputs: [
      {
        components: [
          { name: 'orderId', type: 'uint256' },
          { name: 'trader', type: 'address' },
          { name: 'metricId', type: 'string' },
          { name: 'orderType', type: 'uint8' },
          { name: 'side', type: 'uint8' },
          { name: 'quantity', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'filledQuantity', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'expiryTime', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'timeInForce', type: 'uint8' },
          { name: 'stopPrice', type: 'uint256' },
          { name: 'icebergQty', type: 'uint256' },
          { name: 'postOnly', type: 'bool' },
          { name: 'metadataHash', type: 'bytes32' },
        ],
        name: 'order',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // recordTradeExecution function
  {
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'executedQuantity', type: 'uint256' },
      { name: 'executedPrice', type: 'uint256' },
      { name: 'counterparty', type: 'address' },
      { name: 'fees', type: 'uint256' }
    ],
    name: 'recordTradeExecution',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;
// Minimal additional ABI entries used server-side
export const ORDER_ROUTER_READ_ABI = [
  {
    inputs: [{ name: 'metricId', type: 'string' }],
    name: 'getMarketOrderBook',
    outputs: [{ name: 'orderBook', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'metricId', type: 'string' },
      { name: 'orderBook', type: 'address' }
    ],
    name: 'registerMarket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;
