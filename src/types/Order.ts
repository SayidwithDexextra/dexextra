export interface Order {
  orderId: string;
  trader: string;
  metricId: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: bigint;
  price: bigint;
  stopPrice: string;
  timeInForce: string;
  timestamp: bigint;
  nonce: bigint;
  signature: string;
  icebergQty: string;
  postOnly: boolean;
  metadataHash: string;
}

export enum OrderSide {
  BUY = 0,
  SELL = 1
}

export enum OrderType {
  MARKET = 0,
  LIMIT = 1,
  STOP_LOSS = 2,
  TAKE_PROFIT = 3,
  STOP_LIMIT = 4,
  ICEBERG = 5,
  FILL_OR_KILL = 6,
  IMMEDIATE_OR_CANCEL = 7,
  ALL_OR_NONE = 8
}

export enum OrderStatus {
  PENDING = 0,
  PARTIALLY_FILLED = 1,
  FILLED = 2,
  CANCELLED = 3,
  EXPIRED = 4,
  REJECTED = 5
}

export interface TradeMatch {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  metricId: string;
  quantity: bigint;
  price: bigint;
  buyerAddress: string;
  sellerAddress: string;
  timestamp: bigint;
}

export interface Position {
  trader: string;
  metricId: string;
  side: OrderSide;
  quantity: bigint;
  avgPrice: bigint;
  collateral: bigint;
  lastUpdate: bigint;
}

export interface OrderBookState {
  metricId: string;
  buyOrders?: Order[];
  sellOrders?: Order[];
  bestBid?: bigint;
  bestAsk?: bigint;
  lastUpdateTime?: string;
  spread?: bigint;
  depth?: number;
}

export interface MarketStats {
  metricId: string;
  lastPrice: bigint;
  volume24h: bigint;
  high24h: bigint;
  low24h: bigint;
  priceChange24h: bigint;
  orderCount: bigint;
  totalVolume: bigint;
}







