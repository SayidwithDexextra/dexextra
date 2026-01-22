import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { decodeEventLog } from 'viem'
import { AlchemyNotifyService, getAlchemyNotifyService } from '@/services/alchemyNotifyService'
// import { EventDatabase } from '@/lib/eventDatabase'
// import { getDynamicContractMonitor } from '@/services/dynamicContractMonitor'
import { SmartContractEvent } from '@/types/events'
import { env } from '@/lib/env'
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client'
import { getPusherServer } from '@/lib/pusher-server'
import { CONTRACTS } from '@/lib/contracts'
import { ethers } from 'ethers'
import { createClient as createSbClient } from '@supabase/supabase-js'

// Ensure Node.js runtime on Vercel (uses Node crypto, ethers, ClickHouse client)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'

// Factory contract address for detecting new market deployments
const FACTORY_ADDRESS = CONTRACTS.MetricsMarketFactory.address

// ABIs are now imported from centralized contracts configuration

// Database instance - commented out for now
// const eventDatabase = new EventDatabase();

// ClickHouse pipeline - lazy initialization (not at module load to avoid build errors)
let clickhousePipeline: ReturnType<typeof getClickHouseDataPipeline> | null = null;
function getClickHousePipeline() {
  if (!clickhousePipeline) {
    clickhousePipeline = getClickHouseDataPipeline();
  }
  return clickhousePipeline;
}

const pusherServer = getPusherServer();

// In-memory set to track processed events (to prevent duplicates during the session)
const processedEvents = new Set<string>();

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createSbClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Debug helper: log bridge config and on-chain checks for spoke outbox → hub inbox delivery.
 * Focus: why sendDeposit may revert when called from edge.
 */
async function logBridgeConfigDebug() {
  try {
    const polygonRpcUrl =
      process.env.POLYGON_RPC_URL ||
      process.env.MUMBAI_RPC_URL ||
      process.env.ALCHEMY_POLYGON_RPC_URL ||
      process.env.RPC_URL; // last resort

    const outbox = process.env.SPOKE_OUTBOX_ADDRESS;
    const hubInbox = process.env.HUB_INBOX_ADDRESS;
    const domainHub = process.env.BRIDGE_DOMAIN_HUB || '999';
    const relayerPk = process.env.RELAYER_PRIVATE_KEY;
    const dstDomainNum = Number(domainHub);

    const account =
      relayerPk && relayerPk.startsWith('0x') && relayerPk.length === 66
        ? new ethers.Wallet(relayerPk)
        : null;

    const provider =
      polygonRpcUrl && polygonRpcUrl.startsWith('http')
        ? new ethers.JsonRpcProvider(polygonRpcUrl)
        : null;

    let chainId: number | null = null;
    try {
      if (provider) {
        const net = await provider.getNetwork();
        chainId = Number(net.chainId);
      }
    } catch (_) {}

    // On-chain checks (optional)
    let hasSenderRole: boolean | null = null;
    let configuredRemoteApp: string | null = null;
    try {
      if (provider && outbox && ethers.isAddress(outbox) && account) {
        const abi = [
          'function hasRole(bytes32 role, address account) view returns (bool)',
          'function remoteAppByDomain(uint64) view returns (bytes32)',
        ];
        const contract = new ethers.Contract(outbox, abi, provider);
        const DEPOSIT_SENDER_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes('DEPOSIT_SENDER_ROLE')
        );
        hasSenderRole = await contract.hasRole(
          DEPOSIT_SENDER_ROLE,
          account.address
        );
        const remote = await contract.remoteAppByDomain(dstDomainNum);
        configuredRemoteApp = String(remote);
      }
    } catch (e: any) {
      // swallow to avoid breaking webhook path
      configuredRemoteApp = `check_failed: ${e?.message || String(e)}`;
    }

    // Compute bytes32(hubInbox)
    let hubInboxBytes32: string | null = null;
    try {
      if (hubInbox && ethers.isAddress(hubInbox)) {
        const hex = hubInbox.toLowerCase().replace(/^0x/, '');
        hubInboxBytes32 = '0x' + '0'.repeat(24) + hex;
      }
    } catch {}

    console.log('[alchemy-deposit-webhook][debug][bridge-config]', {
      polygonRpcUrlSet: !!polygonRpcUrl,
      polygonRpcUrl,
      outbox,
      hubInbox,
      hubInboxBytes32,
      domainHub: dstDomainNum,
      relayerPkSet: !!relayerPk,
      relayerAddress: account?.address || null,
      providerChainId: chainId,
      hasSenderRole,
      remoteAppByDomain999: configuredRemoteApp,
    });
  } catch (e) {
    console.log(
      '[alchemy-deposit-webhook][debug][bridge-config] error',
      (e as any)?.message || String(e)
    );
  }
}

