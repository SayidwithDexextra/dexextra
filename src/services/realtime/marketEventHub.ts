'use client';

import { useEffect } from 'react';
import type { Address } from 'viem';
import { createWsClient } from '@/lib/viemClient';
import { usePusher } from '@/lib/pusher-client';
import { CHAIN_CONFIG } from '@/lib/contractConfig';

type MarketEventType = 'order-placed' | 'trade-executed';
type MarketEventSource = 'onchain' | 'pusher';

export type MarketEvent = {
  type: MarketEventType;
  source: MarketEventSource;
  symbol: string;
  address?: Address;
  timestamp: number;
  payload?: any;
};

type Subscriber = {
  onEvent?: (evt: MarketEvent) => void;
  /** Called on order lifecycle events (we currently map OrderPlaced + pusher order-update) */
  onOrdersChanged?: () => void;
  /** Called on trade execution events (we currently map TradeExecutionCompleted + pusher trading-event) */
  onTradesChanged?: () => void;
  /** If true, dispatches DOM events used elsewhere in the app */
  dispatchDomEvents?: boolean;
};

type HubKey = string; // `${chainId}:${addressLower}:${symbolUpper}`

type Underlying = {
  refCount: number;
  symbol: string;
  address: Address;
  subscribers: Set<Subscriber>;
  unsubs: Array<() => void>;
  lastEmitAt: { [K in MarketEventType]?: number };
  debug?: {
    lastEventLogAtMs: number;
    didLogOnchainSubscribe?: boolean;
    didLogOnchainSkipped?: boolean;
    didLogPusherSubscribe?: boolean;
    recentEventKeys?: Map<string, number>;
  };
};

const UI_UPDATE_PREFIX = '[UI,Update]';

