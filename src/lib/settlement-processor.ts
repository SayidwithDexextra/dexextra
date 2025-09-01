import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { createWalletClient, createPublicClient, http, formatUnits } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getSettlementPrivateKey, debugEnvironment } from '@/lib/runtime-env-loader';

// Import contract ABIs for settlement operations
import { CONTRACTS } from '@/lib/contracts';

/**
 * SETTLEMENT PROCESSOR - What it actually does:
 * 
 * This processor handles the settlement of OFF-CHAIN MATCHED TRADES, not placing new orders.
 * 
 * Flow:
 * 1. Orders are placed via API → stored in `off_chain_orders` table
 * 2. Orders are matched via ServerlessMatchingEngine → stored in `trade_matches` table (PENDING)
 * 3. SettlementProcessor processes PENDING trades:
 *    - Groups trades into settlement batches
 *    - Records settlement on blockchain (transaction to CentralVault)
 *    - Updates trade status to SETTLED
 *    - Updates user positions and P&L
 * 
 * We are NOT placing new orders via OrderRouter - we are settling already matched trades.
 */

// Global BigInt serializer to prevent JSON.stringify errors
(BigInt.prototype as any).toJSON = function() {
  return this.toString() + 'n';
};

export interface SettlementBatch {
  id: string;
  batch_id: string;
  trade_count: number;
  priority: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RETRYING';
  estimated_gas?: number;
  gas_price?: string;
  merkle_root?: string;
  transaction_hash?: string;
  block_number?: number;
  retry_count: number;
  error_message?: string;
  created_at: string;
  processed_at?: string;
  updated_at: string;
}

export interface SettlementQueueItem {
  id: string;
  batch_id: string;
  sequence_number: number;
  priority: number;
  settlement_type: 'TRADE_SETTLEMENT' | 'COLLATERAL_ADJUSTMENT' | 'LIQUIDATION' | 'MARKET_SETTLEMENT' | 'EMERGENCY_WITHDRAWAL';
  trade_match_ids: string[];
  market_id?: string;
  affected_traders: string[];
  settlement_data: any;
  estimated_gas?: number;
  gas_price_gwei?: number;
  estimated_cost_usd?: number;
  status: 'QUEUED' | 'PROCESSING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'RETRY_PENDING';
  attempts: number;
  max_attempts: number;
  retry_after?: string;
  transaction_hash?: string;
  block_number?: number;
  gas_used?: number;
  actual_gas_price?: number;
  last_error?: string;
  error_count: number;
  queue_time_ms?: number;
  processing_time_ms?: number;
  confirmation_time_ms?: number;
  created_at: string;
  updated_at: string;
  processing_started_at?: string;
  submitted_at?: string;
  confirmed_at?: string;
  failed_at?: string;
}

