'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Address } from 'viem';
import { publicClient } from '@/lib/viemClient';

const TRADE_COMPONENTS = [
  { type: 'uint256', name: 'tradeId' },
  { type: 'address', name: 'buyer' },
  { type: 'address', name: 'seller' },
  { type: 'uint256', name: 'price' },
  { type: 'uint256', name: 'amount' },
  { type: 'uint256', name: 'timestamp' },
  { type: 'uint256', name: 'buyOrderId' },
  { type: 'uint256', name: 'sellOrderId' },
  { type: 'bool', name: 'buyerIsMargin' },
  { type: 'bool', name: 'sellerIsMargin' },
  { type: 'uint256', name: 'tradeValue' },
  { type: 'uint256', name: 'buyerFee' },
  { type: 'uint256', name: 'sellerFee' },
];

const ALL_TRADES_ABI = [
  {
    type: 'function' as const,
    name: 'getAllTrades' as const,
    stateMutability: 'view' as const,
    inputs: [
      { type: 'uint256' as const, name: 'offset' },
      { type: 'uint256' as const, name: 'limit' },
    ],
    outputs: [
      { type: 'tuple[]' as const, name: 'tradeData', components: TRADE_COMPONENTS },
      { type: 'bool' as const, name: 'hasMore' },
    ],
  },
  {
    type: 'function' as const,
    name: 'getTradeStatistics' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [
      { type: 'uint256' as const, name: 'totalTrades' },
      { type: 'uint256' as const, name: 'totalVolume' },
      { type: 'uint256' as const, name: 'totalFees' },
    ],
  },
];

export interface OnChainTrade {
  tradeId: string;
  buyer: string;
  seller: string;
  price: number;
  amount: number;
  timestamp: number;
  tradeValue: number;
  buyerFee: number;
  sellerFee: number;
}

export interface TradeStats {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
}

const PAGE_SIZE = 100;

function toBigInt(raw: any): bigint {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') return BigInt(Math.floor(raw));
  if (typeof raw === 'string' && raw !== '') return BigInt(raw);
  return 0n;
}

function scalePrice(raw: any): number {
  return Number(toBigInt(raw)) / 1e6;
}

function scaleAmount(raw: any): number {
  return Number(toBigInt(raw)) / 1e18;
}

function field(t: any, name: string, index: number): any {
  if (t && typeof t === 'object' && name in t) return t[name];
  if (Array.isArray(t) && index < t.length) return t[index];
  return undefined;
}

function parseRawTrade(t: any): OnChainTrade | null {
  if (!t) return null;

  const rawId = field(t, 'tradeId', 0);
  const id = toBigInt(rawId);
  const price = toBigInt(field(t, 'price', 3));
  const amount = toBigInt(field(t, 'amount', 4));
  const timestamp = toBigInt(field(t, 'timestamp', 5));

  // Only skip entries that are completely empty (all zeros = uninitialized storage slot)
  if (id === 0n && price === 0n && amount === 0n && timestamp === 0n) return null;

  return {
    tradeId: id.toString(),
    buyer: String(field(t, 'buyer', 1) ?? ''),
    seller: String(field(t, 'seller', 2) ?? ''),
    price: scalePrice(field(t, 'price', 3)),
    amount: scaleAmount(field(t, 'amount', 4)),
    timestamp: Number(timestamp),
    tradeValue: scalePrice(field(t, 'tradeValue', 10)),
    buyerFee: scalePrice(field(t, 'buyerFee', 11)),
    sellerFee: scalePrice(field(t, 'sellerFee', 12)),
  };
}

// Helper to parse trade event detail from ordersUpdated events for real-time updates
function parseTradeFromEvent(detail: any): OnChainTrade | null {
  if (!detail) return null;
  
  const eventType = String(detail.eventType || '');
  if (eventType !== 'TradeExecutionCompleted' && eventType !== 'trade') return null;
  
  try {
    const price = detail.price ? Number(detail.price) / 1e6 : 0;
    const amount = detail.amount ? Number(detail.amount) / 1e18 : 0;
    const timestamp = detail.timestamp ? Math.floor(detail.timestamp / 1000) : Math.floor(Date.now() / 1000);
    const tradeValue = price * amount;
    
    if (price <= 0 || amount <= 0) return null;
    
    return {
      tradeId: `rt-${Date.now()}`,
      buyer: detail.buyer || '',
      seller: detail.seller || '',
      price,
      amount,
      timestamp,
      tradeValue,
      buyerFee: 0,
      sellerFee: 0,
    };
  } catch {
    return null;
  }
}

