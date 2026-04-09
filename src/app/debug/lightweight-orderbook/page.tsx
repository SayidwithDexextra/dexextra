'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  useLightweightOrderBookStore,
  useOrderBook,
  useOrderBookStats,
  useUpdateCount,
  type LightweightOrderBook,
  type OrderBookLevel,
} from '@/stores/lightweightOrderBookStore';
import { useMarkets, type Market } from '@/hooks/useMarkets';

function formatPrice(value: number, decimals = 4): string {
  if (!value || value === 0) return '0.00';
  if (value < 0.000001 && value > 0) return value.toFixed(8);
  if (value >= 1) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return value.toFixed(Math.max(2, decimals));
}

function formatAmount(value: number, decimals = 4): string {
  if (!value || value === 0) return '0.0000';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function OrderBookRow({
  level,
  side,
  maxTotal,
}: {
  level: OrderBookLevel;
  side: 'bid' | 'ask';
  maxTotal: number;
}) {
  const fillPercent = maxTotal > 0 ? (level.total / maxTotal) * 100 : 0;
  const color = side === 'bid' ? '#00D084' : '#FF4747';
  const bgColor = side === 'bid' ? 'rgba(0,208,132,0.1)' : 'rgba(255,71,71,0.1)';

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute top-0 h-full transition-all duration-75"
        style={{
          [side === 'bid' ? 'left' : 'right']: 0,
          width: `${fillPercent}%`,
          background: bgColor,
        }}
      />
      <div className="relative grid grid-cols-3 gap-2 py-[3px] px-2 text-[11px] font-mono">
        <div style={{ color }} className="text-left tabular-nums">
          ${formatPrice(level.price)}
        </div>
        <div className="text-center text-t-fg-label tabular-nums">
          {formatAmount(level.amount)}
        </div>
        <div className="text-right text-t-fg-muted tabular-nums">
          {formatAmount(level.total)}
        </div>
      </div>
    </div>
  );
}

function LightweightOrderBookVisual({ symbol }: { symbol: string }) {
  const orderBook = useOrderBook(symbol);
  const stats = useOrderBookStats(symbol);

  if (!orderBook || !stats) {
    return (
      <div className="flex items-center justify-center h-full text-t-fg-muted text-sm">
        No order book data for {symbol}
      </div>
    );
  }

  const maxBidTotal = orderBook.bids.length > 0 ? orderBook.bids[orderBook.bids.length - 1].total : 0;
  const maxAskTotal = orderBook.asks.length > 0 ? orderBook.asks[orderBook.asks.length - 1].total : 0;
  const maxTotal = Math.max(maxBidTotal, maxAskTotal);

  // Display asks in reverse order (best ask at bottom, near spread)
  const displayAsks = [...orderBook.asks].reverse();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="grid grid-cols-3 gap-2 py-1 px-2 text-[9px] font-medium text-t-fg-muted border-b border-t-stroke-sub">
        <div className="text-left">PRICE</div>
        <div className="text-center">SIZE</div>
        <div className="text-right">TOTAL</div>
      </div>

      {/* Asks (sells) - reversed so best ask is at bottom */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        <div className="overflow-y-auto max-h-[200px]">
          {displayAsks.length === 0 ? (
            <div className="text-[10px] text-t-fg-muted text-center py-2">No asks</div>
          ) : (
            displayAsks.map((level, i) => (
              <OrderBookRow key={`ask-${level.price}-${i}`} level={level} side="ask" maxTotal={maxTotal} />
            ))
          )}
        </div>
      </div>

      {/* Spread */}
      <div className="py-2 px-2 bg-t-inset border-y border-t-stroke-sub">
        <div className="flex items-center justify-center gap-3 text-[11px] font-mono">
          <span className="text-t-fg-muted">Spread</span>
          <span className="text-t-fg font-semibold">${formatPrice(stats.spread)}</span>
          <span className="text-t-fg-muted">({stats.spreadPercent.toFixed(2)}%)</span>
        </div>
      </div>

      {/* Bids (buys) */}
      <div className="flex-1 overflow-y-auto max-h-[200px]">
        {orderBook.bids.length === 0 ? (
          <div className="text-[10px] text-t-fg-muted text-center py-2">No bids</div>
        ) : (
          orderBook.bids.map((level, i) => (
            <OrderBookRow key={`bid-${level.price}-${i}`} level={level} side="bid" maxTotal={maxTotal} />
          ))
        )}
      </div>

      {/* Stats footer */}
      <div className="px-2 py-1 border-t border-t-stroke-sub text-[9px] text-t-fg-muted flex justify-between">
        <span>{stats.bidCount} bids / {stats.askCount} asks</span>
        <span className={stats.snapshotSource === 'optimistic' ? 'text-yellow-400' : 'text-green-400'}>
          {stats.snapshotSource}
        </span>
      </div>
    </div>
  );
}