export class SettlementProcessor {
  private supabase: any;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for settlement processor');
    }
    this.supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    this.validateSettlementConfiguration();
  }

  /**
   * Validate settlement configuration on startup
   */
  private validateSettlementConfiguration() {
    console.log(`🏗️  Settlement Processor Configuration Check:`);
    console.log(`  - Supabase URL: ${env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 20)}...`);
    console.log(`  - Service Role Key: ${!!env.SUPABASE_SERVICE_ROLE_KEY}`);
    
    // Use bulletproof environment loading for validation too
    debugEnvironment();
    const settlementPrivateKey = getSettlementPrivateKey();
    
    console.log(`  - Settlement Private Key (bulletproof): ${!!settlementPrivateKey}`);
    console.log(`  - RPC URL: ${env.RPC_URL}`);
    console.log(`  - Chain ID: ${env.CHAIN_ID}`);
    
    if (settlementPrivateKey) {
      const isValidFormat = settlementPrivateKey.startsWith('0x') && settlementPrivateKey.length === 66;
      console.log(`  - Private Key Format Valid: ${isValidFormat}`);
      if (!isValidFormat) {
        console.error(`❌ Invalid SETTLEMENT_PRIVATE_KEY format. Expected 0x + 64 hex chars, got ${settlementPrivateKey.length} chars`);
      } else {
        // Test wallet connectivity with bulletproof key
        this.testWalletConnectivity(settlementPrivateKey);
      }
    } else {
      console.error(`❌ SETTLEMENT_PRIVATE_KEY not configured - settlement processor cannot operate without a valid private key`);
      throw new Error('SETTLEMENT_PRIVATE_KEY is required for settlement processor operation');
    }
  }

  /**
   * Test wallet connectivity and log wallet address
   */
  private async testWalletConnectivity(privateKey?: string) {
    try {
      const keyToUse = privateKey || getSettlementPrivateKey();
      if (keyToUse) {
        const account = privateKeyToAccount(keyToUse as `0x${string}`);
        console.log(`💼 Settlement Wallet Address: ${account.address}`);
        
        const client = createWalletClient({
          account,
          chain: polygon,
          transport: http(env.RPC_URL)
        });
        
        console.log(`✅ Wallet client created successfully for settlement processing`);
      }
    } catch (error) {
      console.error(`❌ Failed to create settlement wallet:`, error);
    }
  }

  /**
   * Start the settlement processor - polls for pending trade matches and creates settlement batches
   */
  public start(intervalMs: number = 30000): void {
    if (this.processingInterval) {
      console.log('⚠️ Settlement processor already running');
      return;
    }

    console.log('🚀 Starting settlement processor...');
    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing) {
        this.isProcessing = true;
        try {
          await this.processSettlement();
        } catch (error) {
          console.error('❌ Settlement processing error:', error);
        } finally {
          this.isProcessing = false;
        }
      }
    }, intervalMs);

    // Process immediately on start
    setTimeout(() => this.processSettlement(), 1000);
  }

  /**
   * Stop the settlement processor
   */
  public stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('🛑 Settlement processor stopped');
    }
  }

  /**
   * Main settlement processing logic - now public for manual triggering
   */
  public async processSettlement(): Promise<void> {
    try {
    //   console.log('🔄 Processing settlement queue...');

      // Ensure Supabase client is properly initialized
      if (!this.supabase) {
        console.log('🔄 Recreating Supabase client...');
        this.supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
      }

      // Step 0: Check for retroactive matching opportunities
      await this.checkRetroactiveMatching();

      // Step 1: Find pending trade matches with retry logic
      let pendingMatches, matchesError;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          const result = await this.supabase
            .from('trade_matches')
            .select('*')
            .eq('settlement_status', 'PENDING')
            .order('matched_at', { ascending: true })
            .limit(50); // Process in batches

          pendingMatches = result.data;
          matchesError = result.error;
          break; // Success, exit retry loop
        } catch (fetchError) {
          retryCount++;
          console.log(`⚠️ Supabase query failed (attempt ${retryCount}/${maxRetries}):`, fetchError);
          
          if (retryCount >= maxRetries) {
            throw new Error(`Failed to fetch pending matches after ${maxRetries} attempts: ${fetchError}`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          
                  // Recreate client on retry
        console.log('🔄 Recreating Supabase client for retry...');
        this.supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
        }
      }

      if (matchesError) {
        throw new Error(`Failed to fetch pending matches: ${matchesError.message}`);
      }

      if (!pendingMatches || pendingMatches.length === 0) {
        // console.log('✅ No pending trade matches found');
        return;
      }

      console.log(`📊 Found ${pendingMatches.length} pending trade matches`);

      // Step 2: Group matches by market for efficient settlement
      const matchesByMarket = this.groupMatchesByMarket(pendingMatches);

      // Step 3: Create settlement batches for each market
      for (const [marketId, matches] of Object.entries(matchesByMarket)) {
        await this.createSettlementBatch(marketId, matches);
      }

      // Step 4: Process settlement queue items
      await this.processSettlementQueue();

    } catch (error) {
      console.error('❌ Settlement processing failed:', error);
    }
  }

  /**
   * Group trade matches by market ID for efficient batching
   */
  private groupMatchesByMarket(matches: any[]): Record<string, any[]> {
    return matches.reduce((groups, match) => {
      const marketId = match.market_id;
      if (!groups[marketId]) {
        groups[marketId] = [];
      }
      groups[marketId].push(match);
      return groups;
    }, {} as Record<string, any[]>);
  }

  /**
   * Create a settlement batch for trade matches
   */
  private async createSettlementBatch(marketId: string, matches: any[]): Promise<void> {
    try {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`📦 Creating settlement batch ${batchId} for market ${marketId} with ${matches.length} matches`);

      // Calculate estimated gas and costs
      const estimatedGas = BigInt(matches.length * 150000); // ~150k gas per trade settlement
      const gasPriceGwei = 20; // Conservative gas price
      const estimatedCostUsd = Number(estimatedGas * BigInt(gasPriceGwei)) * 0.000000001 * 2000; // Assuming ETH = $2000

      // Create settlement batch record
      const { data: batch, error: batchError } = await this.supabase
        .from('settlement_batches')
        .insert({
          batch_id: batchId,
          trade_count: matches.length,
          priority: 2, // Normal priority
          status: 'PENDING',
          estimated_gas: Number(estimatedGas),
          gas_price: gasPriceGwei.toString(),
          retry_count: 0
        })
        .select()
        .single();

      if (batchError) {
        throw new Error(`Failed to create settlement batch: ${batchError.message}`);
      }

      // Create settlement queue item
      const { error: queueError } = await this.supabase
        .from('settlement_queue')
        .insert({
          batch_id: batch.id, // Use the UUID from the batch record, not the string batchId
          sequence_number: 1,
          priority: 2,
          settlement_type: 'TRADE_SETTLEMENT',
          trade_match_ids: matches.map(m => m.id),
          market_id: marketId,
          affected_traders: [...new Set([...matches.map(m => m.buy_trader_wallet_address), ...matches.map(m => m.sell_trader_wallet_address)])],
          settlement_data: {
            trades: matches.map(m => ({
              matchId: m.match_id,
              buyOrderId: m.buy_order_id,
              sellOrderId: m.sell_order_id,
              tradePrice: m.trade_price,
              tradeQuantity: m.trade_quantity,
              buyTrader: m.buy_trader_wallet_address,
              sellTrader: m.sell_trader_wallet_address
            }))
          },
          estimated_gas: Number(estimatedGas),
          gas_price_gwei: gasPriceGwei,
          estimated_cost_usd: estimatedCostUsd,
          status: 'QUEUED',
          attempts: 0,
          max_attempts: 3,
          error_count: 0
        });

      if (queueError) {
        throw new Error(`Failed to create settlement queue item: ${queueError.message}`);
      }

      // Update trade matches to point to this batch
      const { error: updateError } = await this.supabase
        .from('trade_matches')
        .update({
          settlement_status: 'SETTLING',
          settlement_batch_id: batch.id,
          settlement_requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .in('id', matches.map(m => m.id));

      if (updateError) {
        throw new Error(`Failed to update trade matches: ${updateError.message}`);
      }

      console.log(`✅ Settlement batch ${batchId} created with ${matches.length} trade matches`);

    } catch (error) {
      console.error(`❌ Failed to create settlement batch for market ${marketId}:`, error);
    }
  }

  /**
   * Process settlement queue items - submit to blockchain
   */
  private async processSettlementQueue(): Promise<void> {
    console.log("🚨 DEBUG: processSettlementQueue function HAS BEEN CALLED!");
    
    try {
      // Get queued settlement items with comprehensive debugging
      console.log(`🚨 DEBUG: Querying settlement_queue table for QUEUED items...`);
      
      const { data: queueItems, error: queueError } = await this.supabase
        .from('settlement_queue')
        .select('*')
        .eq('status', 'QUEUED')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(10);

      console.log(`🚨 DEBUG: Settlement queue query result: ${queueItems?.length || 0} items, error: ${queueError?.message || "None"}`);
      
      if (queueItems && queueItems.length > 0) {
        console.log(`🚨 DEBUG: Queue items details:`, queueItems.map((item: any) => ({
          id: item.id,
          batch_id: item.batch_id,
          status: item.status,
          settlement_type: item.settlement_type,
          trade_match_ids: item.trade_match_ids,
          market_id: item.market_id,
          attempts: item.attempts,
          max_attempts: item.max_attempts,
          created_at: item.created_at
        })));
      }

      if (queueError) {
        console.error(`❌ Settlement queue query error:`, queueError);
        throw new Error(`Failed to fetch settlement queue: ${queueError.message}`);
      }

      if (!queueItems || queueItems.length === 0) {
        console.log('✅ No queued settlement items found');
        console.log('🚨 DEBUG: This is why submitToBlockchain is not called - no QUEUED items');
        
        // Check if there are items in other statuses for debugging
        const { data: allItems, error: allError } = await this.supabase
          .from('settlement_queue')
          .select('status')
          .limit(100);
          
        if (!allError && allItems) {
          const statusCounts = allItems.reduce((acc: any, item: any) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
          }, {});
          console.log(`🚨 DEBUG: Settlement queue status breakdown:`, statusCounts);
        }
        
        return;
      }

      console.log(`🚀 Processing ${queueItems.length} settlement queue items`);
      console.log(`🚨 DEBUG: About to process ${queueItems.length} items`);

      for (const item of queueItems) {
        console.log(`🚨 DEBUG: Processing item ${item.id} with status ${item.status}`);
        console.log(`🚨 DEBUG: Item details:`, {
          id: item.id,
          batch_id: item.batch_id,
          settlement_type: item.settlement_type,
          attempts: item.attempts,
          max_attempts: item.max_attempts,
          trade_match_ids_count: item.trade_match_ids?.length || 0,
          settlement_data_trades_count: item.settlement_data?.trades?.length || 0
        });
        
        try {
          await this.processSettlementItem(item);
          console.log(`✅ Successfully processed settlement item ${item.id}`);
        } catch (itemError) {
          console.error(`❌ Failed to process settlement item ${item.id}:`, itemError);
          console.error(`🚨 DEBUG: Item processing error details:`, {
            message: itemError instanceof Error ? itemError.message : 'Unknown error',
            stack: itemError instanceof Error ? itemError.stack : 'No stack trace',
            itemId: item.id,
            batchId: item.batch_id
          });
          // Continue processing other items even if one fails
        }
      }

    } catch (error) {
      console.error('❌ Failed to process settlement queue:', error);
      console.error(`🚨 DEBUG: Settlement queue processing error details:`, {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
    }
  }

  /**
   * Process a single settlement queue item
   */
  private async processSettlementItem(item: SettlementQueueItem): Promise<void> {
    console.log("🚨 DEBUG: processSettlementItem function HAS BEEN CALLED!");
    console.log(`🚨 DEBUG: Item ID: ${item.id}`);
    console.log(`🚨 DEBUG: Item status: ${item.status}`);
    
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Processing settlement item ${item.id} (batch: ${item.batch_id})`);

      // Update status to processing
      await this.updateSettlementStatus(item.id, 'PROCESSING', { processing_started_at: new Date().toISOString() });

      // Submit to blockchain - live transactions only
      console.log("🔄 HIIIII: Submitting settlement to blockchain...");
      const result = await this.submitToBlockchain(item);

      if (result.success) {
        // Update queue item status to submitted
        await this.updateSettlementStatus(item.id, 'SUBMITTED', {
          transaction_hash: result.txHash,
          submitted_at: new Date().toISOString(),
          processing_time_ms: Date.now() - startTime
        });

        // Mark trade matches as settled
        {
          const { error: tmError, data: tmData } = await this.supabase
            .from('trade_matches')
            .update({
              settlement_status: 'SETTLED',
              settlement_transaction_hash: result.txHash,
              settled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .in('id', item.trade_match_ids)
            .select('id, settlement_status');
          if (tmError) {
            console.error('❌ Failed to mark trade_matches as SETTLED:', tmError);
          } else {
            console.log(`✅ trade_matches updated to SETTLED: ${Array.isArray(tmData) ? tmData.length : 0} rows`);
          }
        }

        // Mark settlement batch as completed for observability
        {
          const { error: batchErr } = await this.supabase
            .from('settlement_batches')
            .update({
              status: 'COMPLETED',
              transaction_hash: result.txHash,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', item.batch_id);
          if (batchErr) {
            console.warn('⚠️ Failed to mark settlement batch COMPLETED:', batchErr.message);
          } else {
            console.log('✅ Settlement batch marked COMPLETED');
          }
        }

        // Update market's last trade price with the most recent trade
        const trades = item.settlement_data.trades;
        if (trades && trades.length > 0) {
          // Use the latest trade price (trades are processed in order)
          const latestTrade = trades[trades.length - 1];
          console.log(`📊 Updating market last_trade_price to $${latestTrade.tradePrice}`);
          
          await this.supabase
            .from('orderbook_markets')
            .update({
              last_trade_price: latestTrade.tradePrice,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.market_id);
            
          console.log(`✅ Market price updated to $${latestTrade.tradePrice}`);
        }

        console.log(`✅ Settlement item ${item.id} submitted to blockchain: ${result.txHash}`);

      } else {
        // Handle failure
        const newAttempts = item.attempts + 1;
        const shouldRetry = newAttempts < item.max_attempts;

        if (shouldRetry) {
          const retryAfter = new Date(Date.now() + (newAttempts * 60000)); // Exponential backoff
          await this.updateSettlementStatus(item.id, 'RETRY_PENDING', {
            attempts: newAttempts,
            retry_after: retryAfter.toISOString(),
            last_error: result.error,
            error_count: item.error_count + 1
          });
          console.log(`⚠️ Settlement item ${item.id} failed, retrying in ${newAttempts} minutes`);
        } else {
          await this.updateSettlementStatus(item.id, 'FAILED', {
            attempts: newAttempts,
            last_error: result.error,
            error_count: item.error_count + 1,
            failed_at: new Date().toISOString()
          });
          
          // Mark trade matches as failed
          await this.supabase
            .from('trade_matches')
            .update({
              settlement_status: 'FAILED',
              updated_at: new Date().toISOString()
            })
            .in('id', item.trade_match_ids);

          console.error(`❌ Settlement item ${item.id} failed permanently: ${result.error}`);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing settlement item ${item.id}:`, error);
      await this.updateSettlementStatus(item.id, 'FAILED', {
        last_error: error instanceof Error ? error.message : 'Unknown error',
        error_count: item.error_count + 1,
        failed_at: new Date().toISOString()
      });
    }
  }

  /**
   * Update settlement queue item status
   */
  private async updateSettlementStatus(itemId: string, status: string, updates: any = {}): Promise<void> {
    const { error } = await this.supabase
      .from('settlement_queue')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...updates
      })
      .eq('id', itemId);

    if (error) {
      throw new Error(`Failed to update settlement status: ${error.message}`);
    }
  }

  /**
   * 🔄 Check for retroactive matching opportunities across all active markets
   */
  private async checkRetroactiveMatching(): Promise<void> {
    try {
      // Get all active markets
      const { data: markets, error: marketsError } = await this.supabase
        .from('orderbook_markets')
        .select('metric_id, id')
        .eq('is_active', true)
        .eq('market_status', 'ACTIVE');

      if (marketsError || !markets) {
        console.log('⚠️ Could not fetch markets for retroactive matching');
        return;
      }

      // Import matching engine
      const { getServerlessMatchingEngine } = await import('@/lib/serverless-matching');
      const matchingEngine = getServerlessMatchingEngine();

      // Check each market for retroactive matching opportunities
      for (const market of markets) {
        try {
          const result = await matchingEngine.processRetroactiveMatching(market.metric_id);
          
          if (result.success && result.matches.length > 0) {
            console.log(`🎉 Retroactive matching found ${result.matches.length} matches for ${market.metric_id}`);
          }
        } catch (error) {
          console.log(`⚠️ Retroactive matching failed for ${market.metric_id}: ${error}`);
        }
      }

    } catch (error) {
      console.error('❌ Error in retroactive matching check:', error);
    }
  }

  /**
   * Submit settlement to blockchain using OrderRouter.placeOrder()
   */
  private async submitToBlockchain(item: SettlementQueueItem): Promise<{ success: boolean; txHash?: string; error?: string }> {
    console.log("🚨 DEBUG: submitToBlockchain function HAS BEEN CALLED!");
    console.log(`🚨 DEBUG: Processing settlement item ${item.id}`);
    console.log(`🚨 DEBUG: Batch ID: ${item.batch_id}`);
    console.log(`🚨 DEBUG: Trade match IDs: ${JSON.stringify(item.trade_match_ids)}`);
    // BULLETPROOF environment variable loading using runtime loader
    debugEnvironment(); // Debug info
    const settlementPrivateKey = getSettlementPrivateKey();
    
    console.log(`🔐 Settlement Environment Check (BULLETPROOF v2):`);
    console.log(`  - Runtime loader result: ${!!settlementPrivateKey}`);
    console.log(`  - Key length: ${settlementPrivateKey?.length || 0} characters`);
    console.log(`  - Key format valid: ${settlementPrivateKey ? (settlementPrivateKey.startsWith('0x') && settlementPrivateKey.length === 66) : false}`);
    
    if (!settlementPrivateKey) {
      console.error(`❌ SETTLEMENT_PRIVATE_KEY not found with bulletproof loader`);
      debugEnvironment();
      throw new Error('SETTLEMENT_PRIVATE_KEY is required for blockchain settlement');
    }
    try {
      console.log(`🔗 Submitting settlement batch ${item.batch_id} to blockchain...`);
      
      // Safe JSON serialization that handles BigInt values
      const safeSerialize = (obj: any) => {
        return JSON.stringify(obj, (key, value) =>
          typeof value === 'bigint' ? value.toString() + 'n' : value
        , 2);
      };
      
      console.log(`📊 Settlement data:`, safeSerialize(item.settlement_data));

      // Process off-chain matched trades for settlement
      // This involves updating P&L, positions, and recording settlement on blockchain
      
      const trades = item.settlement_data.trades;
      const submittedTxs: string[] = [];

      // Get market configuration to find contract addresses
      const { data: market, error: marketError } = await this.supabase
        .from('orderbook_markets')
        .select('market_address, order_router_address, central_vault_address, metric_id')
        .eq('id', item.market_id)
        .single();

      if (marketError || !market?.central_vault_address) {
        throw new Error(`Market not found or missing central vault address: ${marketError?.message}`);
      }

      console.log(`📋 Settling ${trades.length} off-chain matched trades for market ${market.metric_id}`);

      // Process settlement for off-chain matched trades
      console.log(`🔄 Processing settlement for ${trades.length} matched trades`);

      // Use the pre-validated settlement private key for live blockchain submission
      const settlementPrivateKey = getSettlementPrivateKey();
      
      if (!settlementPrivateKey) {
        throw new Error('SETTLEMENT_PRIVATE_KEY is required for live blockchain settlement. No simulation mode available.');
      }
      
      {
        // Live blockchain settlement - record trade executions and update P&L
        console.log(`🔗 Processing ${trades.length} trade settlements on blockchain`);
        
        // Validate private key format
        if (!settlementPrivateKey.startsWith('0x') || settlementPrivateKey.length !== 66) {
          throw new Error(`Invalid private key format. Expected 0x followed by 64 hex characters, got: ${settlementPrivateKey.length} characters`);
        }
        
        // Create both public and wallet clients for live transactions
        const account = privateKeyToAccount(settlementPrivateKey as `0x${string}`);
        
        const publicClient = createPublicClient({
          chain: polygon,
          transport: http(env.RPC_URL)
        });
        
        const walletClient = createWalletClient({
          account,
          chain: polygon,
          transport: http(env.RPC_URL)
        });

        console.log(`📡 Settlement wallet: ${account.address}`);
        console.log(`🏪 Central vault: ${market.central_vault_address}`);
        console.log(`🌐 RPC URL: ${env.RPC_URL}`);

        // Cache UUID → on-chain orderId lookups within this batch
        const uuidToOnchainOrderId: Map<string, number> = new Map();

        // Helper to resolve on-chain orderId from an off-chain order UUID
        const resolveOnchainOrderId = async (orderUuid?: string): Promise<number | null> => {
          try {
            if (!orderUuid) return null;
            if (uuidToOnchainOrderId.has(orderUuid)) {
              return uuidToOnchainOrderId.get(orderUuid)!;
            }

            const { data, error } = await this.supabase
              .from('off_chain_orders')
              .select('order_id')
              .eq('id', orderUuid)
              .single();

            if (error) {
              console.warn(`⚠️ Could not fetch on-chain order_id for UUID ${orderUuid}: ${error.message}`);
              return null;
            }

            if (!data || data.order_id === null || data.order_id === undefined) {
              console.warn(`⚠️ No on-chain order_id recorded for UUID ${orderUuid}`);
              return null;
            }

            uuidToOnchainOrderId.set(orderUuid, Number(data.order_id));
            return Number(data.order_id);
          } catch (e) {
            console.warn(`⚠️ Failed resolving on-chain order_id for ${orderUuid}: ${e}`);
            return null;
          }
        };

        for (const trade of trades) {
          try {
            // Calculate P&L settlement amounts
            const tradeValue = trade.tradeQuantity * trade.tradePrice;
            const tradeValueWei = BigInt(Math.floor(tradeValue * 1e6)); // USDC has 6 decimals
            
            console.log(`💰 Processing trade: ${trade.tradeQuantity} @ $${trade.tradePrice} = $${tradeValue} (${tradeValueWei.toString()} wei)`);
            
            // Process settlement for this matched trade
            // This involves updating positions and recording the settlement on-chain
            
            // Use the proper CentralVault ABI
            const centralVaultABI = CONTRACTS.CentralVault.abi;

            // Record the settlement of this off-chain matched trade
            console.log(`🔗 Recording settlement for matched trade on blockchain...`);
            
            // Get current blockchain state for real transaction context
            const blockNumber = await publicClient.getBlockNumber();
            const block = await publicClient.getBlock({ blockNumber });
            const gasPrice = await publicClient.getGasPrice();
            
            console.log(`📊 Live blockchain context: Block ${blockNumber}, Gas ${gasPrice.toString()}, Timestamp ${block.timestamp}`);
            
            // Get primary collateral token for validation
            try {
              const primaryCollateralResult = await publicClient.readContract({
                address: market.central_vault_address as `0x${string}`,
                abi: centralVaultABI,
                functionName: 'getPrimaryCollateralToken'
              }) as [string];
              
              const primaryCollateralToken = primaryCollateralResult[0];
              console.log(`💎 Primary collateral token: ${primaryCollateralToken}`);
            } catch (contractError) {
              console.log(`⚠️ Could not read primary collateral token: ${contractError}`);
            }
            
            // Submit REAL blockchain transaction to record this settlement
            console.log(`🔗 Recording settlement on Polygon blockchain...`);
            
            console.log(`📡 Settlement details:`);
            console.log(`  - Buy Trader: ${trade.buyTrader}`);
            console.log(`  - Sell Trader: ${trade.sellTrader}`);
            console.log(`  - Trade Value: $${tradeValue} (${tradeValueWei.toString()} wei)`);
            console.log(`  - Match ID: ${trade.matchId}`);
            
            // Check wallet balance before submitting transaction
            const walletBalance = await publicClient.getBalance({ address: account.address });
            console.log(`💰 Settlement wallet balance: ${walletBalance.toString()} wei (${Number(walletBalance) / 1e18} MATIC)`);
            
            if (walletBalance < BigInt(1e15)) { // Less than 0.001 MATIC
              throw new Error(`Insufficient MATIC balance for gas fees: ${Number(walletBalance) / 1e18} MATIC`);
            }
            
            // Step 1: Record trade execution(s) on OrderRouter with guards to prevent spam/fail loops
            const enableRouterExecution = String(process.env.ENABLE_ORDER_ROUTER_EXECUTION || '').toLowerCase() === 'true';
            if (!enableRouterExecution) {
              console.log(`⏭️ Skipping OrderRouter.recordTradeExecution (set ENABLE_ORDER_ROUTER_EXECUTION=true to enable)`);
            } else {
              console.log(`🔗 Recording trade execution on OrderRouter for both legs (guarded)`);

              // Minimal ABI for required calls
              const orderRouterABI = [
                {
                  inputs: [
                    { name: "orderId", type: "uint256" },
                    { name: "executedQuantity", type: "uint256" },
                    { name: "executedPrice", type: "uint256" },
                    { name: "counterparty", type: "address" },
                    { name: "fees", type: "uint256" }
                  ],
                  name: "recordTradeExecution",
                  outputs: [],
                  stateMutability: "nonpayable",
                  type: "function"
                },
                {
                  inputs: [
                    { name: "role", type: "bytes32" },
                    { name: "account", type: "address" }
                  ],
                  name: "hasRole",
                  outputs: [{ name: "", type: "bool" }],
                  stateMutability: "view",
                  type: "function"
                },
                {
                  inputs: [{ name: "orderId", type: "uint256" }],
                  name: "getOrder",
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
                        { name: "metadataHash", type: "bytes32" }
                      ],
                      name: "order",
                      type: "tuple"
                    }
                  ],
                  stateMutability: "view",
                  type: "function"
                }
              ];

              const executedQty = BigInt(Math.floor(trade.tradeQuantity * 1e18));
              const executedPx = BigInt(Math.floor(trade.tradePrice * 1e18));

              try {
                // Check MARKET_ROLE on the router for the settlement wallet
                const { keccak256, toBytes } = await import('viem');
                const MARKET_ROLE = keccak256(toBytes('MARKET_ROLE')) as `0x${string}`;
                const hasMarketRole = await publicClient.readContract({
                  address: market.order_router_address as `0x${string}`,
                  abi: orderRouterABI,
                  functionName: 'hasRole',
                  args: [MARKET_ROLE, account.address as `0x${string}`]
                }) as boolean;

                if (!hasMarketRole) {
                  console.warn(`⏭️ Skipping recordTradeExecution: settlement wallet lacks MARKET_ROLE on OrderRouter`);
                } else {
                  const buyOrderOnchainId = await resolveOnchainOrderId(trade.buyOrderId);
                  const sellOrderOnchainId = await resolveOnchainOrderId(trade.sellOrderId);

                  const orderExists = async (id: number | null) => {
                    if (!id) return false;
                    try {
                      const on = await publicClient.readContract({
                        address: market.order_router_address as `0x${string}`,
                        abi: orderRouterABI,
                        functionName: 'getOrder',
                        args: [BigInt(id)]
                      }) as any;
                      return !!on && Number(on.orderId) !== 0;
                    } catch {
                      return false;
                    }
                  };

                  const buyExists = await orderExists(buyOrderOnchainId);
                  const sellExists = await orderExists(sellOrderOnchainId);

                  if (!buyExists && !sellExists) {
                    console.warn(`⏭️ Skipping recordTradeExecution: neither on-chain order exists (buyId=${buyOrderOnchainId}, sellId=${sellOrderOnchainId})`);
                  } else {
                    if (buyExists && buyOrderOnchainId) {
                      try {
                        console.log("\x1b[32m🔥 ========================================\x1b[0m");
                        console.log("\x1b[32m🔥 RECORD TRADE EXECUTION (BUY LEG)        \x1b[0m");
                        console.log("\x1b[32m📡 Router:\x1b[0m", market.order_router_address);
                        console.log("\x1b[32m🆔 OrderId:\x1b[0m", buyOrderOnchainId);
                        console.log("\x1b[32m📦 Qty (wei):\x1b[0m", executedQty.toString());
                        console.log("\x1b[32m💵 Px  (wei):\x1b[0m", executedPx.toString());
                        console.log("\x1b[32m🤝 Counterparty:\x1b[0m", trade.sellTrader);
                        // Estimate gas and add a safety margin
                        const buyLegEstimatedGas = await publicClient.estimateContractGas({
                          address: market.order_router_address as `0x${string}`,
                          abi: orderRouterABI,
                          functionName: 'recordTradeExecution',
                          args: [
                            BigInt(buyOrderOnchainId),
                            executedQty,
                            executedPx,
                            trade.sellTrader as `0x${string}`,
                            BigInt(0)
                          ],
                          account: account.address as `0x${string}`
                        });
                        const buyLegGasWithBuffer = (buyLegEstimatedGas * 125n) / 100n;
                        const buyLegTx = await walletClient.writeContract({
                          address: market.order_router_address as `0x${string}`,
                          abi: orderRouterABI,
                          functionName: 'recordTradeExecution',
                          args: [
                            BigInt(buyOrderOnchainId),
                            executedQty,
                            executedPx,
                            trade.sellTrader as `0x${string}`,
                            BigInt(0)
                          ],
                          gas: buyLegGasWithBuffer
                        });
                        console.log(`\x1b[32m✅ BUY leg recorded on OrderRouter (orderId=${buyOrderOnchainId}): ${buyLegTx}\x1b[0m`);
                        console.log("\x1b[32m🔥 ========================================\x1b[0m");
                      } catch (e) {
                        console.warn(`\x1b[31m⚠️ BUY leg recordTradeExecution failed:\x1b[0m ${e}`);
                      }
                    }

                    if (sellExists && sellOrderOnchainId) {
                      try {
                        console.log("\x1b[32m🔥 ========================================\x1b[0m");
                        console.log("\x1b[32m🔥 RECORD TRADE EXECUTION (SELL LEG)       \x1b[0m");
                        console.log("\x1b[32m📡 Router:\x1b[0m", market.order_router_address);
                        console.log("\x1b[32m🆔 OrderId:\x1b[0m", sellOrderOnchainId);
                        console.log("\x1b[32m📦 Qty (wei):\x1b[0m", executedQty.toString());
                        console.log("\x1b[32m💵 Px  (wei):\x1b[0m", executedPx.toString());
                        console.log("\x1b[32m🤝 Counterparty:\x1b[0m", trade.buyTrader);
                        // Estimate gas and add a safety margin
                        const sellLegEstimatedGas = await publicClient.estimateContractGas({
                          address: market.order_router_address as `0x${string}`,
                          abi: orderRouterABI,
                          functionName: 'recordTradeExecution',
                          args: [
                            BigInt(sellOrderOnchainId),
                            executedQty,
                            executedPx,
                            trade.buyTrader as `0x${string}`,
                            BigInt(0)
                          ],
                          account: account.address as `0x${string}`
                        });
                        const sellLegGasWithBuffer = (sellLegEstimatedGas * 125n) / 100n;
                        const sellLegTx = await walletClient.writeContract({
                          address: market.order_router_address as `0x${string}`,
                          abi: orderRouterABI,
                          functionName: 'recordTradeExecution',
                          args: [
                            BigInt(sellOrderOnchainId),
                            executedQty,
                            executedPx,
                            trade.buyTrader as `0x${string}`,
                            BigInt(0)
                          ],
                          gas: sellLegGasWithBuffer
                        });
                        console.log(`\x1b[32m✅ SELL leg recorded on OrderRouter (orderId=${sellOrderOnchainId}): ${sellLegTx}\x1b[0m`);
                        console.log("\x1b[32m🔥 ========================================\x1b[0m");
                      } catch (e) {
                        console.warn(`\x1b[31m⚠️ SELL leg recordTradeExecution failed:\x1b[0m ${e}`);
                      }
                    }
                  }
                }

                // Brief pause to avoid nonce contention when recording both legs
                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (executionError) {
                console.warn(`⚠️ recordTradeExecution pre-checks failed or call errored: ${executionError}`);
                console.warn(`   Continuing with CentralVault settlement...`);
              }
            }

            // Step 2: Call transferAssets on CentralVault to actually move funds between users
            console.log(`🔗 Calling transferAssets on CentralVault to settle trade...`);
            
            // Get primary collateral token (USDC)
            const primaryCollateralResult = await publicClient.readContract({
              address: market.central_vault_address as `0x${string}`,
              abi: centralVaultABI,
              functionName: 'getPrimaryCollateralToken'
            }) as [string, number, number, boolean];
            
            const primaryCollateralToken = primaryCollateralResult[0];
            console.log(`💎 Using collateral token: ${primaryCollateralToken}`);
            
            // Step 1: Allocate funds from buyer's available balance
            console.log(`🔄 Step 1: Allocating ${formatUnits(tradeValueWei, 6)} USDC from buyer...`);
            const allocateTxHash = await walletClient.writeContract({
              address: market.central_vault_address as `0x${string}`,
              abi: centralVaultABI,
              functionName: 'allocateAssets',
              args: [
                trade.buyTrader as `0x${string}`,        // user (buyer)
                primaryCollateralToken as `0x${string}`, // asset (USDC)
                tradeValueWei                             // amount to allocate
              ],
              gas: BigInt(150000),
            });
            
            console.log(`✅ Allocation TX: ${allocateTxHash}`);
            
            // Wait a moment for allocation to confirm
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Transfer allocated funds from buyer to seller
            console.log(`🔄 Step 2: Transferring ${formatUnits(tradeValueWei, 6)} USDC from buyer to seller...`);
            const settlementTxHash = await walletClient.writeContract({
              address: market.central_vault_address as `0x${string}`,
              abi: centralVaultABI,
              functionName: 'transferAssets',
              args: [
                trade.buyTrader as `0x${string}`,        // from (buyer pays)
                trade.sellTrader as `0x${string}`,       // to (seller receives)
                primaryCollateralToken as `0x${string}`, // asset (USDC)
                tradeValueWei                             // amount (trade value in USDC wei)
              ],
              gas: BigInt(200000), // Higher gas limit for contract call
            });
            
            console.log(`🔗 Settlement recorded on blockchain: ${settlementTxHash}`);
            console.log(`🌐 View on PolyScan: https://polygonscan.com/tx/${settlementTxHash}`);
            
            submittedTxs.push(settlementTxHash);
            console.log(`✅ Settlement recorded: ${trade.buyTrader} ↔ ${trade.sellTrader} (${trade.tradeQuantity} @ ${trade.tradePrice})`);
            console.log(`📊 Transaction: ${settlementTxHash} at block ${blockNumber}`);
            
            // Small delay between transactions to avoid nonce conflicts
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (tradeError) {
            console.error(`❌ Failed to submit live trade settlement:`, tradeError);
            console.error(`❌ Error details:`, {
              message: tradeError instanceof Error ? tradeError.message : 'Unknown error',
              stack: tradeError instanceof Error ? tradeError.stack : 'No stack trace',
              trade: { buyTrader: trade.buyTrader, sellTrader: trade.sellTrader, value: trade.tradeQuantity * trade.tradePrice }
            });
            
            // Re-throw the error - no fallback simulation allowed
            throw tradeError;
          }
        }
      }

      if (submittedTxs.length === 0) {
        throw new Error('No trades were successfully processed for settlement');
      }

      // Return the first transaction hash as the batch identifier
      const batchTxHash = submittedTxs[0];
      console.log(`✅ Settlement batch ${item.batch_id} submitted successfully: ${submittedTxs.length} trades, batch TX: ${batchTxHash}`);

      return {
        success: true,
        txHash: batchTxHash
      };

    } catch (error) {
      console.error(`❌ Blockchain settlement failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Blockchain submission failed'
      };
    }
  }

  /**
   * Get settlement processor status
   */
  public getStatus() {
    return {
      isRunning: this.processingInterval !== null,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Manual settlement processing for admin endpoints
   */
  public async processSettlementManually(): Promise<{ success: boolean; message: string; error?: string }> {
    if (this.isProcessing) {
      return {
        success: false,
        message: 'Settlement processor is already processing'
      };
    }

    try {
      this.isProcessing = true;
      console.log('🔄 Manual settlement processing started...');
      
      await this.processSettlement();
      
      console.log('✅ Manual settlement processing completed');
      return {
        success: true,
        message: 'Settlement processing completed successfully'
      };
    } catch (error) {
      console.error('❌ Manual settlement processing failed:', error);
      return {
        success: false,
        message: 'Settlement processing failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      this.isProcessing = false;
    }
  }
}

// Lazy-loaded singleton to ensure environment variables are fully loaded
let _settlementProcessorInstance: SettlementProcessor | null = null;

export function getSettlementProcessor(): SettlementProcessor {
  if (!_settlementProcessorInstance) {
    console.log('🔄 Creating SettlementProcessor instance (lazy-loaded)...');
    
    // Force reload environment variables to ensure they're available
    console.log('🔍 Environment check at instantiation time:');
    console.log(`  - process.env.SETTLEMENT_PRIVATE_KEY exists: ${!!process.env.SETTLEMENT_PRIVATE_KEY}`);
    console.log(`  - process.env.SETTLEMENT_PRIVATE_KEY length: ${process.env.SETTLEMENT_PRIVATE_KEY?.length || 0}`);
    
    _settlementProcessorInstance = new SettlementProcessor();
  }
  return _settlementProcessorInstance;
}

// Export singleton getter (backward compatibility)
export const settlementProcessor = {
  start: (intervalMs?: number) => getSettlementProcessor().start(intervalMs),
  stop: () => getSettlementProcessor().stop(),
  getStatus: () => getSettlementProcessor().getStatus()
};
