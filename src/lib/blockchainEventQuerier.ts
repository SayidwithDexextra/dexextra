import { ethers } from 'ethers';
import { SmartContractEvent, PositionOpenedEvent, PositionClosedEvent, PositionLiquidatedEvent } from '@/types/events';
import { env } from '@/lib/env';
import { NETWORKS, getNetworkByChainId } from '@/lib/networks';
import { withRateLimit, delay } from '@/lib/rateLimiter';

// vAMM ABI for events (Updated for Bonding Curve)
const VAMM_ABI = [
  // Position events (updated with positionId)
  "event PositionOpened(address indexed user, uint256 indexed positionId, bool isLong, uint256 size, uint256 price, uint256 leverage, uint256 fee)",
  "event PositionClosed(address indexed user, uint256 indexed positionId, uint256 size, uint256 price, int256 pnl, uint256 fee)",
  "event PositionIncreased(address indexed user, uint256 indexed positionId, uint256 sizeAdded, uint256 newSize, uint256 newEntryPrice, uint256 fee)",
  "event PositionLiquidated(address indexed user, uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 price, uint256 fee)",
  
  // Funding events
  "event FundingUpdated(int256 fundingRate, uint256 fundingIndex, int256 premiumFraction)",
  "event FundingPaid(address indexed user, uint256 indexed positionId, int256 amount, uint256 fundingIndex)",
  
  // Trading and fee events
  "event TradingFeeCollected(address indexed user, uint256 amount)",
  
  // Administrative events
  "event ParametersUpdated(string parameter, uint256 newValue)",
  "event AuthorizedAdded(address indexed account)",
  "event AuthorizedRemoved(address indexed account)",
  "event Paused()",
  "event Unpaused()",
  
  // Bonding curve events
  "event BondingCurveUpdated(uint256 newPrice, uint256 totalSupply, uint256 priceChange)",
  
  // Legacy compatibility events
  "event VirtualReservesUpdated(uint256 baseReserves, uint256 quoteReserves, uint256 multiplier)"
];

// Vault ABI for events
const VAULT_ABI = [
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event CollateralWithdrawn(address indexed user, uint256 amount)",
  "event MarginReserved(address indexed user, uint256 amount)",
  "event MarginReleased(address indexed user, uint256 amount)",
  "event PnLUpdated(address indexed user, int256 pnlDelta)",
  "event FundingApplied(address indexed user, int256 fundingPayment, uint256 fundingIndex)",
  "event UserLiquidated(address indexed user, uint256 penalty)"
];

export interface BlockchainEventFilter {
  contractAddress: string;
  eventTypes?: string[];
  userAddress?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  maxBlockRange?: number;
}

export interface QueryResult {
  events: SmartContractEvent[];
  fromBlock: number;
  toBlock: number;
  totalLogs: number;
  queryTime: number;
  error?: string;
}

export class BlockchainEventQuerier {
  private provider: ethers.JsonRpcProvider;
  private chainId: number;
  private maxRetries: number = 3;
  private retryDelay: number = 2000;
  private maxBlockRange: number = 400;

