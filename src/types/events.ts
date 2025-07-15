// Smart Contract Event Types
export interface BaseEvent {
  id?: string
  transactionHash: string
  blockNumber: number
  blockHash: string
  logIndex: number
  contractAddress: string
  timestamp: Date
  chainId: number
}

// vAMM Events
export interface PositionOpenedEvent extends BaseEvent {
  eventType: 'PositionOpened'
  user: string
  positionId: string
  isLong: boolean
  size: string
  price: string
  leverage: string
  fee: string
}

export interface PositionClosedEvent extends BaseEvent {
  eventType: 'PositionClosed'
  user: string
  positionId: string
  size: string
  price: string
  pnl: string
  fee: string
}

export interface PositionIncreasedEvent extends BaseEvent {
  eventType: 'PositionIncreased'
  user: string
  positionId: string
  sizeAdded: string
  newSize: string
  newEntryPrice: string
  fee: string
}

export interface FundingUpdatedEvent extends BaseEvent {
  eventType: 'FundingUpdated'
  fundingRate: string
  fundingIndex: string
  premiumFraction: string
}

export interface FundingPaidEvent extends BaseEvent {
  eventType: 'FundingPaid'
  user: string
  positionId: string
  amount: string
  fundingIndex: string
}

export interface PositionLiquidatedEvent extends BaseEvent {
  eventType: 'PositionLiquidated'
  user: string
  positionId: string
  liquidator: string
  size: string
  price: string
  fee: string
}

export interface TradingFeeCollectedEvent extends BaseEvent {
  eventType: 'TradingFeeCollected'
  user: string
  amount: string
}

export interface ParametersUpdatedEvent extends BaseEvent {
  eventType: 'ParametersUpdated'
  parameter: string
  newValue: string
}

export interface VirtualReservesUpdatedEvent extends BaseEvent {
  eventType: 'VirtualReservesUpdated'
  baseReserves: string
  quoteReserves: string
  multiplier: string
}

// Vault Events
export interface CollateralDepositedEvent extends BaseEvent {
  eventType: 'CollateralDeposited'
  user: string
  amount: string
}

export interface CollateralWithdrawnEvent extends BaseEvent {
  eventType: 'CollateralWithdrawn'
  user: string
  amount: string
}

export interface MarginReservedEvent extends BaseEvent {
  eventType: 'MarginReserved'
  user: string
  amount: string
}

export interface MarginReleasedEvent extends BaseEvent {
  eventType: 'MarginReleased'
  user: string
  amount: string
}

export interface PnLUpdatedEvent extends BaseEvent {
  eventType: 'PnLUpdated'
  user: string
  pnlDelta: string
}

export interface FundingAppliedEvent extends BaseEvent {
  eventType: 'FundingApplied'
  user: string
  fundingPayment: string
  fundingIndex: string
}

export interface UserLiquidatedEvent extends BaseEvent {
  eventType: 'UserLiquidated'
  user: string
  penalty: string
}

export interface VammUpdatedEvent extends BaseEvent {
  eventType: 'VammUpdated'
  newVamm: string
}

// Factory Events
export interface MarketCreatedEvent extends BaseEvent {
  eventType: 'MarketCreated'
  marketId: string
  symbol: string
  vamm: string
  vault: string
  oracle: string
  collateralToken: string
}

export interface MarketStatusChangedEvent extends BaseEvent {
  eventType: 'MarketStatusChanged'
  marketId: string
  isActive: boolean
}

export interface DeploymentFeeUpdatedEvent extends BaseEvent {
  eventType: 'DeploymentFeeUpdated'
  newFee: string
}

// Oracle Events
export interface PriceUpdatedEvent extends BaseEvent {
  eventType: 'PriceUpdated'
  newPrice: string
}

export interface OracleStatusChangedEvent extends BaseEvent {
  eventType: 'OracleStatusChanged'
  active: boolean
}

export interface MaxPriceAgeUpdatedEvent extends BaseEvent {
  eventType: 'MaxPriceAgeUpdated'
  newAge: string
}

// Control Events
export interface AuthorizedAddedEvent extends BaseEvent {
  eventType: 'AuthorizedAdded'
  account: string
}

export interface AuthorizedRemovedEvent extends BaseEvent {
  eventType: 'AuthorizedRemoved'
  account: string
}

export interface PausedEvent extends BaseEvent {
  eventType: 'Paused'
}

export interface UnpausedEvent extends BaseEvent {
  eventType: 'Unpaused'
}

export interface OwnershipTransferredEvent extends BaseEvent {
  eventType: 'OwnershipTransferred'
  previousOwner: string
  newOwner: string
}

// Token Events
export interface TransferEvent extends BaseEvent {
  eventType: 'Transfer'
  from: string
  to: string
  value: string
}

export interface ApprovalEvent extends BaseEvent {
  eventType: 'Approval'
  owner: string
  spender: string
  value: string
}

export interface MintEvent extends BaseEvent {
  eventType: 'Mint'
  to: string
  value: string
}

// Union type for all events
export type SmartContractEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PositionIncreasedEvent
  | FundingUpdatedEvent
  | FundingPaidEvent
  | PositionLiquidatedEvent
  | TradingFeeCollectedEvent
  | ParametersUpdatedEvent
  | VirtualReservesUpdatedEvent
  | CollateralDepositedEvent
  | CollateralWithdrawnEvent
  | MarginReservedEvent
  | MarginReleasedEvent
  | PnLUpdatedEvent
  | FundingAppliedEvent
  | UserLiquidatedEvent
  | VammUpdatedEvent
  | MarketCreatedEvent
  | MarketStatusChangedEvent
  | DeploymentFeeUpdatedEvent
  | PriceUpdatedEvent
  | OracleStatusChangedEvent
  | MaxPriceAgeUpdatedEvent
  | AuthorizedAddedEvent
  | AuthorizedRemovedEvent
  | PausedEvent
  | UnpausedEvent
  | OwnershipTransferredEvent
  | TransferEvent
  | ApprovalEvent
  | MintEvent

// Event listener configuration
export interface ContractConfig {
  address: string
  abi: Record<string, unknown>[]
  startBlock?: number
  name: string
  type: 'vAMM' | 'Vault' | 'Factory' | 'Oracle' | 'Token'
}

export interface EventListenerConfig {
  rpcUrl: string
  wsRpcUrl?: string
  contracts: ContractConfig[]
  batchSize: number
  confirmations: number
  retryAttempts: number
  retryDelay: number
}

// Event subscription data
export interface EventSubscription {
  id: string
  contractAddress: string
  eventName: string
  userAddress?: string
  isActive: boolean
  createdAt: Date
  webhookUrl?: string
}

// Event filter options
export interface EventFilter {
  contractAddress?: string
  eventType?: string
  eventTypes?: string[]
  userAddress?: string
  fromBlock?: number
  toBlock?: number
  limit?: number
  offset?: number
}

// Real-time event data for WebSocket
export interface RealtimeEventData {
  event: SmartContractEvent
  subscription?: EventSubscription
} 