// Minimal ABI fragments for the two events we care about.
// Note: These names must match the actual event names in the deployed OrderBook diamond facets.
const ORDERBOOK_EVENTS_ABI = [
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'isBuy', type: 'bool' },
      { indexed: false, name: 'isMarginOrder', type: 'bool' },
    ],
  },
  {
    type: 'event',
    name: 'TradeExecutionCompleted',
    inputs: [
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: true, name: 'seller', type: 'address' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
  // Some deployments emit TradeExecuted (bytes32 orderId, maker, taker, ...)
  {
    type: 'event',
    name: 'TradeExecuted',
    inputs: [
      { indexed: true, name: 'orderId', type: 'bytes32' },
      { indexed: true, name: 'maker', type: 'address' },
      { indexed: true, name: 'taker', type: 'address' },
      { indexed: false, name: 'isBuyOrder', type: 'bool' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'quantity', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
  },
] as const;

const hub = new Map<HubKey, Underlying>();

function nowMs() {
  return Date.now();
}

function logOnce(u: Underlying, key: keyof NonNullable<Underlying['debug']>, msg: string, data?: any) {
  const d = (u.debug ||= { lastEventLogAtMs: 0 });
  if ((d as any)[key]) return;
  (d as any)[key] = true;
  // eslint-disable-next-line no-console
  console.log(`[RealTimeToken] ${msg}`, data ?? '');
}

function logEvent(u: Underlying, msg: string, data?: any) {
  // Throttle only event pickup logs (subscribe/teardown should always print once)
  const now = nowMs();
  const d = (u.debug ||= { lastEventLogAtMs: 0 });
  if (now - d.lastEventLogAtMs < 500) return;
  d.lastEventLogAtMs = now;
  // eslint-disable-next-line no-console
  console.log(`[RealTimeToken] ${msg}`, data ?? '');
}

function makeKey(symbol: string, address: Address): HubKey {
  const chainId = Number(CHAIN_CONFIG.chainId || 0);
  return `${chainId}:${String(address).toLowerCase()}:${String(symbol || '').toUpperCase()}`;
}

function emit(u: Underlying, evt: MarketEvent) {
  const last = u.lastEmitAt[evt.type] ?? 0;
  // Debounce storms (multi-log bursts). Keep it low to feel real-time.
  if (evt.timestamp - last < 250) return;
  u.lastEmitAt[evt.type] = evt.timestamp;

  // Deduplicate identical events coming from multiple sources (onchain + pusher) for the same tx.
  // Keeps UI from double-applying the same fill.
  try {
    const txHash = String((evt.payload as any)?.transactionHash || '');
    const symbolUpper = String(evt.symbol || '').toUpperCase();
    // Prefer txHash when present. If absent (common for some pusher events), fall back to orderId/price/amount/isBuy.
    // Do NOT include eventType here; the same tx can arrive via onchain + pusher with different eventType values.
    const args: any = (evt.payload as any)?.args || {};
    const orderId =
      args?.orderId !== undefined ? String(args.orderId)
      : (evt.payload as any)?.orderId !== undefined ? String((evt.payload as any).orderId)
      : '';
    const price =
      args?.price !== undefined ? String(args.price)
      : (evt.payload as any)?.price !== undefined ? String((evt.payload as any).price)
      : '';
    const amount =
      args?.amount !== undefined ? String(args.amount)
      : (evt.payload as any)?.filledAmount !== undefined ? String((evt.payload as any).filledAmount)
      : (evt.payload as any)?.amount !== undefined ? String((evt.payload as any).amount)
      : '';
    const isBuy =
      args?.isBuy !== undefined ? (Boolean(args.isBuy) ? 'B' : 'S')
      : (evt.payload as any)?.isBuy !== undefined ? (Boolean((evt.payload as any).isBuy) ? 'B' : 'S')
      : (evt.payload as any)?.isBuyOrder !== undefined ? (Boolean((evt.payload as any).isBuyOrder) ? 'B' : 'S')
      : '';

    const key = txHash
      ? `${evt.type}:tx:${txHash}:${symbolUpper}`
      : `${evt.type}:oid:${orderId || 'noOrderId'}:${symbolUpper}:${price}:${amount}:${isBuy}`;
    const d = (u.debug ||= { lastEventLogAtMs: 0 });
    const map = (d.recentEventKeys ||= new Map<string, number>());
    const now = nowMs();
    const prev = map.get(key) || 0;
    if (now - prev < 10_000) {
      return;
    }
    map.set(key, now);
    // prune occasionally
    if (map.size > 200) {
      for (const [k, ts] of map.entries()) {
        if (now - ts > 20_000) map.delete(k);
      }
    }
  } catch {}

  const traceId = `${evt.type}:${(evt.payload as any)?.transactionHash || 'noTx'}:${evt.timestamp}`;

  logEvent(u, `event:${evt.type}`, {
    traceId,
    source: evt.source,
    symbol: String(evt.symbol || '').toUpperCase(),
    address: evt.address ? String(evt.address).toLowerCase() : undefined,
    chainId: Number(CHAIN_CONFIG.chainId || 0),
    txHash: (evt.payload as any)?.transactionHash,
    blockNumber: (evt.payload as any)?.blockNumber,
  });

  // Fan-out
  for (const sub of u.subscribers) {
    try {
      sub.onEvent?.(evt);
    } catch {}
    try {
      if (evt.type === 'order-placed') sub.onOrdersChanged?.();
      if (evt.type === 'trade-executed') sub.onTradesChanged?.();
    } catch {}
    // Optional bridge for legacy consumers
    if (sub.dispatchDomEvents && typeof window !== 'undefined') {
      try {
        if (evt.type === 'order-placed') {
          const args: any = (evt.payload as any)?.args || {};
          const pusherEvtType = String((evt.payload as any)?.eventType || '');
          // Normalize order fields
          const orderId =
            args?.orderId !== undefined ? String(args.orderId)
            : (evt.payload as any)?.orderId !== undefined ? String((evt.payload as any).orderId)
            : undefined;
          const trader =
            args?.trader !== undefined ? String(args.trader)
            : (evt.payload as any)?.trader !== undefined ? String((evt.payload as any).trader)
            : undefined;
          const price =
            args?.price !== undefined ? String(args.price)
            : (evt.payload as any)?.price !== undefined ? String((evt.payload as any).price)
            : undefined;
          const amount =
            args?.amount !== undefined ? String(args.amount)
            : (evt.payload as any)?.filledAmount !== undefined ? String((evt.payload as any).filledAmount)
            : (evt.payload as any)?.amount !== undefined ? String((evt.payload as any).amount)
            : undefined;
          const isBuy =
            args?.isBuy !== undefined ? Boolean(args.isBuy)
            : (evt.payload as any)?.isBuy !== undefined ? Boolean((evt.payload as any).isBuy)
            : (evt.payload as any)?.isBuyOrder !== undefined ? Boolean((evt.payload as any).isBuyOrder)
            : undefined;
          const isMarginOrder =
            args?.isMarginOrder !== undefined ? Boolean(args.isMarginOrder)
            : undefined;

          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} dispatch:ordersUpdated`, {
            traceId,
            symbol: String(evt.symbol || '').toUpperCase(),
            source: evt.source,
            txHash: (evt.payload as any)?.transactionHash,
            blockNumber: (evt.payload as any)?.blockNumber,
          });
          window.dispatchEvent(new CustomEvent('ordersUpdated', {
            detail: {
              traceId,
              symbol: evt.symbol,
              source: evt.source,
              txHash: (evt.payload as any)?.transactionHash,
              blockNumber: (evt.payload as any)?.blockNumber,
              timestamp: evt.timestamp,
              // order info for optimistic UI
              eventType: pusherEvtType || (args?.orderId !== undefined ? 'OrderPlaced' : undefined),
              orderId,
              trader,
              price,
              amount,
              isBuy,
              isMarginOrder,
            }
          }));
        }
        if (evt.type === 'trade-executed') {
          const args: any = (evt.payload as any)?.args || {};
          // Normalize trade details across event names
          let buyer: string | undefined = undefined;
          let seller: string | undefined = undefined;
          let price: string | undefined = undefined;
          let amount: string | undefined = undefined;
          try {
            if (args?.buyer && args?.seller) {
              buyer = String(args.buyer);
              seller = String(args.seller);
              price = args?.price !== undefined ? String(args.price) : undefined;
              amount = args?.amount !== undefined ? String(args.amount) : undefined;
            } else if (args?.maker && args?.taker) {
              const isBuyOrder = Boolean(args?.isBuyOrder);
              const maker = String(args.maker);
              const taker = String(args.taker);
              buyer = isBuyOrder ? maker : taker;
              seller = isBuyOrder ? taker : maker;
              price = args?.price !== undefined ? String(args.price) : undefined;
              amount = args?.quantity !== undefined ? String(args.quantity) : undefined;
            }
          } catch {}
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} dispatch:positionsRefreshRequested`, {
            traceId,
            symbol: String(evt.symbol || '').toUpperCase(),
            source: evt.source,
            txHash: (evt.payload as any)?.transactionHash,
            blockNumber: (evt.payload as any)?.blockNumber,
          });
          window.dispatchEvent(new CustomEvent('positionsRefreshRequested', {
            detail: {
              traceId,
              symbol: evt.symbol,
              source: evt.source,
              txHash: (evt.payload as any)?.transactionHash,
              blockNumber: (evt.payload as any)?.blockNumber,
              timestamp: evt.timestamp,
              // Trade details for immediate UI patching
              buyer,
              seller,
              price,
              amount,
            }
          }));
        }
      } catch {}
    }
  }
}

function ensureUnderlying(symbol: string, address: Address): Underlying {
  const key = makeKey(symbol, address);
  const existing = hub.get(key);
  if (existing) return existing;

  const u: Underlying = {
    refCount: 0,
    symbol,
    address,
    subscribers: new Set(),
    unsubs: [],
    lastEmitAt: {},
    debug: { lastEventLogAtMs: 0 },
  };

  // Underlying on-chain watcher (WS if available; if WS missing, we just skip on-chain events)
  try {
    const wsClient = createWsClient();
    logOnce(u, 'didLogOnchainSubscribe', 'subscribe:onchain:success', {
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      chainId: Number(CHAIN_CONFIG.chainId || 0),
    });
    // eslint-disable-next-line no-console
    console.log(`${UI_UPDATE_PREFIX} hub:onchain:subscribe`, {
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      chainId: Number(CHAIN_CONFIG.chainId || 0),
    });
    const unwatchOrderPlaced = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENTS_ABI as any,
      eventName: 'OrderPlaced',
      onLogs: (logs: any[]) => {
        logs?.forEach((log) =>
          emit(u, {
            type: 'order-placed',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          })
        );
      },
      onError: (err: any) => {
        // eslint-disable-next-line no-console
        console.error('[MarketEventHub] OrderPlaced watcher error', err);
      },
    });
    u.unsubs.push(() => {
      try {
        unwatchOrderPlaced?.();
      } catch {}
    });

    const unwatchTradeExec = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENTS_ABI as any,
      eventName: 'TradeExecutionCompleted',
      onLogs: (logs: any[]) => {
        logs?.forEach((log) =>
          emit(u, {
            type: 'trade-executed',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          })
        );
      },
      onError: (err: any) => {
        // eslint-disable-next-line no-console
        console.error('[MarketEventHub] TradeExecutionCompleted watcher error', err);
      },
    });
    u.unsubs.push(() => {
      try {
        unwatchTradeExec?.();
      } catch {}
    });

    // TradeExecuted watcher (alternative event name used by some deployments)
    try {
      const unwatchTradeExecuted = wsClient.watchContractEvent({
        address,
        abi: ORDERBOOK_EVENTS_ABI as any,
        eventName: 'TradeExecuted',
        onLogs: (logs: any[]) => {
          logs?.forEach((log) =>
            emit(u, {
              type: 'trade-executed',
              source: 'onchain',
              symbol,
              address,
              timestamp: nowMs(),
              payload: log,
            })
          );
        },
        onError: (err: any) => {
          // eslint-disable-next-line no-console
          console.error('[MarketEventHub] TradeExecuted watcher error', err);
        },
      });
      u.unsubs.push(() => {
        try {
          unwatchTradeExecuted?.();
        } catch {}
      });
    } catch {}
  } catch (e) {
    // WS not available or failed to init; ignore (polling covers data correctness)
    logOnce(u, 'didLogOnchainSkipped', 'subscribe:onchain:skipped', {
      reason: 'ws_unavailable_or_failed',
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
    });
    // eslint-disable-next-line no-console
    console.log(`${UI_UPDATE_PREFIX} hub:onchain:skipped`, {
      reason: 'ws_unavailable_or_failed',
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      chainId: Number(CHAIN_CONFIG.chainId || 0),
    });
  }

  hub.set(key, u);
  return u;
}