export function useAllTrades(orderBookAddress: string | null | undefined, marketSymbol?: string) {
  const [trades, setTrades] = useState<OnChainTrade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  const offsetRef = useRef(0);
  const addressRef = useRef(orderBookAddress);
  const hasInitialLoadRef = useRef(false);

  // Reset when address changes
  useEffect(() => {
    if (addressRef.current !== orderBookAddress) {
      addressRef.current = orderBookAddress;
      setTrades([]);
      setStats(null);
      setHasMore(true);
      setError(null);
      offsetRef.current = 0;
      hasInitialLoadRef.current = false;
    }
  }, [orderBookAddress]);

  const fetchStats = useCallback(async () => {
    if (!orderBookAddress) return;
    try {
      const result: any = await publicClient.readContract({
        address: orderBookAddress as Address,
        abi: ALL_TRADES_ABI,
        functionName: 'getTradeStatistics',
        args: [],
      });
      const arr = Array.isArray(result) ? result : [result?.totalTrades, result?.totalVolume, result?.totalFees];
      if (arr.length >= 3) {
        setStats({
          totalTrades: Number(toBigInt(arr[0])),
          totalVolume: scalePrice(arr[1]),
          totalFees: scalePrice(arr[2]),
        });
      }
    } catch (e: any) {
      console.warn('[useAllTrades] getTradeStatistics failed:', e?.shortMessage || e?.message);
    }
  }, [orderBookAddress]);

  const fetchPage = useCallback(
    async (reset = false) => {
      if (!orderBookAddress) return;
      setIsLoading(true);
      setError(null);

      const currentOffset = reset ? 0 : offsetRef.current;

      try {
        const result: any = await publicClient.readContract({
          address: orderBookAddress as Address,
          abi: ALL_TRADES_ABI,
          functionName: 'getAllTrades',
          args: [BigInt(currentOffset), BigInt(PAGE_SIZE)],
        });

        // viem returns multi-value outputs as [tradeData, hasMore]
        let rawTrades: any[];
        let moreAvailable: boolean;
        if (Array.isArray(result)) {
          rawTrades = Array.isArray(result[0]) ? result[0] : [];
          moreAvailable = Boolean(result[1]);
        } else {
          rawTrades = Array.isArray(result?.tradeData) ? result.tradeData : [];
          moreAvailable = Boolean(result?.hasMore);
        }

        console.log(`[useAllTrades] fetched page offset=${currentOffset}: ${rawTrades.length} raw trades, hasMore=${moreAvailable}`);

        const parsed = rawTrades
          .map(parseRawTrade)
          .filter((t): t is OnChainTrade => t !== null);

        console.log(`[useAllTrades] parsed ${parsed.length} / ${rawTrades.length} trades`);

        if (reset) {
          setTrades(parsed);
          offsetRef.current = PAGE_SIZE;
        } else {
          setTrades((prev) => [...prev, ...parsed]);
          offsetRef.current = currentOffset + PAGE_SIZE;
        }

        setHasMore(moreAvailable);
      } catch (e: any) {
        console.error('[useAllTrades] getAllTrades failed:', e?.shortMessage || e?.message);
        setError(e?.shortMessage || e?.message || 'Failed to fetch trades');
      } finally {
        setIsLoading(false);
      }
    },
    [orderBookAddress]
  );

  const doLoad = useCallback(() => {
    fetchStats();
    fetchPage(true);
  }, [fetchStats, fetchPage]);

  // Auto-load once when activated and address becomes available
  useEffect(() => {
    if (active && orderBookAddress && !hasInitialLoadRef.current && !isLoading) {
      hasInitialLoadRef.current = true;
      doLoad();
    }
  }, [active, orderBookAddress, isLoading, doLoad]);

  const loadInitial = useCallback(() => {
    setActive(true);
    if (orderBookAddress) {
      hasInitialLoadRef.current = true;
      doLoad();
    }
  }, [orderBookAddress, doLoad]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchPage(false);
    }
  }, [fetchPage, isLoading, hasMore]);

  const refresh = useCallback(() => {
    offsetRef.current = 0;
    setTrades([]);
    setHasMore(true);
    setError(null);
    doLoad();
  }, [doLoad]);

  const deactivate = useCallback(() => {
    setActive(false);
  }, []);

  // Listen for real-time trade events and add them to the list optimistically
  useEffect(() => {
    if (!active || !marketSymbol || typeof window === 'undefined') return;
    
    const handleOrdersUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail) return;
      
      // Check if this event is for our market
      const eventSymbol = String(detail.symbol || '').toUpperCase();
      const ourSymbol = marketSymbol.toUpperCase();
      if (eventSymbol !== ourSymbol) return;
      
      // Try to parse the trade from the event
      const trade = parseTradeFromEvent(detail);
      if (!trade) return;
      
      // Add trade to the beginning of the list (newest first)
      setTrades(prev => {
        // Avoid duplicates by checking tradeId prefix
        if (prev.some(t => t.tradeId === trade.tradeId || t.tradeId.startsWith('rt-'))) {
          // Check if we already have a recent real-time trade at the same price/amount
          const duplicate = prev.find(
            t => t.tradeId.startsWith('rt-') && 
                 Math.abs(t.price - trade.price) < 0.0001 && 
                 Math.abs(t.amount - trade.amount) < 0.0001
          );
          if (duplicate) return prev;
        }
        return [trade, ...prev];
      });
      
      // Optimistically update stats
      setStats(prev => {
        if (!prev) return { totalTrades: 1, totalVolume: trade.tradeValue, totalFees: 0 };
        return {
          ...prev,
          totalTrades: prev.totalTrades + 1,
          totalVolume: prev.totalVolume + trade.tradeValue,
        };
      });
      
      console.log('[useAllTrades] Real-time trade added:', { symbol: eventSymbol, price: trade.price, amount: trade.amount });
    };
    
    window.addEventListener('ordersUpdated', handleOrdersUpdated as EventListener);
    return () => window.removeEventListener('ordersUpdated', handleOrdersUpdated as EventListener);
  }, [active, marketSymbol]);

  return {
    trades,
    stats,
    isLoading,
    hasMore,
    error,
    active,
    loadInitial,
    loadMore,
    refresh,
    deactivate,
    pageSize: PAGE_SIZE,
  };
}