/**
 * Generate trade data from Order Book style events for ClickHouse
 */
async function generateTradeFromOrderbookEvent(event: SmartContractEvent): Promise<void> {
  try {
    // Common order book trade event names
    const tradeEventNames = ['TradeExecuted', 'OrderMatched', 'OrderFilled'];
    if (!tradeEventNames.includes((event as any).eventType)) {
      return;
    }

    // Best-effort extraction of fields from known patterns
    const params = event as any;
    const symbol =
      params.symbol || params.marketSymbol || extractSymbolFromContract(event.contractAddress);
    const price = parseFloat(params.price || params.executionPrice || params.matchPrice || '0');
    const size = parseFloat(params.size || params.amount || params.quantity || '0');
    const isBuy =
      params.isBuy === true ||
      params.side === 'buy' ||
      params.makerSide === 'buy' ||
      params.takerSide === 'buy';

    if (!symbol || price <= 0 || size <= 0) {
      // Insufficient data to store a trade
      return;
    }

    const contractAddress = String(event.contractAddress || '').toLowerCase();
    const eventId = `${event.transactionHash}:${event.logIndex}`;

    // Resolve Supabase market UUID by contract address (canonical), fall back to symbol lookup.
    let marketUuid: string | undefined;
    let resolvedSymbol: string | undefined;
    try {
      const sb = getSupabase();
      if (sb && contractAddress) {
        const { data: m1 } = await sb
          .from('orderbook_markets_resolved')
          .select('id, symbol')
          .eq('market_address', contractAddress)
          .limit(1)
          .maybeSingle();
        if (m1?.id) marketUuid = String(m1.id);
        if ((m1 as any)?.symbol) resolvedSymbol = String((m1 as any).symbol).toUpperCase();
      }
    } catch {}

    const finalSymbol = String(resolvedSymbol || symbol).toUpperCase();

    const pipeline = getClickHousePipeline();
    if (!pipeline.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, skipping trade generation');
      return;
    }
    // ✅ Canonical raw ingestion: write trade events into market_ticks.
    // The ClickHouse MV (market_ticks → ohlcv_1m) constructs OHLCV properly.
    const tickPayload = {
      symbol: finalSymbol,
      ts: event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp as any),
      price,
      size,
      event_type: 'trade',
      is_long: isBuy,
      event_id: eventId,
      trade_count: 1,
      market_id: 0,
      contract_address: contractAddress,
      market_uuid: marketUuid
    };

    if ((pipeline as any).insertTickImmediate) {
      await (pipeline as any).insertTickImmediate(tickPayload);
    } else {
      await (pipeline as any).insertTick(tickPayload);
    }

    // Broadcast latest 1m candle to lightweight chart
    const latest =
      marketUuid && (pipeline as any).fetchLatestOhlcv1mByMarketUuid
        ? await (pipeline as any).fetchLatestOhlcv1mByMarketUuid(marketUuid)
        : await pipeline.fetchLatestOhlcv1m(finalSymbol);
    if (latest) {
      await pusherServer.broadcastChartData({
        // Keep `symbol` human-readable; use `marketUuid` for canonical realtime routing.
        symbol: String(latest.symbol || finalSymbol || 'UNKNOWN').toUpperCase(),
        marketUuid,
        timeframe: '1m',
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume,
        timestamp: (latest.time || Math.floor(Date.now() / 1000)) * 1000,
      });
    }

     console.log(`📊 Generated trade tick: ${finalSymbol} ${isBuy ? 'BUY' : 'SELL'} ${size} @ $${price}`);
  } catch (error) {
    console.error('❌ Failed to generate trade from order-book event:', error);
  }
}

/**
 * Webhook signature verification
 */
function verifyAlchemySignature(
  rawBody: string,
  signature: string,
  signingKey: string
): boolean {
  try {
    const hmac = createHmac('sha256', signingKey);
    hmac.update(rawBody, 'utf8');
    const digest = hmac.digest('hex');
    
    return signature === digest;
  } catch (error) {
    console.error('❌ Signature verification failed:', error);
    return false;
  }
}