function TradingPanelSimulator({
  symbol,
  bestBid,
  bestAsk,
  onTrade,
}: {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  onTrade: (side: 'buy' | 'sell', type: 'market' | 'limit', price: number, amount: number) => void;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [amount, setAmount] = useState('1');
  const [price, setPrice] = useState('');
  const [lastTradeTime, setLastTradeTime] = useState<number | null>(null);

  useEffect(() => {
    if (orderType === 'limit' && !price) {
      setPrice((side === 'buy' ? bestBid : bestAsk).toFixed(4));
    }
  }, [side, orderType, bestBid, bestAsk, price]);

  const handleSubmit = () => {
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return;

    let tradePrice = orderType === 'market'
      ? (side === 'buy' ? bestAsk : bestBid)
      : parseFloat(price) || 0;

    if (tradePrice <= 0) return;

    const startTime = performance.now();
    onTrade(side, orderType, tradePrice, amt);
    const endTime = performance.now();

    setLastTradeTime(endTime - startTime);
    console.log(`[TradingPanel] Trade submitted in ${(endTime - startTime).toFixed(2)}ms`);
  };

  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;

  return (
    <div className="p-3 space-y-3">
      {/* Side toggle */}
      <div className="flex bg-t-inset rounded p-0.5">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-1.5 px-2 rounded text-[11px] font-medium transition-colors ${
            side === 'buy' ? 'bg-[#00D084] text-black' : 'text-t-fg-muted hover:text-t-fg'
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-1.5 px-2 rounded text-[11px] font-medium transition-colors ${
            side === 'sell' ? 'bg-[#FF4747] text-white' : 'text-t-fg-muted hover:text-t-fg'
          }`}
        >
          SELL
        </button>
      </div>

      {/* Order type toggle */}
      <div className="flex bg-t-inset rounded p-0.5">
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 py-1 px-2 rounded text-[10px] font-medium transition-colors ${
            orderType === 'market' ? 'bg-t-card text-t-fg' : 'text-t-fg-muted hover:text-t-fg'
          }`}
        >
          MARKET
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 py-1 px-2 rounded text-[10px] font-medium transition-colors ${
            orderType === 'limit' ? 'bg-t-card text-t-fg' : 'text-t-fg-muted hover:text-t-fg'
          }`}
        >
          LIMIT
        </button>
      </div>

      {/* Price display / input */}
      <div className="space-y-1">
        <label className="text-[9px] text-t-fg-muted">
          {orderType === 'market' ? 'Estimated Price' : 'Limit Price'}
        </label>
        {orderType === 'market' ? (
          <div className="bg-t-inset rounded px-3 py-2 text-[12px] font-mono text-t-fg">
            ${formatPrice(side === 'buy' ? bestAsk : bestBid)}
          </div>
        ) : (
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-t-inset rounded px-3 py-2 text-[12px] font-mono text-t-fg border border-transparent focus:border-t-stroke-hover outline-none"
            placeholder="0.0000"
            step="0.0001"
          />
        )}
      </div>

      {/* Amount input */}
      <div className="space-y-1">
        <label className="text-[9px] text-t-fg-muted">Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-t-inset rounded px-3 py-2 text-[12px] font-mono text-t-fg border border-transparent focus:border-t-stroke-hover outline-none"
          placeholder="0.0000"
          step="0.1"
          min="0"
        />
      </div>

      {/* Quick amount buttons */}
      <div className="grid grid-cols-4 gap-1">
        {[0.1, 1, 5, 10].map((val) => (
          <button
            key={val}
            onClick={() => setAmount(val.toString())}
            className="py-1 text-[9px] text-t-fg-muted bg-t-inset rounded hover:bg-t-card-hover transition-colors"
          >
            {val}
          </button>
        ))}
      </div>

      {/* Estimated value */}
      <div className="flex justify-between text-[10px] text-t-fg-muted">
        <span>Est. Value</span>
        <span className="text-t-fg font-mono">
          ${formatPrice((parseFloat(amount) || 0) * (orderType === 'market' ? (side === 'buy' ? bestAsk : bestBid) : (parseFloat(price) || 0)))}
        </span>
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!amount || parseFloat(amount) <= 0}
        className={`w-full py-2.5 rounded text-[12px] font-semibold transition-all ${
          side === 'buy'
            ? 'bg-[#00D084] hover:bg-[#00D084]/90 text-black'
            : 'bg-[#FF4747] hover:bg-[#FF4747]/90 text-white'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {orderType === 'market' ? 'Execute Market Order' : 'Place Limit Order'}
      </button>

      {/* Performance indicator */}
      {lastTradeTime !== null && (
        <div className="text-center text-[9px] text-green-400">
          Last trade processed in {lastTradeTime.toFixed(2)}ms
        </div>
      )}

      {/* Market info */}
      <div className="pt-2 border-t border-t-stroke-sub space-y-1 text-[9px]">
        <div className="flex justify-between text-t-fg-muted">
          <span>Best Bid</span>
          <span className="text-[#00D084] font-mono">${formatPrice(bestBid)}</span>
        </div>
        <div className="flex justify-between text-t-fg-muted">
          <span>Best Ask</span>
          <span className="text-[#FF4747] font-mono">${formatPrice(bestAsk)}</span>
        </div>
        <div className="flex justify-between text-t-fg-muted">
          <span>Mid Price</span>
          <span className="text-t-fg font-mono">${formatPrice(midPrice)}</span>
        </div>
      </div>
    </div>
  );
}

function MarketCard({ market, isSelected, onSelect }: { market: Market; isSelected: boolean; onSelect: () => void }) {
  const stats = useOrderBookStats(market.symbol);

  return (
    <button
      onClick={onSelect}
      className={`w-full p-3 rounded-md border text-left transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-t-stroke hover:border-t-stroke-hover bg-t-card hover:bg-t-card-hover'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-t-fg">{market.symbol}</div>
          <div className="text-[10px] text-t-fg-muted truncate max-w-[120px]">{market.name}</div>
        </div>
        {stats ? (
          <div className="text-right">
            <div className="text-[11px] text-t-fg font-mono">${formatPrice(stats.bestBid)}</div>
            <div className="text-[9px] text-t-fg-muted">{stats.bidCount + stats.askCount} levels</div>
          </div>
        ) : (
          <div className="text-[9px] text-t-fg-muted">Not loaded</div>
        )}
      </div>
    </button>
  );
}

function PerformanceMetrics() {
  const updateCount = useUpdateCount();
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let animationId: number;

    const measureFps = () => {
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      animationId = requestAnimationFrame(measureFps);
    };

    animationId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="flex items-center gap-4 text-[10px] font-mono">
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-t-fg-muted">FPS:</span>
        <span className="text-t-fg">{fps}</span>
      </div>
      <div>
        <span className="text-t-fg-muted">Updates:</span>
        <span className="text-t-fg ml-1">{updateCount}</span>
      </div>
    </div>
  );
}

export default function LightweightOrderBookDebugPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const { markets, isLoading: marketsLoading } = useMarkets({ status: 'ACTIVE', limit: 50 });
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Get store actions without subscribing to state changes
  const initializeOrderBook = useLightweightOrderBookStore(state => state.initializeOrderBook);
  const simulateTrade = useLightweightOrderBookStore(state => state.simulateTrade);
  const addLiquidity = useLightweightOrderBookStore(state => state.addLiquidity);
  const removeLiquidity = useLightweightOrderBookStore(state => state.removeLiquidity);
  const getOrderBook = useLightweightOrderBookStore(state => state.getOrderBook);
  const getPendingTrades = useLightweightOrderBookStore(state => state.getPendingTrades);
  const reset = useLightweightOrderBookStore(state => state.reset);
  
  const stats = useOrderBookStats(selectedMarket?.symbol || '');
  
  // Track which markets we've already loaded to prevent re-fetching
  const loadedMarketsRef = useRef<Set<string>>(new Set());
  const fetchInProgressRef = useRef<Set<string>>(new Set());

  // Initialize mock order book for testing
  const initializeMockOrderBook = useCallback((symbol: string) => {
    const basePrice = 1.5 + Math.random() * 0.5;
    const levels = 10;

    const bidPrices: number[] = [];
    const bidAmounts: number[] = [];
    const askPrices: number[] = [];
    const askAmounts: number[] = [];

    for (let i = 0; i < levels; i++) {
      const spread = 0.01 + i * 0.005;
      bidPrices.push(basePrice - spread);
      bidAmounts.push(10 + Math.random() * 50);
      askPrices.push(basePrice + spread);
      askAmounts.push(10 + Math.random() * 50);
    }

    initializeOrderBook(symbol, {
      bidPrices,
      bidAmounts,
      askPrices,
      askAmounts,
    }, 'rpc');
  }, [initializeOrderBook]);

  // Auto-select first market
  useEffect(() => {
    if (!selectedMarket && markets.length > 0) {
      setSelectedMarket(markets[0]);
    }
  }, [markets, selectedMarket]);

  // Load order book when market changes (only once per market)
  useEffect(() => {
    if (!selectedMarket?.symbol) return;
    
    const symbol = selectedMarket.symbol;
    
    // Skip if already loaded or fetch in progress
    if (loadedMarketsRef.current.has(symbol) || fetchInProgressRef.current.has(symbol)) {
      return;
    }
    
    // Mark as fetching
    fetchInProgressRef.current.add(symbol);
    
    const loadOrderBookData = async () => {
      setIsInitializing(true);
      try {
        const params = new URLSearchParams({
          symbol,
          levels: '15',
        });

        const resp = await fetch(`/api/orderbook/live?${params.toString()}`);
        if (!resp.ok) {
          console.error(`Failed to load order book for ${symbol}`);
          initializeMockOrderBook(symbol);
          return;
        }

        const json = await resp.json();
        const data = json?.data;

        if (data?.depth) {
          initializeOrderBook(symbol, {
            bidPrices: data.depth.bidPrices || [],
            bidAmounts: data.depth.bidAmounts || [],
            askPrices: data.depth.askPrices || [],
            askAmounts: data.depth.askAmounts || [],
          }, 'api');
        } else {
          initializeMockOrderBook(symbol);
        }
        
        // Mark as loaded only on success
        loadedMarketsRef.current.add(symbol);
      } catch (error) {
        console.error(`Error loading order book for ${symbol}:`, error);
        initializeMockOrderBook(symbol);
        loadedMarketsRef.current.add(symbol);
      } finally {
        fetchInProgressRef.current.delete(symbol);
        setIsInitializing(false);
      }
    };
    
    loadOrderBookData();
  }, [selectedMarket?.symbol, initializeOrderBook, initializeMockOrderBook]);

  const handleTrade = useCallback((
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    price: number,
    amount: number
  ) => {
    if (!selectedMarket) return;

    const result = simulateTrade(selectedMarket.symbol, side, type, price, amount);
    console.log(`[Debug] Trade result:`, result);
  }, [selectedMarket, simulateTrade]);

  const handleAddLiquidity = useCallback(() => {
    if (!selectedMarket || !stats) return;
    const price = stats.bestBid * (0.98 + Math.random() * 0.04);
    const amount = 5 + Math.random() * 20;
    addLiquidity(selectedMarket.symbol, Math.random() > 0.5 ? 'buy' : 'sell', price, amount);
  }, [selectedMarket, stats, addLiquidity]);

  const handleRemoveLiquidity = useCallback(() => {
    if (!selectedMarket) return;
    const ob = getOrderBook(selectedMarket.symbol);
    if (!ob || ob.bids.length === 0) return;
    const level = ob.bids[Math.floor(Math.random() * ob.bids.length)];
    removeLiquidity(selectedMarket.symbol, 'buy', level.price, level.amount * 0.5);
  }, [selectedMarket, getOrderBook, removeLiquidity]);

  const handleBulkTrades = useCallback(async () => {
    if (!selectedMarket || !stats) return;

    const startTime = performance.now();
    const tradeCount = 100;

    for (let i = 0; i < tradeCount; i++) {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const price = side === 'buy' ? stats.bestAsk : stats.bestBid;
      const amount = 0.1 + Math.random() * 0.5;
      simulateTrade(selectedMarket.symbol, side, 'market', price, amount);
    }

    const endTime = performance.now();
    console.log(`[Debug] ${tradeCount} trades in ${(endTime - startTime).toFixed(2)}ms (${((endTime - startTime) / tradeCount).toFixed(3)}ms per trade)`);
  }, [selectedMarket, stats, simulateTrade]);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-t-page p-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-4">
        <div className="rounded-md border border-t-stroke bg-t-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[14px] font-semibold text-t-fg">Lightweight Order Book Debug</h1>
              <p className="text-[11px] text-t-fg-muted mt-1">
                Test fast-acting order book state with optimistic updates
              </p>
            </div>
            <PerformanceMetrics />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={handleAddLiquidity}
              disabled={!selectedMarket}
              className="px-3 py-1.5 text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 disabled:opacity-50 transition-colors"
            >
              + Add Random Liquidity
            </button>
            <button
              onClick={handleRemoveLiquidity}
              disabled={!selectedMarket}
              className="px-3 py-1.5 text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 disabled:opacity-50 transition-colors"
            >
              - Remove Random Liquidity
            </button>
            <button
              onClick={handleBulkTrades}
              disabled={!selectedMarket}
              className="px-3 py-1.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
            >
              Simulate 100 Trades
            </button>
            <button
              onClick={() => {
                reset();
                loadedMarketsRef.current.clear();
              }}
              className="px-3 py-1.5 text-[10px] font-medium bg-t-inset text-t-fg-muted rounded hover:bg-t-card-hover transition-colors"
            >
              Reset All
            </button>
            <a
              href="/debug"
              className="px-3 py-1.5 text-[10px] font-medium bg-t-inset text-t-fg-muted rounded hover:bg-t-card-hover transition-colors"
            >
              ← Back to Debug
            </a>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-4">
        {/* Market list */}
        <div className="col-span-3">
          <div className="rounded-md border border-t-stroke bg-t-card p-3">
            <h2 className="text-[11px] font-medium text-t-fg-muted mb-3">Active Markets</h2>
            {marketsLoading ? (
              <div className="text-[10px] text-t-fg-muted text-center py-4">Loading markets...</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {markets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    isSelected={selectedMarket?.id === market.id}
                    onSelect={() => setSelectedMarket(market)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Order book visual */}
        <div className="col-span-5">
          <div className="rounded-md border border-t-stroke bg-t-card h-[600px] flex flex-col">
            <div className="px-3 py-2 border-b border-t-stroke-sub flex items-center justify-between">
              <h2 className="text-[11px] font-medium text-t-fg">
                Order Book: {selectedMarket?.symbol || 'Select a market'}
              </h2>
              {isInitializing && (
                <span className="text-[9px] text-yellow-400">Loading...</span>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedMarket ? (
                <LightweightOrderBookVisual symbol={selectedMarket.symbol} />
              ) : (
                <div className="flex items-center justify-center h-full text-t-fg-muted text-sm">
                  Select a market to view order book
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trading panel */}
        <div className="col-span-4">
          <div className="rounded-md border border-t-stroke bg-t-card">
            <div className="px-3 py-2 border-b border-t-stroke-sub">
              <h2 className="text-[11px] font-medium text-t-fg">Trading Panel (Simulator)</h2>
              <p className="text-[9px] text-t-fg-muted mt-0.5">
                Place trades to test instant order book updates
              </p>
            </div>
            {selectedMarket && stats ? (
              <TradingPanelSimulator
                symbol={selectedMarket.symbol}
                bestBid={stats.bestBid}
                bestAsk={stats.bestAsk}
                onTrade={handleTrade}
              />
            ) : (
              <div className="p-4 text-center text-t-fg-muted text-sm">
                Select a market to trade
              </div>
            )}
          </div>

          {/* Trade log */}
          <div className="mt-4 rounded-md border border-t-stroke bg-t-card p-3">
            <h2 className="text-[11px] font-medium text-t-fg-muted mb-2">Recent Trades</h2>
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {selectedMarket && getPendingTrades(selectedMarket.symbol).slice(0, 10).map((trade) => (
                <div
                  key={trade.id}
                  className="flex items-center justify-between text-[10px] py-1 px-2 bg-t-inset rounded"
                >
                  <span className={trade.side === 'buy' ? 'text-[#00D084]' : 'text-[#FF4747]'}>
                    {trade.side.toUpperCase()} {formatAmount(trade.amount)}
                  </span>
                  <span className="text-t-fg font-mono">${formatPrice(trade.price)}</span>
                  <span className="text-t-fg-muted">{trade.type}</span>
                </div>
              ))}
              {(!selectedMarket || getPendingTrades(selectedMarket?.symbol || '').length === 0) && (
                <div className="text-[10px] text-t-fg-muted text-center py-2">No trades yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
