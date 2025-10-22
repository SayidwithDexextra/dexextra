import { Address } from 'viem';
import { createWsClient } from '@/lib/viemClient';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { PusherServerService } from '@/lib/pusher-server';

type Unsubscribe = () => void;

// Minimal ABI for the three order events we care about
const ORDERBOOK_EVENT_ABI = [
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'isBuy', type: 'bool' }
    ]
  },
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'filledAmount', type: 'uint256' }
    ]
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' }
    ]
  }
] as const;

function getMarketKeyForOrderBookAddress(orderBookAddress: string): { symbol: string; metricId?: string } {
  const markets = (CONTRACT_ADDRESSES as any)?.MARKET_INFO || {};
  const entries = Object.values(markets) as any[];
  const lower = orderBookAddress.toLowerCase();
  const matched = entries.find((m) => (m?.orderBook || '').toLowerCase() === lower);
  if (matched) {
    return { symbol: String(matched.symbol || matched.name || 'UNKNOWN'), metricId: matched.marketId };
  }
  // Fallback by comparing against known aliases
  if ((CONTRACT_ADDRESSES as any).ALUMINUM_ORDERBOOK?.toLowerCase() === lower) {
    return { symbol: 'ALUMINUM', metricId: (markets as any)?.ALUMINUM?.marketId };
  }
  if ((CONTRACT_ADDRESSES as any).BTC_ORDERBOOK?.toLowerCase() === lower) {
    return { symbol: 'BTC', metricId: (markets as any)?.BTC?.marketId };
  }
  return { symbol: 'UNKNOWN' };
}

function shouldIncludeAddress(addr?: string | null): addr is Address {
  return Boolean(addr && addr !== '0x0000000000000000000000000000000000000000');
}

export function startOrderbookWsWatchers(): Unsubscribe[] {
  const wsClient = createWsClient();
  const pusher = new PusherServerService();

  const addresses: Address[] = [];
  const alu = (CONTRACT_ADDRESSES as any).ALUMINUM_ORDERBOOK as string | undefined;
  const btc = (CONTRACT_ADDRESSES as any).BTC_ORDERBOOK as string | undefined;
  if (shouldIncludeAddress(alu)) addresses.push(alu as Address);
  if (shouldIncludeAddress(btc) && (!alu || btc!.toLowerCase() !== alu!.toLowerCase())) addresses.push(btc as Address);

  if (addresses.length === 0) {
    console.warn('[orderbookWsWatcher] No order book addresses configured to watch');
    return [];
  }

  const unsubscribes: Unsubscribe[] = [];

  for (const address of addresses) {
    const { symbol, metricId } = getMarketKeyForOrderBookAddress(address);
    const channelSymbol = symbol ? `market-${symbol.toUpperCase()}` : null;
    const channelMetric = metricId ? `market-${metricId}` : null;

    const broadcast = async (eventName: 'OrderPlaced' | 'OrderFilled' | 'OrderCancelled', log: any) => {
      try {
        const base = {
          orderId: String((log?.args as any)?.orderId ?? ''),
          trader: String((log?.args as any)?.trader ?? ''),
          eventType: eventName,
          address: address,
          blockNumber: Number(log?.blockNumber ?? 0),
          txHash: String(log?.transactionHash ?? ''),
          timestamp: Date.now(),
        };

        // Use direct access to pusher instance (pattern used elsewhere in codebase)
        const p: any = (pusher as any)['pusher'];
        if (!p) return;

        const payload = base;
        // Broadcast to symbol and metric channels
        if (channelSymbol) await p.trigger(channelSymbol, 'order-update', payload);
        if (channelMetric) await p.trigger(channelMetric, 'order-update', payload);
        // Global stream for recent transactions
        await p.trigger('recent-transactions', 'new-order', payload);
      } catch (err) {
        console.error('[orderbookWsWatcher] Broadcast error', err);
      }
    };

    const placeUnsub = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENT_ABI as any,
      eventName: 'OrderPlaced',
      // WebSocket subscription (no fromBlock) for live-only events
      onLogs: (logs: any[]) => {
        logs.forEach((log) => broadcast('OrderPlaced', log));
      },
      onError: (error: Error) => {
        console.error('[orderbookWsWatcher] OrderPlaced watcher error', error);
      }
    });
    unsubscribes.push(placeUnsub);

    const filledUnsub = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENT_ABI as any,
      eventName: 'OrderFilled',
      onLogs: (logs: any[]) => {
        logs.forEach((log) => broadcast('OrderFilled', log));
      },
      onError: (error: Error) => {
        console.error('[orderbookWsWatcher] OrderFilled watcher error', error);
      }
    });
    unsubscribes.push(filledUnsub);

    const cancelUnsub = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENT_ABI as any,
      eventName: 'OrderCancelled',
      onLogs: (logs: any[]) => {
        logs.forEach((log) => broadcast('OrderCancelled', log));
      },
      onError: (error: Error) => {
        console.error('[orderbookWsWatcher] OrderCancelled watcher error', error);
      }
    });
    unsubscribes.push(cancelUnsub);

     console.log(`[orderbookWsWatcher] Watching ${address} for OrderPlaced/OrderFilled/OrderCancelled (symbol=${symbol}, metricId=${metricId || 'N/A'})`);
  }

  return unsubscribes;
}


