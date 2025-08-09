/*
 * ⚠️ LEGACY CONTRACT MONITORING SYSTEM ⚠️
 * 
 * This file contains the old polling-based blockchain event querier that is NOT compatible 
 * with Vercel deployment due to heavy RPC usage and rate limiting issues.
 * 
 * ✅ NEW SYSTEM: Events are now delivered via Alchemy Notify API webhooks
 * 
 * This legacy system has been replaced by the webhook-based event system:
 * - Events are delivered in real-time via webhooks to /api/webhooks/alchemy
 * - No more manual querying or batch processing needed
 * - Automatic retry handling by Alchemy infrastructure
 * - Full Vercel serverless compatibility
 * 
 * This file is kept for reference and migration purposes only.
 */

// Try to import ethers with better error handling
let ethers: any;
try {
  ethers = require('ethers');
} catch (error) {
  console.warn('⚠️ Ethers.js not available - BlockchainEventQuerier will be disabled');
  ethers = null;
}
import { SmartContractEvent, PositionOpenedEvent, PositionClosedEvent, PositionLiquidatedEvent } from '@/types/events';
import { env } from '@/lib/env';
import { NETWORKS, getNetworkByChainId } from '@/lib/networks';
import { withRateLimit, delay } from '@/lib/rateLimiter';
import { METRIC_VAMM_ROUTER_ABI, CENTRALIZED_VAULT_ABI } from '@/lib/contracts';

// V2 ABI mappings for legacy compatibility
const VAMM_ABI = METRIC_VAMM_ROUTER_ABI; // V2 router handles VAMM operations
const VAULT_ABI = CENTRALIZED_VAULT_ABI; // V2 centralized vault

// ABIs are now imported from centralized contracts configuration

// Legacy ABI definitions removed - using centralized configuration instead

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
  private provider: any;
  private chainId: number;
  private maxRetries: number = 3;
  private retryDelay: number = 2000;
  private maxBlockRange: number = 50; // Aggressive reduction for Alchemy limits
  private minBlockRange: number = 10; // Very small minimum batch size
  private isAvailable: boolean;

  constructor(rpcUrl?: string, chainId?: number) {
    if (!ethers) {
      console.warn('⚠️ BlockchainEventQuerier: Ethers.js not available');
      this.isAvailable = false;
      this.provider = null;
      this.chainId = chainId || env.CHAIN_ID;
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl || env.RPC_URL);
      this.chainId = chainId || env.CHAIN_ID;
      this.isAvailable = true;
    } catch (error) {
      console.error('❌ Failed to initialize BlockchainEventQuerier:', error);
      this.isAvailable = false;
      this.provider = null;
      this.chainId = chainId || env.CHAIN_ID;
    }
  }

  /**
   * Query events from a vAMM contract
   */
  async queryVAMMEvents(filter: BlockchainEventFilter): Promise<QueryResult> {
    const startTime = Date.now();
    
    // Check if ethers is available
    if (!this.isAvailable || !this.provider) {
      return {
        events: [],
        fromBlock: filter.fromBlock || 0,
        toBlock: filter.toBlock || 0,
        totalLogs: 0,
        queryTime: Date.now() - startTime,
        error: 'BlockchainEventQuerier not available - ethers.js missing or failed to initialize'
      };
    }
    
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
    let batchSize = filter.maxBlockRange || this.maxBlockRange;
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
        
        // If it's a block range limit error, try with smaller batch size
        if (this.isBlockRangeLimitError(error) && batchSize > this.minBlockRange) {
          const newBatchSize = Math.max(this.minBlockRange, Math.floor(batchSize / 2));
          console.warn(`🔄 Block range limit hit for range ${start}-${end}. Reducing batch size from ${batchSize} to ${newBatchSize}`);
          batchSize = newBatchSize;
          
          // Retry this batch with smaller size
          start -= batchSize; // Reset to retry this range
          continue;
        }
        
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
          console.warn('🚨 Block range limit exceeded:', {
            fromBlock: filter.fromBlock,
            toBlock: filter.toBlock,
            range: filter.toBlock - filter.fromBlock,
            errorCode: error?.code,
            nestedErrorCode: error?.error?.code,
            message: error?.message || error?.error?.message
          });
          // Don't throw immediately - let the caller handle it with smaller batches
          throw error;
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
    
    // Check for nested error in coalesced errors (Alchemy format)
    const nestedError = error?.error;
    const nestedErrorCode = nestedError?.code;
    const nestedErrorMessage = nestedError?.message || '';
    
    // Check for common block range limit error patterns
    return (
      // Standard error codes
      errorCode === -32600 ||
      errorCode === -32602 ||
      errorCode === -32005 ||
      errorCode === -32062 || // Alchemy specific
      errorCode === 'UNKNOWN_ERROR' ||
      
      // Nested error codes (for coalesced errors)
      nestedErrorCode === -32062 ||
      nestedErrorCode === -32600 ||
      nestedErrorCode === -32602 ||
      nestedErrorCode === -32005 ||
      
      // Error message patterns
      errorMessage.includes('block range') ||
      errorMessage.includes('Block range is too large') ||
      errorMessage.includes('500 block') ||
      errorMessage.includes('400 block') ||
      errorMessage.includes('range limit') ||
      errorMessage.includes('too many blocks') ||
      errorMessage.includes('exceeds maximum') ||
      errorMessage.includes('eth_getLogs') ||
      errorMessage.includes('range should work') ||
      errorMessage.includes('query returned more than') ||
      errorMessage.includes('limit exceeded') ||
      errorMessage.includes('could not coalesce error') ||
      
      // Nested error message patterns
      nestedErrorMessage.includes('block range') ||
      nestedErrorMessage.includes('Block range is too large') ||
      nestedErrorMessage.includes('range limit') ||
      nestedErrorMessage.includes('too many blocks')
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