  constructor(rpcUrl?: string, chainId?: number) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl || env.RPC_URL);
    this.chainId = chainId || env.CHAIN_ID;
  }

  /**
   * Query events from a vAMM contract
   */
  async queryVAMMEvents(filter: BlockchainEventFilter): Promise<QueryResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔍 Querying vAMM events:', filter);

      // Validate contract address
      if (!ethers.isAddress(filter.contractAddress)) {
        throw new Error('Invalid contract address');
      }

      // Get current block number with rate limiting
      const currentBlock = await withRateLimit(() => this.provider.getBlockNumber());
      
      // Determine block range
      const fromBlock = filter.fromBlock || Math.max(0, currentBlock - this.maxBlockRange);
      const toBlock = filter.toBlock || currentBlock;
      
      // Validate block range
      if (fromBlock > toBlock) {
        throw new Error('fromBlock cannot be greater than toBlock');
      }

      // Query events in batches if range is too large
      const events = await this.queryEventsInBatches(filter, fromBlock, toBlock);
      
      const queryTime = Date.now() - startTime;
      console.log(`✅ Query completed in ${queryTime}ms, found ${events.length} events`);

      console.log(events)

      return {
        events,
        fromBlock,
        toBlock,
        totalLogs: events.length,
        queryTime
      };

    } catch (error) {
      const queryTime = Date.now() - startTime;
      console.error('❌ Query failed:', error);
      
      return {
        events: [],
        fromBlock: filter.fromBlock || 0,
        toBlock: filter.toBlock || 0,
        totalLogs: 0,
        queryTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Query events in batches to avoid RPC limits
   */
  private async queryEventsInBatches(
    filter: BlockchainEventFilter,
    fromBlock: number,
    toBlock: number
  ): Promise<SmartContractEvent[]> {
    const batchSize = filter.maxBlockRange || this.maxBlockRange;
    const allEvents: SmartContractEvent[] = [];

    for (let start = fromBlock; start <= toBlock; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toBlock);
      
      try {
        const batchEvents = await this.queryEventsBatch(filter, start, end);
        allEvents.push(...batchEvents);
        
        console.log(`📦 Processed blocks ${start}-${end}: ${batchEvents.length} events`);
        
        // Increased delay to avoid rate limiting
        if (end < toBlock) {
          await delay(500); // Increased from 100ms to 500ms
        }
      } catch (error) {
        console.error(`❌ Failed to query batch ${start}-${end}:`, error);
        // Continue with next batch instead of failing entirely
      }
    }

    // Sort by block number and log index (most recent first)
    allEvents.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return b.blockNumber - a.blockNumber;
      }
      return b.logIndex - a.logIndex;
    });

    // Apply limit
    if (filter.limit && allEvents.length > filter.limit) {
      return allEvents.slice(0, filter.limit);
    }

    return allEvents;
  }

  /**
   * Query a single batch of events
   */
  private async queryEventsBatch(
    filter: BlockchainEventFilter,
    fromBlock: number,
    toBlock: number
  ): Promise<SmartContractEvent[]> {
    const contract = new ethers.Contract(filter.contractAddress, VAMM_ABI, this.provider);
    const events: SmartContractEvent[] = [];

    // Build event filter
    const eventFilter = {
      address: filter.contractAddress,
      fromBlock,
      toBlock,
    };

    // Query logs with retry logic and rate limiting
    const logs = await withRateLimit(() => this.getLogs(eventFilter));
    
    // Process each log
    for (const log of logs) {
      try {
        const parsedLog = contract.interface.parseLog({
          topics: log.topics,
          data: log.data
        });

        if (parsedLog) {
          // Filter by event type if specified
          if (filter.eventTypes && !filter.eventTypes.includes(parsedLog.name)) {
            continue;
          }

          // Filter by user address if specified
          if (filter.userAddress && parsedLog.args.user && 
              parsedLog.args.user.toLowerCase() !== filter.userAddress.toLowerCase()) {
            continue;
          }

          const event = await this.formatEvent(parsedLog, log);
          if (event) {
            events.push(event);
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse log:', parseError);
        // Continue processing other logs
      }
    }

    return events;
  }

  /**
   * Get logs with retry logic
   */
  private async getLogs(filter: any): Promise<ethers.Log[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const logs = await this.provider.getLogs(filter);
        return logs;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${attempt} failed:`, error);
        
        // Check if this is a block range limit error
        if (this.isBlockRangeLimitError(error)) {
          console.warn('🚨 Block range limit exceeded. Consider reducing batch size.');
          throw new Error(`Block range limit exceeded. Current range: ${filter.fromBlock} to ${filter.toBlock}. Try reducing the batch size to 400 or less.`);
        }
        
        if (attempt < this.maxRetries) {
          await delay(this.retryDelay * attempt);
        }
      }
    }

    throw lastError || new Error('Failed to get logs after retries');
  }

  private isBlockRangeLimitError(error: any): boolean {
    const errorMessage = error?.message || error?.reason || '';
    const errorCode = error?.code;
    
    // Check for common block range limit error patterns
    return (
      errorCode === -32600 ||
      errorCode === 'UNKNOWN_ERROR' ||
      errorMessage.includes('block range') ||
      errorMessage.includes('500 block') ||
      errorMessage.includes('eth_getLogs') ||
      errorMessage.includes('range should work')
    );
  }

  /**
   * Format raw event log into SmartContractEvent
   */
  private async formatEvent(
    parsedLog: ethers.LogDescription,
    log: ethers.Log
  ): Promise<SmartContractEvent | null> {
    try {
      // Get block details with rate limiting
      const block = await withRateLimit(() => this.provider.getBlock(log.blockNumber));
      if (!block) {
        console.warn(`Block not found for log at block ${log.blockNumber}`);
        return null;
      }

      const baseEvent = {
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: log.index, // Use log.index instead of log.logIndex for ethers v6
        contractAddress: log.address,
        timestamp: new Date(Number(block.timestamp) * 1000),
        chainId: this.chainId
      };

      // Format event based on type
      switch (parsedLog.name) {
        case 'PositionOpened':
          return {
            ...baseEvent,
            eventType: 'PositionOpened',
            user: parsedLog.args.user,
            isLong: parsedLog.args.isLong,
            size: parsedLog.args.size.toString(),
            price: parsedLog.args.price.toString(),
            leverage: parsedLog.args.leverage.toString(),
            fee: parsedLog.args.fee.toString()
          } as PositionOpenedEvent;

        case 'PositionClosed':
          return {
            ...baseEvent,
            eventType: 'PositionClosed',
            user: parsedLog.args.user,
            size: parsedLog.args.size.toString(),
            price: parsedLog.args.price.toString(),
            pnl: parsedLog.args.pnl.toString(),
            fee: parsedLog.args.fee.toString()
          } as PositionClosedEvent;

        case 'PositionLiquidated':
          return {
            ...baseEvent,
            eventType: 'PositionLiquidated',
            user: parsedLog.args.user,
            liquidator: parsedLog.args.liquidator,
            size: parsedLog.args.size.toString(),
            price: parsedLog.args.price.toString(),
            fee: parsedLog.args.fee.toString()
          } as PositionLiquidatedEvent;

        case 'FundingUpdated':
          return {
            ...baseEvent,
            eventType: 'FundingUpdated',
            fundingRate: parsedLog.args.fundingRate.toString(),
            fundingIndex: parsedLog.args.fundingIndex.toString(),
            premiumFraction: parsedLog.args.premiumFraction.toString()
          };

        case 'FundingPaid':
          return {
            ...baseEvent,
            eventType: 'FundingPaid',
            user: parsedLog.args.user,
            amount: parsedLog.args.amount.toString(),
            positionId: parsedLog.args.positionId.toString(),
            fundingIndex: parsedLog.args.fundingIndex.toString()
          };

        case 'TradingFeeCollected':
          return {
            ...baseEvent,
            eventType: 'TradingFeeCollected',
            user: parsedLog.args.user,
            amount: parsedLog.args.amount.toString()
          };

        case 'CollateralDeposited':
          return {
            ...baseEvent,
            eventType: 'CollateralDeposited',
            user: parsedLog.args.user,
            amount: parsedLog.args.amount.toString()
          };

        case 'CollateralWithdrawn':
          return {
            ...baseEvent,
            eventType: 'CollateralWithdrawn',
            user: parsedLog.args.user,
            amount: parsedLog.args.amount.toString()
          };

        default:
          console.warn(`Unknown event type: ${parsedLog.name}`);
          return null;
      }
    } catch (error) {
      console.error('Error formatting event:', error);
      return null;
    }
  }

  /**
   * Test connection to the blockchain
   */
  async testConnection(): Promise<{
    connected: boolean;
    chainId: number;
    blockNumber: number;
    networkName: string;
    responseTime: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const [network, blockNumber] = await Promise.all([
        withRateLimit(() => this.provider.getNetwork()),
        withRateLimit(() => this.provider.getBlockNumber())
      ]);

      const responseTime = Date.now() - startTime;
      const networkConfig = getNetworkByChainId(Number(network.chainId));

      return {
        connected: true,
        chainId: Number(network.chainId),
        blockNumber,
        networkName: networkConfig?.displayName || network.name || 'Unknown',
        responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        connected: false,
        chainId: 0,
        blockNumber: 0,
        networkName: 'Unknown',
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the current block number
   */
  async getCurrentBlock(): Promise<number> {
    return await withRateLimit(() => this.provider.getBlockNumber());
  }

  /**
   * Switch to a different RPC provider
   */
  switchProvider(rpcUrl: string, chainId?: number): void {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    if (chainId) {
      this.chainId = chainId;
    }
  }


}

// Factory function to create querier instances
export function createBlockchainQuerier(rpcUrl?: string, chainId?: number): BlockchainEventQuerier {
  return new BlockchainEventQuerier(rpcUrl, chainId);
}

// Singleton instance for default network
let defaultQuerier: BlockchainEventQuerier | null = null;

export function getDefaultBlockchainQuerier(): BlockchainEventQuerier {
  if (!defaultQuerier) {
    defaultQuerier = new BlockchainEventQuerier();
  }
  return defaultQuerier;
}

// Export utility function for direct usage
export async function queryVAMMEvents(
  contractAddress: string,
  options: Partial<BlockchainEventFilter> = {}
): Promise<QueryResult> {
  const querier = getDefaultBlockchainQuerier();
  return await querier.queryVAMMEvents({
    contractAddress,
    ...options
  });
} 