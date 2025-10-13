import { Address } from 'viem';
import { CONTRACT_ADDRESSES as STATIC_CONTRACT_ADDRESSES } from './contracts';

/**
 * CONTRACT_ADDRESSES that uses static addresses from contracts.ts
 * This provides backward compatibility with the static configuration
 */
export const CONTRACT_ADDRESSES = STATIC_CONTRACT_ADDRESSES;

// Chain configuration
export const CHAIN_CONFIG = {
  chainId: 137, // Polygon Mainnet
  rpcUrl: 'https://polygon-rpc.com/',
} as const;

// OrderRouter ABI - focused on order querying functions
export const ORDER_ROUTER_ABI = [
  // Nonce getter for EIP-712
  {
    inputs: [{ name: 'trader', type: 'address' }],
    name: 'getNonce',
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
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
  {
    inputs: [{ name: 'trader', type: 'address' }],
    name: 'getUserActiveOrders',
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
        name: 'orders',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' },
    ],
    name: 'getUserOrderHistory',
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
        name: 'orders',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'metricId', type: 'string' },
      { name: 'depth', type: 'uint256' },
    ],
    name: 'getMarketDepth',
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
        name: 'buyOrders',
        type: 'tuple[]',
      },
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
        name: 'sellOrders',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'orderId', type: 'uint256' }],
    name: 'getOrderExecutions',
    outputs: [
      {
        components: [
          { name: 'orderId', type: 'uint256' },
          { name: 'executedQuantity', type: 'uint256' },
          { name: 'executedPrice', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'counterparty', type: 'address' },
          { name: 'fees', type: 'uint256' },
        ],
        name: 'executions',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Market information using static addresses
export const ALUMINUM_V1_MARKET = {
  marketId: 'aluminum-v1-001', // Use metric_id instead of contract hash
  symbol: 'Aluminum V1' as const,
  orderBookAddress: CONTRACT_ADDRESSES.aluminumOrderBook,
} as const;

// Enums matching the smart contract
export enum OrderType {
  MARKET = 0,
  LIMIT = 1,
  STOP_LOSS = 2,
  TAKE_PROFIT = 3,
  STOP_LIMIT = 4,
  ICEBERG = 5,
  FILL_OR_KILL = 6,
  IMMEDIATE_OR_CANCEL = 7,
  ALL_OR_NONE = 8,
}

export enum OrderSide {
  BUY = 0,
  SELL = 1,
}

export enum OrderStatus {
  PENDING = 0,
  PARTIALLY_FILLED = 1,
  FILLED = 2,
  CANCELLED = 3,
  EXPIRED = 4,
  REJECTED = 5,
}

export enum TimeInForce {
  GTC = 0, // Good Till Cancelled
  IOC = 1, // Immediate or Cancel
  FOK = 2, // Fill or Kill
  GTD = 3, // Good Till Date
}

