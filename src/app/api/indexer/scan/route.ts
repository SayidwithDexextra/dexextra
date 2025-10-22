import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { CHAIN_CONFIG } from '@/lib/contractConfig';
import OrderBookWebhookProcessor, { HYPERLIQUID_EVENT_TOPICS } from '@/services/orderBookWebhookProcessor';

type Hex = `0x${string}`;

function parseBlockParam(param: string | null, latest: number, fallbackRange: number): number {
  if (!param) return Math.max(0, latest - fallbackRange);
  const trimmed = param.trim();
  if (/^latest-\d+$/i.test(trimmed)) {
    const n = parseInt(trimmed.split('-')[1] || '0', 10);
    return Math.max(0, latest - n);
  }
  const asNum = parseInt(trimmed, 10);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum;
  return Math.max(0, latest - fallbackRange);
}

function toHexBlock(n: number): Hex {
  return ethers.toBeHex(n) as Hex;
}

export async function GET(request: NextRequest) {
  const start = Date.now();
  try {
    // Provider
    const rpcUrl = CHAIN_CONFIG?.rpcUrl as string;
    if (!rpcUrl) {
      return NextResponse.json({ ok: false, error: 'Missing CHAIN_CONFIG.rpcUrl' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const latestBlock = await provider.getBlockNumber();

    // Params
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const range = parseInt(searchParams.get('range') || '5', 10); // default scan last 5 blocks

    const toBlock = toParam ? parseInt(toParam, 10) : latestBlock;
    const fromBlock = parseBlockParam(fromParam, latestBlock, range);
    const fromHex = toHexBlock(fromBlock);
    const toHex = toHexBlock(toBlock);

    // Load dynamic addresses (active markets)
    const { data: markets } = await supabaseAdmin
      .from('orderbook_markets_resolved')
      .select('market_address, factory_address, metric_id')
      .eq('market_status', 'ACTIVE')
      .eq('is_active', true);

    const orderBookAddresses = Array.from(new Set((markets || [])
      .map(m => (m.market_address || '').toLowerCase())
      .filter(Boolean)));
    const factoryAddresses: string[] = [];

    // Helper: chunk array
    const chunk = <T,>(arr: T[], size: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    // Topics
    const orderTopics = [
      HYPERLIQUID_EVENT_TOPICS.ORDER_PLACED_ACTUAL,
      HYPERLIQUID_EVENT_TOPICS.ORDER_PLACED,
      HYPERLIQUID_EVENT_TOPICS.ORDER_FILLED,
      HYPERLIQUID_EVENT_TOPICS.ORDER_CANCELLED,
      HYPERLIQUID_EVENT_TOPICS.ORDER_CANCELLED_ACTUAL,
      HYPERLIQUID_EVENT_TOPICS.ORDER_ADDED,
      HYPERLIQUID_EVENT_TOPICS.ORDER_MATCHED,
    ];

    const factoryTopics: string[] = [];

    const logs: ethers.Log[] = [];

    // Scan OrderBook logs by topic (chunk addresses for provider limits)
    const obChunks = chunk(orderBookAddresses, 800); // conservative chunk size
    for (const addresses of obChunks) {
      for (const topic of orderTopics) {
        try {
          const l = await provider.getLogs({
            fromBlock: fromHex,
            toBlock: toHex,
            address: addresses as any,
            topics: [topic]
          });
          logs.push(...l);
        } catch (e) {
          console.warn('[INDEXER][getLogs][order]', { error: (e as any)?.message, topic, fromBlock, toBlock, addresses: addresses.length });
        }
      }
    }

    // Scan Factory logs (market creation)
    if (factoryAddresses.length > 0 && factoryTopics.length > 0) {
      const facChunks = chunk(factoryAddresses, 800);
      for (const addresses of facChunks) {
        for (const topic of factoryTopics) {
          try {
            const l = await provider.getLogs({
              fromBlock: fromHex,
              toBlock: toHex,
              address: addresses as any,
              topics: [topic]
            });
            logs.push(...l);
          } catch (e) {
            console.warn('[INDEXER][getLogs][factory]', { error: (e as any)?.message, topic, fromBlock, toBlock, addresses: addresses.length });
          }
        }
      }
    }

    // Adapt to processor input
    const adaptedLogs = logs.map((log) => ({
      account: { address: log.address },
      topics: log.topics as string[],
      data: log.data,
      index: Number(log.index || 0),
      transaction: {
        hash: log.transactionHash as string,
        index: Number(log.transactionIndex || 0),
        blockNumber: ethers.toBeHex(log.blockNumber || 0),
        blockHash: log.blockHash as string,
        from: { address: '' },
        to: { address: '' }
      }
    }));

    // Process via existing processor
    const processor = new OrderBookWebhookProcessor();
    const result = await processor.processWebhookEvent({
      type: 'GRAPHQL',
      event: { data: { block: { logs: adaptedLogs as any } } }
    } as any);

    const ms = Date.now() - start;
    return NextResponse.json({
      ok: true,
      scanned: { fromBlock, toBlock },
      addresses: { orderBooks: orderBookAddresses.length, factories: factoryAddresses.length },
      logsFound: logs.length,
      processed: result.processed,
      errors: result.errors,
      durationMs: ms
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Indexer error' }, { status: 500 });
  }
}