/**
 * Generate tick data from VAMM events for ClickHouse
 */
async function generateTickFromVAMMEvent(event: SmartContractEvent): Promise<void> {
  try {
    // Only process specific event types that have price information
    if (!['PositionOpened', 'PositionClosed', 'PriceUpdated'].includes(event.eventType)) {
      return;
    }

    // Extract symbol from event parameters (adjust based on your contract structure)
    let symbol = 'UNKNOWN';
    let price = 0;
    let size = 0;
    let isLong = true;

    // Parse event parameters to extract trading data
    if (event.eventType === 'PositionOpened' || event.eventType === 'PositionClosed') {
      // Extract position data
      const params = event.parameters as any;
      
      // Assuming your VAMM events have these fields - adjust as needed
      symbol = params.symbol || params.marketSymbol || extractSymbolFromContract(event.contractAddress);
      price = parseFloat(params.markPrice || params.price || params.executionPrice || '0');
      size = parseFloat(params.size || params.amount || params.notional || '0');
      isLong = params.isLong === true || params.direction === 'long';
      
    } else if (event.eventType === 'PriceUpdated') {
      // Extract price update data
      const params = event.parameters as any;
      symbol = params.symbol || extractSymbolFromContract(event.contractAddress);
      price = parseFloat(params.newPrice || params.price || '0');
      size = 0; // Price updates don't have size
      isLong = true;
    }

    // Skip if we don't have valid price data
    if (price <= 0 || symbol === 'UNKNOWN') {
      console.warn(`⚠️ Skipping tick generation - invalid data: price=${price}, symbol=${symbol}`);
      return;
    }

    // Resolve Supabase market UUID (and try to infer numeric on-chain market id if present)
    let marketUuid: string | undefined;
    let numericMarketId: number = 0;
    try {
      const sb = getSupabase();
      if (sb) {
        // Prefer matching by contract address
        const { data: m1, error: e1 } = await sb
          .from('markets')
          .select('id, market_address')
          .eq('market_address', String(event.contractAddress).toLowerCase())
          .limit(1)
          .maybeSingle();
        if (!e1 && m1?.id) {
          marketUuid = String(m1.id);
        } else {
          // Fallback to symbol match
          const { data: m2 } = await sb
            .from('markets')
            .select('id')
            .ilike('symbol', String(symbol).toUpperCase())
            .limit(1)
            .maybeSingle();
          if (m2?.id) {
            marketUuid = String(m2.id);
          }
        }
      }
    } catch {}

    // Generate tick for ClickHouse
    const tick: VammTick = {
      symbol: symbol.toUpperCase(),
      ts: new Date(event.timestamp),
      price,
      size,
      event_type: event.eventType,
      is_long: isLong,
      market_id: numericMarketId,
      contract_address: event.contractAddress,
      market_uuid: marketUuid
    };

    // Insert tick immediately for serverless safety
    const pipeline = getClickHousePipeline();
    if (!pipeline.isConfigured()) {
      console.warn('⚠️ ClickHouse not configured, skipping tick generation');
      return;
    }
    if ((pipeline as any).insertTickImmediate) {
      await (pipeline as any).insertTickImmediate(tick);
    } else {
      await (pipeline as any).insertTick(tick);
    }

    // Broadcast latest 1m candle to lightweight chart
    const latest =
      marketUuid && (pipeline as any).fetchLatestOhlcv1mByMarketUuid
        ? await (pipeline as any).fetchLatestOhlcv1mByMarketUuid(marketUuid)
        : await pipeline.fetchLatestOhlcv1m(symbol.toUpperCase());
    if (latest) {
      await pusherServer.broadcastChartData({
        // Keep `symbol` human-readable; use `marketUuid` for canonical realtime routing.
        symbol: String(latest.symbol || symbol || 'UNKNOWN').toUpperCase(),
        marketUuid,
        timeframe: '1m',
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume,
        timestamp: (latest.time || Math.floor(Date.now() / 1000)) * 1000,
      });
    }
    console.log(`📊 Generated tick: ${symbol} @ $${price} (${event.eventType})`);

  } catch (error) {
    console.error('❌ Failed to generate tick from VAMM event:', error);
  }
}

