'use client';

import { useEffect } from 'react';
import type { Address } from 'viem';
import { createWsClient } from '@/lib/viemClient';
import { usePusher } from '@/lib/pusher-client';
import { CHAIN_CONFIG } from '@/lib/contractConfig';

type MarketEventType = 'order-placed' | 'trade-executed' | 'settlement-update';
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
  /** Called on settlement lifecycle events (LifecycleStateChanged, SettlementChallenged, etc.) */
  onSettlementChanged?: () => void;
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
    // OrderRested is emitted ONLY when an order actually rests on the book.
    // This is the definitive event for UI order book state updates.
    // Market orders that fully fill do NOT emit this event.
    // Limit orders that fully cross (fill immediately) do NOT emit this event.
    type: 'event',
    name: 'OrderRested',
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
    name: 'OrderCancelled',
    inputs: [
      { indexed: true, name: 'orderId', type: 'uint256' },
      { indexed: true, name: 'trader', type: 'address' },
      { indexed: false, name: 'price', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'isBuy', type: 'bool' },
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

const SETTLEMENT_EVENTS_ABI = [
  {
    type: 'event',
    name: 'LifecycleStateChanged',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: false, name: 'oldState', type: 'uint8' },
      { indexed: false, name: 'newState', type: 'uint8' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
      { indexed: true, name: 'caller', type: 'address' },
    ],
  },
  {
    type: 'event',
    name: 'LifecycleSettled',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'settledOnChain', type: 'bool' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
      { indexed: false, name: 'challengeWindowStart', type: 'uint256' },
      { indexed: false, name: 'challengeWindowEnd', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'LifecycleSync',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'previousState', type: 'uint8' },
      { indexed: false, name: 'newState', type: 'uint8' },
      { indexed: false, name: 'progressed', type: 'bool' },
      { indexed: false, name: 'devMode', type: 'bool' },
      { indexed: false, name: 'settledOnChain', type: 'bool' },
      { indexed: false, name: 'rolloverWindowStart', type: 'uint256' },
      { indexed: false, name: 'challengeWindowStart', type: 'uint256' },
      { indexed: false, name: 'challengeWindowEnd', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'SettlementChallengeWindowStarted',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: false, name: 'challengeWindowStart', type: 'uint256' },
      { indexed: false, name: 'challengeWindowEnd', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'SettlementChallenged',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: true, name: 'challenger', type: 'address' },
      { indexed: false, name: 'alternativePrice', type: 'uint256' },
      { indexed: false, name: 'bondAmount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'ChallengeResolved',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: true, name: 'challenger', type: 'address' },
      { indexed: false, name: 'challengerWon', type: 'bool' },
      { indexed: false, name: 'bondAmount', type: 'uint256' },
      { indexed: false, name: 'recipient', type: 'address' },
    ],
  },
  {
    type: 'event',
    name: 'EvidenceCommitted',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: true, name: 'evidenceHash', type: 'bytes32' },
      { indexed: true, name: 'committer', type: 'address' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'RolloverWindowStarted',
    inputs: [
      { indexed: true, name: 'market', type: 'address' },
      { indexed: false, name: 'rolloverWindowStart', type: 'uint256' },
      { indexed: false, name: 'rolloverWindowEnd', type: 'uint256' },
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
      if (evt.type === 'order-rested') sub.onOrdersChanged?.();
      if (evt.type === 'order-cancelled') sub.onOrdersChanged?.();
      if (evt.type === 'trade-executed') sub.onTradesChanged?.();
      if (evt.type === 'settlement-update') sub.onSettlementChanged?.();
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
        // OrderRested is the definitive event for UI order book state - order actually rested on book
        if (evt.type === 'order-rested') {
          const args: any = (evt.payload as any)?.args || {};
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
            : (evt.payload as any)?.amount !== undefined ? String((evt.payload as any).amount)
            : undefined;
          const isBuy =
            args?.isBuy !== undefined ? Boolean(args.isBuy)
            : (evt.payload as any)?.isBuy !== undefined ? Boolean((evt.payload as any).isBuy)
            : undefined;
          const isMarginOrder =
            args?.isMarginOrder !== undefined ? Boolean(args.isMarginOrder)
            : undefined;

          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} dispatch:ordersUpdated (OrderRested)`, {
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
              // OrderRested is the definitive event - this order IS resting on the book
              eventType: 'OrderRested',
              orderId,
              trader,
              price,
              amount,
              isBuy,
              isMarginOrder,
            }
          }));
        }
        if (evt.type === 'order-cancelled') {
          const args: any = (evt.payload as any)?.args || {};
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
            : (evt.payload as any)?.amount !== undefined ? String((evt.payload as any).amount)
            : undefined;
          const isBuy =
            args?.isBuy !== undefined ? Boolean(args.isBuy)
            : (evt.payload as any)?.isBuy !== undefined ? Boolean((evt.payload as any).isBuy)
            : undefined;

          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} dispatch:ordersUpdated (cancelled)`, {
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
              eventType: 'OrderCancelled',
              orderId,
              trader,
              price,
              amount,
              isBuy,
            }
          }));
        }
        if (evt.type === 'trade-executed') {
          const args: any = (evt.payload as any)?.args || {};
          let buyer: string | undefined = undefined;
          let seller: string | undefined = undefined;
          let price: string | undefined = undefined;
          let amount: string | undefined = undefined;
          let isBuyOrder: boolean | undefined = undefined;
          try {
            if (args?.buyer && args?.seller) {
              buyer = String(args.buyer);
              seller = String(args.seller);
              price = args?.price !== undefined ? String(args.price) : undefined;
              amount = args?.amount !== undefined ? String(args.amount) : undefined;
              // For TradeExecutionCompleted, isBuy refers to the maker order's side
              isBuyOrder = args?.isBuy !== undefined ? Boolean(args.isBuy) : undefined;
            } else if (args?.maker && args?.taker) {
              isBuyOrder = Boolean(args?.isBuyOrder);
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
              buyer,
              seller,
              price,
              amount,
            }
          }));
          
          // Also dispatch ordersUpdated for trade fills so the lightweight order book can update
          // This removes the filled liquidity from the book
          // TradeExecutionCompleted doesn't include isBuy, so we dispatch TWO events:
          // one for bids (buyer is maker) and one for asks (seller is maker)
          // The lightweight store will handle removing liquidity from whichever side has it
          if (price !== undefined && amount !== undefined) {
            // eslint-disable-next-line no-console
            console.log(`${UI_UPDATE_PREFIX} dispatch:ordersUpdated (trade fill - both sides)`, {
              traceId,
              symbol: String(evt.symbol || '').toUpperCase(),
              source: evt.source,
              price,
              amount,
              buyer,
              seller,
            });
            // Dispatch for the buy side (buyer was maker with resting bid)
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                traceId: traceId + ':bid',
                symbol: evt.symbol,
                source: evt.source,
                txHash: (evt.payload as any)?.transactionHash,
                blockNumber: (evt.payload as any)?.blockNumber,
                timestamp: evt.timestamp,
                eventType: 'TradeExecutionCompleted',
                isBuy: true,
                price,
                amount,
                trader: buyer,
              }
            }));
            // Dispatch for the sell side (seller was maker with resting ask)
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                traceId: traceId + ':ask',
                symbol: evt.symbol,
                source: evt.source,
                txHash: (evt.payload as any)?.transactionHash,
                blockNumber: (evt.payload as any)?.blockNumber,
                timestamp: evt.timestamp,
                eventType: 'TradeExecutionCompleted',
                isBuy: false,
                price,
                amount,
                trader: seller,
              }
            }));
          }
        }
        if (evt.type === 'settlement-update') {
          const args: any = (evt.payload as any)?.args || {};
          const eventName = String((evt.payload as any)?.eventName || '');
          // eslint-disable-next-line no-console
          console.log(`${UI_UPDATE_PREFIX} dispatch:settlementUpdated`, {
            traceId,
            symbol: String(evt.symbol || '').toUpperCase(),
            source: evt.source,
            eventName,
            txHash: (evt.payload as any)?.transactionHash,
            blockNumber: (evt.payload as any)?.blockNumber,
          });
          window.dispatchEvent(new CustomEvent('settlementUpdated', {
            detail: {
              traceId,
              symbol: evt.symbol,
              source: evt.source,
              txHash: (evt.payload as any)?.transactionHash,
              blockNumber: (evt.payload as any)?.blockNumber,
              timestamp: evt.timestamp,
              eventName,
              oldState: args?.oldState !== undefined ? Number(args.oldState) : undefined,
              newState: args?.newState !== undefined ? Number(args.newState) : undefined,
              previousState: args?.previousState !== undefined ? Number(args.previousState) : undefined,
              settledOnChain: args?.settledOnChain !== undefined ? Boolean(args.settledOnChain) : undefined,
              challenger: args?.challenger ? String(args.challenger) : undefined,
              alternativePrice: args?.alternativePrice !== undefined ? String(args.alternativePrice) : undefined,
              challengerWon: args?.challengerWon !== undefined ? Boolean(args.challengerWon) : undefined,
              challengeWindowStart: args?.challengeWindowStart !== undefined ? String(args.challengeWindowStart) : undefined,
              challengeWindowEnd: args?.challengeWindowEnd !== undefined ? String(args.challengeWindowEnd) : undefined,
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

    // OrderRested watcher - emitted ONLY when an order rests on the book
    // This is the definitive event for UI order book state updates
    const unwatchOrderRested = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENTS_ABI as any,
      eventName: 'OrderRested',
      onLogs: (logs: any[]) => {
        logs?.forEach((log) =>
          emit(u, {
            type: 'order-rested',
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
        console.error('[MarketEventHub] OrderRested watcher error', err);
      },
    });
    u.unsubs.push(() => {
      try {
        unwatchOrderRested?.();
      } catch {}
    });

    // OrderCancelled watcher for real-time cancellation updates
    const unwatchOrderCancelled = wsClient.watchContractEvent({
      address,
      abi: ORDERBOOK_EVENTS_ABI as any,
      eventName: 'OrderCancelled',
      onLogs: (logs: any[]) => {
        logs?.forEach((log) =>
          emit(u, {
            type: 'order-cancelled',
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
        console.error('[MarketEventHub] OrderCancelled watcher error', err);
      },
    });
    u.unsubs.push(() => {
      try {
        unwatchOrderCancelled?.();
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

    // Settlement / lifecycle event watchers
    const settlementEventNames = [
      'LifecycleStateChanged',
      'LifecycleSettled',
      'LifecycleSync',
      'SettlementChallengeWindowStarted',
      'SettlementChallenged',
      'ChallengeResolved',
      'EvidenceCommitted',
      'RolloverWindowStarted',
    ] as const;
    for (const eventName of settlementEventNames) {
      try {
        const unwatch = wsClient.watchContractEvent({
          address,
          abi: SETTLEMENT_EVENTS_ABI as any,
          eventName,
          onLogs: (logs: any[]) => {
            logs?.forEach((log) =>
              emit(u, {
                type: 'settlement-update',
                source: 'onchain',
                symbol,
                address,
                timestamp: nowMs(),
                payload: { ...log, eventName },
              })
            );
          },
          onError: (err: any) => {
            // eslint-disable-next-line no-console
            console.error(`[MarketEventHub] ${eventName} watcher error`, err);
          },
        });
        u.unsubs.push(() => {
          try { unwatch?.(); } catch {}
        });
      } catch {}
    }
  } catch (e: any) {
    // WS not available or failed to init; set up polling fallback
    logOnce(u, 'didLogOnchainSkipped', 'subscribe:onchain:skipped', {
      reason: 'ws_unavailable_or_failed',
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      error: e?.message || String(e),
    });
    // eslint-disable-next-line no-console
    console.log(`${UI_UPDATE_PREFIX} hub:onchain:skipped - setting up polling fallback`, {
      reason: 'ws_unavailable_or_failed',
      symbol: String(symbol || '').toUpperCase(),
      address: String(address).toLowerCase(),
      chainId: Number(CHAIN_CONFIG.chainId || 0),
      error: e?.message || String(e),
    });
    
    // Set up polling fallback for chains that don't support eth_subscribe
    setupPollingFallback(u, symbol, address);
  }

  hub.set(key, u);
  return u;
}

// Polling fallback for chains that don't support WebSocket subscriptions
async function setupPollingFallback(u: Underlying, symbol: string, address: Address) {
  const { createPublicClient, http } = await import('viem');
  const { CHAIN_CONFIG } = await import('@/lib/contractConfig');
  
  let lastBlockNumber = 0n;
  const POLL_INTERVAL = 3000; // 3 seconds
  
  const poll = async () => {
    try {
      const client = createPublicClient({
        transport: http(CHAIN_CONFIG.rpcUrl),
      });
      
      const currentBlock = await client.getBlockNumber();
      if (lastBlockNumber === 0n) {
        lastBlockNumber = currentBlock - 5n; // Start from 5 blocks ago
      }
      
      if (currentBlock <= lastBlockNumber) return;
      
      // Fetch logs for order events
      const logs = await client.getLogs({
        address,
        events: ORDERBOOK_EVENTS_ABI as any,
        fromBlock: lastBlockNumber + 1n,
        toBlock: currentBlock,
      });
      
      lastBlockNumber = currentBlock;
      
      if (logs.length > 0) {
        console.log(`[MarketEventHub:Polling] Got ${logs.length} events for ${symbol}`);
      }
      
      for (const log of logs) {
        const eventName = (log as any).eventName;
        if (eventName === 'OrderPlaced') {
          emit(u, {
            type: 'order-placed',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          });
        } else if (eventName === 'OrderRested') {
          emit(u, {
            type: 'order-rested',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          });
        } else if (eventName === 'OrderCancelled') {
          emit(u, {
            type: 'order-cancelled',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          });
        } else if (eventName === 'TradeExecutionCompleted' || eventName === 'TradeExecuted') {
          emit(u, {
            type: 'trade-executed',
            source: 'onchain',
            symbol,
            address,
            timestamp: nowMs(),
            payload: log,
          });
        }
      }
    } catch (err) {
      console.error('[MarketEventHub:Polling] Error:', err);
    }
  };
  
  // Start polling
  const intervalId = setInterval(poll, POLL_INTERVAL);
  poll(); // Initial poll
  
  // Add cleanup
  u.unsubs.push(() => {
    clearInterval(intervalId);
  });
  
  console.log(`[MarketEventHub:Polling] Started polling for ${symbol} at ${address} every ${POLL_INTERVAL}ms`);
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
          // Backend WS watcher sends { eventType: 'OrderPlaced' | 'OrderFilled' | 'OrderPartiallyFilled' | 'OrderCancelled', ... }
          const eventType = String((data as any)?.eventType || '').trim();
          if (eventType === 'OrderFilled') {
            // Filled implies orderbook changed + position changed
            emit(u, { type: 'order-placed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
            emit(u, { type: 'trade-executed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
            return;
          }
          if (eventType === 'OrderPartiallyFilled') {
            // Partial fill - update order status and orderbook, but position remains open
            emit(u, { type: 'order-placed', source: 'pusher', symbol, address, timestamp: nowMs(), payload: data });
            // Dispatch ordersUpdated so UI components can refresh filled_quantity
            window.dispatchEvent(new CustomEvent('ordersUpdated', {
              detail: {
                source: 'partial-fill',
                symbol,
                orderId: (data as any)?.orderId,
                filledAmount: (data as any)?.filledAmount,
                totalFilledQuantity: (data as any)?.totalFilledQuantity,
                fillPercent: (data as any)?.fillPercent,
                status: (data as any)?.status,
                timestamp: nowMs()
              }
            }));
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


