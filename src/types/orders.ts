import { Address } from 'viem';

// Contract order structure (matches smart contract)
export interface ContractOrder {
  orderId: bigint;
  trader: Address;
  metricId: string;
  orderType: number;
  side: number;
  quantity: bigint;
  price: bigint;
  filledQuantity: bigint;
  timestamp: bigint;
  expiryTime: bigint;
  status: number;
  timeInForce: number;
  stopPrice: bigint;
  icebergQty: bigint;
  postOnly: boolean;
  metadataHash: `0x${string}`;
}

// Trade execution structure
export interface TradeExecution {
  orderId: bigint;
  executedQuantity: bigint;
  executedPrice: bigint;
  timestamp: bigint;
  counterparty: Address;
  fees: bigint;
}

// Transformed order for UI consumption
export interface Order {
  id: string;
  trader: Address;
  metricId: string;
  type: 'market' | 'limit' | 'stop_loss' | 'take_profit' | 'stop_limit' | 'iceberg' | 'fill_or_kill' | 'immediate_or_cancel' | 'all_or_none';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  filledQuantity: number;
  timestamp: number;
  expiryTime: number | null;
  status: 'pending' | 'partially_filled' | 'filled' | 'cancelled' | 'expired' | 'rejected';
  timeInForce: 'gtc' | 'ioc' | 'fok' | 'gtd';
  stopPrice: number | null;
  icebergQty: number | null;
  postOnly: boolean;
  fees?: number;
  pnl?: number;
}

// Order book entry for market depth
export interface OrderBookEntry {
  id: string;
  price: number;
  quantity: number;
  total: number;
  side: 'bid' | 'ask';
  timestamp: number;
  trader?: Address;
}

// Market depth response
export interface MarketDepth {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  midPrice: number;
}

// Transaction for display (legacy compatibility)
export interface Transaction {
  id: string;
  type: 'long' | 'short';
  amount: number;
  price: number;
  timestamp: number;
  pnl?: number;
  status: 'open' | 'closed' | 'liquidated';
  leverage: number;
  fees: number;
}