/**
 * Extract symbol from contract address (fallback method)
 */
function extractSymbolFromContract(contractAddress: string): string {
  // Map known contract addresses to symbols
  const contractSymbolMap: Record<string, string> = {
    '0xdab242cd90b95a4ed68644347b80e0b3cead48c0': 'GOLD',
    '0x4eae52fe16bfd10bda0f6d7d354ec4a23188fce8': 'GOLD',
    '0x49325a53dfbf0ce08e6e2d12653533c6fc3f9673': 'GOLD',
    '0xc6220f6bdce01e85088b7e7b64e9425b86e3ab04': 'GOLD',
    '0x3f0cf8a2b6a30dacd0cdcbb3cf0080753139b50e': 'GOLD',
    // Add more contract mappings as needed
  };

  return contractSymbolMap[contractAddress.toLowerCase()] || 'UNKNOWN';
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-alchemy-signature');
    
     console.log('📨 Received Alchemy webhook, processing...');

    // Bridge debug snapshot (helps diagnose sendDeposit issues)
    await logBridgeConfigDebug();

    // Verify webhook signature in production
    if (env.NODE_ENV === 'production' && process.env.ALCHEMY_WEBHOOK_SIGNING_KEY && signature) {
      const isValidSignature = verifyAlchemySignature(
        rawBody,
        signature,
        process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
      );
      
      if (!isValidSignature) {
        console.error('❌ Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
       console.log('✅ Webhook signature verified');
    }

    const webhookData = JSON.parse(rawBody);
     console.log(`📡 Processing webhook type: ${webhookData.type}`);

    let processedEventsCount = 0;

    // Process different webhook types
    switch (webhookData.type) {
      case 'ADDRESS_ACTIVITY':
        processedEventsCount = await processAddressActivityWebhook(webhookData);
        break;
        
      case 'MINED_TRANSACTION':
        processedEventsCount = await processMinedTransactionWebhook(webhookData);
        break;
        
      case 'DROPPED_TRANSACTION':
        processedEventsCount = await processDroppedTransactionWebhook(webhookData);
        break;

      case 'GRAPHQL':
        processedEventsCount = await processCustomWebhook(webhookData);
        break;
        
      default:
         console.log(`⚠️ Unhandled webhook type: ${webhookData.type}`);
        return NextResponse.json({ 
          success: true, 
          message: `Webhook type ${webhookData.type} not processed`,
          processedEvents: 0
        });
    }

    const processingTime = Date.now() - startTime;
     console.log(`✅ Webhook processed successfully in ${processingTime}ms`);
     console.log(`📊 Total events processed: ${processedEventsCount}`);

    return NextResponse.json({ 
      success: true, 
      processed: processedEventsCount,
      processingTime: `${processingTime}ms` 
    });

  } catch (error) {
    console.error('❌ Webhook processing failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Process ADDRESS_ACTIVITY webhook
 */
async function processAddressActivityWebhook(webhookData: any): Promise<number> {
   console.log('📍 Processing address activity webhook');
  
  let processedCount = 0;
  const activities = webhookData.event?.activity || [];

   console.log(`📊 Total activities received: ${activities.length}`);

  // Count different types for summary
  let skippedEthTransfers = 0;
  let skippedNoLogs = 0;
  let processedEventsCount = 0;

  for (const activity of activities) {
    try {
      // Quick check for VAMM-related contracts
      const isVAMMContract = activity.toAddress && [
        '0xdab242cd90b95a4ed68644347b80e0b3cead48c0', // GoldV1 vAMM
        '0x4eae52fe16bfd10bda0f6d7d354ec4a23188fce8', // GOLDV2 vAMM
        '0x49325a53dfbf0ce08e6e2d12653533c6fc3f9673', // GOLDV3 vAMM
        '0xc6220f6bdce01e85088b7e7b64e9425b86e3ab04', // GOLDV4 vAMM
        '0x3f0cf8a2b6a30dacd0cdcbb3cf0080753139b50e'  // vAMM-GOLDV3
      ].includes(activity.toAddress.toLowerCase());

      // Handle different activity types more intelligently
      if (activity.category === 'external' && !activity.log) {
        // Simple ETH transfer - skip quietly
        skippedEthTransfers++;
        continue;
      }

      if (!activity.log || !activity.log.topics || activity.log.topics.length === 0) {
        // No event logs - skip but count
        skippedNoLogs++;
        if (isVAMMContract) {
           console.log('⚠️ VAMM activity without logs:', {
            category: activity.category,
            toAddress: activity.toAddress,
            blockNum: activity.blockNum,
            hash: activity.hash
          });
        }
        continue;
      }

      // This has logs - potential smart contract event
      if (isVAMMContract) {
         console.log('🎯 Processing VAMM activity:', {
          category: activity.category,
          toAddress: activity.toAddress,
          topicsLength: activity.log.topics.length,
          blockNum: activity.blockNum,
          hash: activity.hash
        });
      }

      // Create unique event identifier
      const eventId = `${activity.hash}:${activity.log.logIndex}`;
      
      if (processedEvents.has(eventId)) {
         console.log(`⏭️ Skipping already processed event: ${eventId}`);
        continue;
      }

      // Check if this is a factory contract event (MarketCreated)
      if (activity.log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()) {
         console.log('🏭 Factory contract activity detected, checking for MarketCreated event...');
        
        try {
          // Use decodeEventLog directly with ABI instead of Interface
    const factoryEvent = decodeEventLog({
      abi: CONTRACTS.MetricsMarketFactory.abi as any,
      topics: activity.log.topics,
      data: activity.log.data
    }) as any;
    
    if (factoryEvent && (factoryEvent.eventName === 'MarketCreated' || factoryEvent.name === 'MarketCreated')) {
             console.log('🎯 MarketCreated event detected! Processing new deployment...');
            
            // Process with dynamic contract monitor
            // const dynamicMonitor = await getDynamicContractMonitor();
            // await dynamicMonitor.processMarketCreatedEvent({
            //   ...factoryEvent,
            //   transactionHash: activity.hash,
            //   blockNumber: parseInt(activity.blockNum, 16),
            //   logIndex: activity.log.logIndex
            // });
          }
        } catch (factoryError) {
          const errorMessage = factoryError instanceof Error ? factoryError.message : 'Unknown error';
           console.log('ℹ️ Factory event parsing failed (not MarketCreated):', errorMessage);
        }
      }

      // Parse the event using contract ABIs
      const activityBlockNumber = typeof activity.blockNum === 'string' ? 
        parseInt(activity.blockNum, 16) : activity.blockNum;
      const activityBlockHash = activity.log?.blockHash; // ADDRESS_ACTIVITY logs might have blockHash
      const parsedEvent = await parseLogToSmartContractEvent(activity.log, activityBlockNumber, activityBlockHash);
      
      if (parsedEvent) {
         console.log(`✅ Successfully parsed ${parsedEvent.eventType} event:`, {
          contract: parsedEvent.contractAddress,
          event: parsedEvent.eventType,
          hash: activity.hash,
          logIndex: activity.log.logIndex
        });

        // Store in database
        // await eventDatabase.storeEvent(parsedEvent);
        
        // Generate tick for ClickHouse if it's a VAMM trading event
        await generateTickFromVAMMEvent(parsedEvent);
        // Generate trade for ClickHouse if it's an Order Book trading event
        await generateTradeFromOrderbookEvent(parsedEvent);
        
        processedEvents.add(eventId);
        processedCount++;
        processedEventsCount++;
      } else {
         console.log(`❓ Unknown event from ${activity.log.address}:`, {
          topics: activity.log.topics,
          blockNum: activity.blockNum
        });
      }
    } catch (error) {
      console.error(`❌ Error processing activity:`, error);
    }
  }

  // Summary logging
   console.log(`📈 Activity Summary:`, {
    total: activities.length,
    processed: processedEventsCount,
    skippedEthTransfers,
    skippedNoLogs,
    vammEventsProcessed: processedCount
  });

  return processedCount;
}

/**
 * Process MINED_TRANSACTION webhook
 */
async function processMinedTransactionWebhook(webhookData: any): Promise<number> {
   console.log('⛏️ Processing mined transaction webhook');
  
  let processedCount = 0;
  const transaction = webhookData.event?.transaction;
  
  if (!transaction || !transaction.logs) {
     console.log('⚠️ No transaction logs found in mined transaction webhook');
    return 0;
  }

  // Process transaction logs for events
  for (const log of transaction.logs) {
    try {
      // Create unique event identifier
      const eventId = `${log.transactionHash}:${log.logIndex}`;
      
      if (processedEvents.has(eventId)) {
         console.log(`⏭️ Skipping already processed event: ${eventId}`);
        continue;
      }

      // Get block number and hash from transaction context
      const transactionBlockNumber = typeof transaction.blockNumber === 'string' ? 
        parseInt(transaction.blockNumber, 16) : transaction.blockNumber;
      const transactionBlockHash = transaction.blockHash;
      
      const event = await parseLogToSmartContractEvent(log, transactionBlockNumber, transactionBlockHash);
      
      if (event) {
        // await eventDatabase.storeEvent(event);
        
        // Generate tick for ClickHouse if it's a VAMM trading event
        await generateTickFromVAMMEvent(event);
        // Generate trade for ClickHouse if it's an Order Book trading event
        await generateTradeFromOrderbookEvent(event);
        
        processedEvents.add(eventId);
        processedCount++;
        
         console.log(`📡 Processed ${event.eventType} event from mined transaction webhook: ${event.transactionHash}`);
      }
    } catch (error) {
      console.error('❌ Error processing transaction log:', error);
    }
  }

  return processedCount;
}

/**
 * Process DROPPED_TRANSACTION webhook
 */
async function processDroppedTransactionWebhook(webhookData: any): Promise<number> {
   console.log('🗑️ Processing dropped transaction webhook');
  
  const transaction = webhookData.event?.transaction;
  
  if (transaction) {
     console.log(`📋 Dropped transaction detected: ${transaction.hash}`);
    // You could implement logic here to handle dropped transactions
    // For example, mark pending states as failed, notify users, etc.
  }

  return 0; // Dropped transactions don't create events to store
}

/**
 * Process Custom Webhook (GRAPHQL)
 */
async function processCustomWebhook(webhookData: any): Promise<number> {
   console.log('🎯 Processing custom webhook (GRAPHQL)');
  
  let processedCount = 0;
  const logs = webhookData.event?.data?.block?.logs || [];
   console.log('🔍 Logs:', logs);

   console.log(`📊 Total logs received from custom webhook: ${logs.length}`);

  for (const log of logs) {
    try {
       console.log('🔍 Processing custom webhook log:', {
        contractAddress: log.account?.address,
        topicsLength: log.topics?.length || 0,
        transactionHash: log.transaction?.hash,
        logIndex: log.index
      });

      // Convert custom webhook log format to standard log format
      const standardLog = {
        address: log.account?.address,
        topics: log.topics || [],
        data: log.data || '0x',
        transactionHash: log.transaction?.hash,
        blockNumber: log.transaction?.blockNumber,
        blockHash: log.transaction?.blockHash,
        logIndex: log.index,
        transactionIndex: log.transaction?.index,
        removed: false
      };

      // Create unique event identifier
      const eventId = `${standardLog.transactionHash}:${standardLog.logIndex}`;
      
      if (processedEvents.has(eventId)) {
         console.log(`⏭️ Skipping already processed event: ${eventId}`);
        continue;
      }

      // Parse the event using contract ABIs
      const contextBlockNumber = typeof log.transaction?.blockNumber === 'string' ? 
        parseInt(log.transaction.blockNumber, 16) : log.transaction?.blockNumber;
      const contextBlockHash = log.transaction?.blockHash;
      const parsedEvent = await parseLogToSmartContractEvent(standardLog, contextBlockNumber, contextBlockHash);
      
      if (parsedEvent) {
        // await eventDatabase.storeEvent(parsedEvent);
        
        // Generate tick for ClickHouse if it's a VAMM trading event
        await generateTickFromVAMMEvent(parsedEvent);
        // Generate trade for ClickHouse if it's an Order Book trading event
        await generateTradeFromOrderbookEvent(parsedEvent);
        
        processedEvents.add(eventId);
        processedCount++;
        
         console.log(`🎯 Processed ${parsedEvent.eventType} event from custom webhook: ${parsedEvent.transactionHash}`);
      } else {
         console.log('⚠️ Failed to parse custom webhook event, log:', log);
      }
    } catch (error) {
      console.error('❌ Error processing custom webhook log:', error);
    }
  }

   console.log(`📈 Custom webhook processing complete: ${processedCount}/${logs.length} events processed`);
  return processedCount;
}

/**
 * Parse webhook log to SmartContractEvent
 */
async function parseLogToSmartContractEvent(log: any, contextBlockNumber?: number, contextBlockHash?: string): Promise<SmartContractEvent | null> {
  try {
    if (!log.topics || !log.data || !log.transactionHash) {
      console.warn('⚠️ Invalid log structure:', log);
      return null;
    }

    // Determine which ABI to use based on the contract or event signature
    const abis = [CONTRACTS.MetricsMarketFactory.abi, CONTRACTS.CentralVault.abi];
    let parsedLog: any = null;
    let matchedAbi: readonly string[] | null = null;

    // Try to parse with each ABI until one works
    for (const abi of abis) {
      try {
        const { Interface } = await import('ethers');
        const iface = new Interface(abi as any);
        parsedLog = iface.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (parsedLog) {
          matchedAbi = abi;
          break;
        }
      } catch (parseError) {
        // Continue to next ABI
        continue;
      }
    }

    if (!parsedLog) {
       console.log(`⚠️ Could not parse log with any known ABI: ${log.transactionHash}:${log.logIndex}`);
      return null;
    }

    // Convert hex values to numbers with better null handling
    let blockNumber: number;
    if (typeof log.blockNumber === 'string') {
      blockNumber = parseInt(log.blockNumber, 16);
    } else if (typeof log.blockNumber === 'number') {
      blockNumber = log.blockNumber;
    } else {
      // Fallback: try to get from context or transaction
      if (contextBlockNumber) {
         console.log('✅ Using context block number:', contextBlockNumber);
        blockNumber = contextBlockNumber;
      } else {
        console.warn('⚠️ blockNumber is null/undefined and no context provided, using 0');
        blockNumber = 0;
      }
    }

    let logIndex: number;
    if (typeof log.logIndex === 'string') {
      logIndex = parseInt(log.logIndex, 16);
    } else if (typeof log.logIndex === 'number') {
      logIndex = log.logIndex;
    } else {
      logIndex = 0;
    }

    // Handle block hash with fallback logic
    let blockHash: string;
    if (typeof log.blockHash === 'string' && log.blockHash) {
      blockHash = log.blockHash;
    } else {
      // Fallback: try to get from context or use placeholder
      if (contextBlockHash) {
         console.log('✅ Using context block hash:', contextBlockHash);
        blockHash = contextBlockHash;
      } else {
        console.warn('⚠️ blockHash is null/undefined and no context provided, using placeholder');
        blockHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      }
    }

    // Create base event structure
    const baseEvent: any = {
      transactionHash: log.transactionHash,
      blockNumber: blockNumber,
      blockHash: blockHash,
      logIndex: logIndex,
      contractAddress: log.address.toLowerCase(),
      timestamp: new Date(), // Note: Could fetch actual block timestamp for accuracy
      chainId: typeof env.CHAIN_ID === 'number' ? env.CHAIN_ID : parseInt(env.CHAIN_ID || '999'),
      eventType: parsedLog.name,
    };

    // Log successful block number and hash resolution
     console.log(`📊 Event parsed: ${parsedLog.name} at block ${blockNumber} (${blockHash.slice(0,10)}...), tx: ${log.transactionHash}:${logIndex}`);

    // Add event-specific fields based on the event type
    const event = formatEventSpecificFields(baseEvent as SmartContractEvent, parsedLog);
    
    if (event) {
       console.log(`✅ Parsed ${event.eventType} event: ${event.transactionHash}:${event.logIndex}`);
    }

    return event;

  } catch (error) {
    console.error('❌ Failed to parse webhook log:', error);
    return null;
  }
}

/**
 * Format event-specific fields based on event type
 */
function formatEventSpecificFields(
  baseEvent: any, 
  parsedLog: ethers.LogDescription
): any {
  
  try {
    switch (parsedLog.name) {
      case 'TradeExecuted':
        return {
          ...baseEvent,
          symbol: (parsedLog.args.symbol as any) || undefined,
          price: parsedLog.args.price?.toString(),
          size: parsedLog.args.size?.toString(),
          isBuy:
            parsedLog.args.isBuy === true ||
            (typeof parsedLog.args.side === 'string' && parsedLog.args.side.toLowerCase() === 'buy'),
          maker: parsedLog.args.maker === true || parsedLog.args.isMaker === true,
          tradeId: parsedLog.args.tradeId?.toString(),
          orderId: parsedLog.args.orderId?.toString(),
          marketId: parsedLog.args.marketId,
        };

      case 'OrderMatched':
        return {
          ...baseEvent,
          symbol: (parsedLog.args.symbol as any) || undefined,
          matchPrice: parsedLog.args.matchPrice?.toString() || parsedLog.args.price?.toString(),
          amount: parsedLog.args.amount?.toString() || parsedLog.args.size?.toString(),
          takerSide: parsedLog.args.takerSide,
          makerSide: parsedLog.args.makerSide,
          buyOrderId: parsedLog.args.buyOrderId?.toString(),
          sellOrderId: parsedLog.args.sellOrderId?.toString(),
        };

      case 'OrderFilled':
        return {
          ...baseEvent,
          symbol: (parsedLog.args.symbol as any) || undefined,
          price: parsedLog.args.price?.toString(),
          size: parsedLog.args.filledSize?.toString() || parsedLog.args.size?.toString(),
          isBuy:
            parsedLog.args.isBuy === true ||
            (typeof parsedLog.args.side === 'string' && parsedLog.args.side.toLowerCase() === 'buy'),
          orderId: parsedLog.args.orderId?.toString(),
        };

      case 'PositionOpened':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          positionId: parsedLog.args.positionId?.toString(),
          isLong: parsedLog.args.isLong,
          size: parsedLog.args.size?.toString(),
          price: parsedLog.args.price?.toString(),
          leverage: parsedLog.args.leverage?.toString(),
          fee: parsedLog.args.fee?.toString()
        };

      case 'PositionClosed':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          positionId: parsedLog.args.positionId?.toString(),
          size: parsedLog.args.size?.toString(),
          price: parsedLog.args.price?.toString(),
          pnl: parsedLog.args.pnl?.toString(),
          fee: parsedLog.args.fee?.toString()
        };

      case 'PositionIncreased':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          positionId: parsedLog.args.positionId?.toString(),
          sizeAdded: parsedLog.args.sizeAdded?.toString(),
          newSize: parsedLog.args.newSize?.toString(),
          newEntryPrice: parsedLog.args.newEntryPrice?.toString(),
          fee: parsedLog.args.fee?.toString()
        };

      case 'PositionLiquidated':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          positionId: parsedLog.args.positionId?.toString(),
          liquidator: parsedLog.args.liquidator,
          size: parsedLog.args.size?.toString(),
          price: parsedLog.args.price?.toString(),
          fee: parsedLog.args.fee?.toString()
        };

      case 'FundingPaid':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          positionId: parsedLog.args.positionId?.toString(),
          amount: parsedLog.args.amount?.toString(),
          fundingIndex: parsedLog.args.fundingIndex?.toString()
        };

      case 'FundingUpdated':
        return {
          ...baseEvent,
          fundingRate: parsedLog.args.fundingRate?.toString(),
          fundingIndex: parsedLog.args.fundingIndex?.toString(),
          premiumFraction: parsedLog.args.premiumFraction?.toString()
        };

      case 'CollateralDeposited':
      case 'CollateralWithdrawn':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          amount: parsedLog.args.amount?.toString()
        };

      case 'MarketCreated':
        return {
          ...baseEvent,
          marketId: parsedLog.args.marketId,
          symbol: parsedLog.args.symbol,
          vamm: parsedLog.args.vamm,
          vault: parsedLog.args.vault,
          oracle: parsedLog.args.oracle,
          startingPrice: parsedLog.args.startingPrice?.toString(),
          marketType: parsedLog.args.marketType?.toString()
        };

      case 'VirtualReservesUpdated':
        return {
          ...baseEvent,
          baseReserves: parsedLog.args.baseReserves?.toString(),
          quoteReserves: parsedLog.args.quoteReserves?.toString(),
          multiplier: parsedLog.args.multiplier?.toString()
        };

      case 'TradingFeeCollected':
        return {
          ...baseEvent,
          user: parsedLog.args.user,
          amount: parsedLog.args.amount?.toString()
        };

      default:
        // For events we don't specifically handle, store the base event
         console.log(`📝 Storing base event for unhandled type: ${parsedLog.name}`);
        return baseEvent;
    }
  } catch (error) {
    console.error(`❌ Error formatting ${parsedLog.name} event:`, error);
    return null;
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    message: 'Alchemy webhook endpoint is operational',
    timestamp: new Date().toISOString(),
    processedEvents: processedEvents.size
  });
} 