/**
 * Hook wrapper around a shared singleton hub (dedupes underlying subscriptions).
 *
 * - Subscribes to **OrderPlaced** + **TradeExecutionCompleted** via WS if available
 * - Subscribes to Pusher events:
 *   - `market-${symbol}` / `order-update` => order-placed (we treat all order-updates as orders-changed)
 *   - `market-${symbol}` / `trading-event` => trade-executed
 *
 * This is intentionally small + opinionated to avoid sprinkling ad-hoc listeners across the codebase.
 */
export function useMarketEventHub(symbol: string, address: Address | null | undefined, subscriber: Subscriber) {
  const pusher = usePusher();

  useEffect(() => {
    if (!symbol || !address) return;

    const u = ensureUnderlying(symbol, address);
    u.refCount += 1;
    u.subscribers.add(subscriber);
    // eslint-disable-next-line no-console
    console.log('[RealTimeToken] subscribe:hub:addSubscriber', {
      refCount: u.refCount,
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      chainId: Number(CHAIN_CONFIG.chainId || 0),
      hasPusher: !!pusher,
    });

    // Pusher hooks are per-subscriber (since callbacks differ); still cheap.
    const unsubs: Array<() => void> = [];
    if (pusher) {
      const channel = `market-${symbol}`;
      const handlers = {
        'order-update': (data: any) => {
          // Backend WS watcher sends { eventType: 'OrderPlaced' | 'OrderFilled' | 'OrderCancelled', ... }
          const eventType = String((data as any)?.eventType || '').trim();
          if (eventType === 'OrderFilled') {
            // Filled implies orderbook changed + position changed
            emit(u, { type: 'order-placed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
            emit(u, { type: 'trade-executed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
            return;
          }
          // Default: treat as order lifecycle change
          emit(u, { type: 'order-placed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
        },
        'trading-event': (data: any) => {
          emit(u, { type: 'trade-executed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
        },
      } as Record<string, (data: any) => void>;
      try {
        unsubs.push(pusher.subscribeToChannel(channel, handlers));
        logOnce(u, 'didLogPusherSubscribe', 'subscribe:pusher:success', { channel });
      } catch {}
    }

    return () => {
      // Remove pusher handlers
      unsubs.forEach((fn) => {
        try {
          fn();
        } catch {}
      });

      // Remove subscriber
      u.subscribers.delete(subscriber);
      u.refCount = Math.max(0, u.refCount - 1);
      // eslint-disable-next-line no-console
      console.log('[RealTimeToken] subscribe:hub:removeSubscriber', {
        refCount: u.refCount,
        symbol: String(symbol || '').toUpperCase(),
        address: String(address).toLowerCase(),
      });

      // Tear down underlying watchers if nobody is listening
      if (u.refCount === 0) {
        // eslint-disable-next-line no-console
        console.log('[RealTimeToken] subscribe:hub:teardown', {
          symbol: String(symbol || '').toUpperCase(),
          address: String(address).toLowerCase(),
        });
        u.unsubs.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
        const key = makeKey(symbol, address);
        hub.delete(key);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, address, pusher]);
}


