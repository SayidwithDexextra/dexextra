'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface OrderBookLevel {
  price: number;
  amount: number;
  total: number; // cumulative
}

export interface LightweightOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  lastUpdated: number;
  snapshotSource: 'api' | 'rpc' | 'optimistic';
}

export interface PendingTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number;
  amount: number;
  timestamp: number;
  status: 'pending' | 'filled' | 'cancelled' | 'reconciled';
  // Track what we optimistically predicted vs actual
  optimisticFilledAmount?: number;
  optimisticFilledPrice?: number;
  // Actual fill data from blockchain
  actualFilledAmount?: number;
  actualFilledPrice?: number;
  txHash?: string;
}

export interface ConfirmedFill {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  txHash?: string;
  orderId?: string;
  timestamp: number;
}

interface LightweightOrderBookState {
  orderBooks: Map<string, LightweightOrderBook>;
  pendingTrades: Map<string, PendingTrade>;
  updateCount: number;
  lastUpdateTimestamp: number;

  // Actions
  initializeOrderBook: (symbol: string, depth: {
    bidPrices: number[];
    bidAmounts: number[];
    askPrices: number[];
    askAmounts: number[];
  }, source?: 'api' | 'rpc') => void;

  // Optimistic update: simulate a trade hitting the book
  simulateTrade: (
    symbol: string,
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    price: number,
    amount: number
  ) => { filledPrice: number; filledAmount: number; priceImpact: number };

  // Add liquidity (limit order resting on book)
  addLiquidity: (symbol: string, side: 'buy' | 'sell', price: number, amount: number) => void;

  // Remove liquidity (cancel order)
  removeLiquidity: (symbol: string, side: 'buy' | 'sell', price: number, amount: number) => void;

  // Get order book for a symbol
  getOrderBook: (symbol: string) => LightweightOrderBook | undefined;

  // Clear all state
  reset: () => void;

  // Get pending trades for a symbol
  getPendingTrades: (symbol: string) => PendingTrade[];

  // Mark trade as filled
  markTradeFilled: (tradeId: string) => void;
  
  // Reconcile with confirmed fill from blockchain
  // This adjusts the order book if the actual fill differs from our optimistic prediction
  reconcileConfirmedFill: (fill: ConfirmedFill) => void;
  
  // Apply a confirmed fill that we didn't optimistically predict
  // (e.g., from another user's trade or external event)
  applyExternalFill: (fill: ConfirmedFill) => void;
  
  // Clean up old pending trades that are stale (no confirmation within timeout)
  cleanupStaleTrades: (maxAgeMs?: number) => void;
}

const EMPTY_ORDER_BOOK: LightweightOrderBook = {
  symbol: '',
  bids: [],
  asks: [],
  bestBid: 0,
  bestAsk: 0,
  spread: 0,
  spreadPercent: 0,
  lastUpdated: 0,
  snapshotSource: 'api',
};

function buildLevels(prices: number[], amounts: number[], descending: boolean): OrderBookLevel[] {
  const levels: OrderBookLevel[] = [];
  let cumulative = 0;

  const pairs = prices.map((p, i) => ({ price: p, amount: amounts[i] || 0 }))
    .filter(p => p.price > 0 && p.amount > 0);

  if (descending) {
    pairs.sort((a, b) => b.price - a.price);
  } else {
    pairs.sort((a, b) => a.price - b.price);
  }

  for (const { price, amount } of pairs) {
    cumulative += amount;
    levels.push({ price, amount, total: cumulative });
  }

  return levels;
}

function recalculateTotals(levels: OrderBookLevel[]): OrderBookLevel[] {
  // Filter out levels with zero or near-zero amounts before recalculating
  const filtered = levels.filter(level => level.amount > 0.00000001);
  let cumulative = 0;
  return filtered.map(level => {
    cumulative += level.amount;
    return { ...level, total: cumulative };
  });
}

function calculateSpread(bestBid: number, bestAsk: number): { spread: number; spreadPercent: number } {
  if (bestBid <= 0 || bestAsk <= 0) {
    return { spread: 0, spreadPercent: 0 };
  }
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;
  return { spread, spreadPercent };
}

export const useLightweightOrderBookStore = create<LightweightOrderBookState>()(
  subscribeWithSelector((set, get) => ({
    orderBooks: new Map(),
    pendingTrades: new Map(),
    updateCount: 0,
    lastUpdateTimestamp: 0,

    initializeOrderBook: (symbol, depth, source = 'api') => {
      const normalizedSymbol = symbol.toUpperCase();

      // Build bid levels (descending by price - best bid first)
      const bids = buildLevels(depth.bidPrices, depth.bidAmounts, true);

      // Build ask levels (ascending by price - best ask first)
      const asks = buildLevels(depth.askPrices, depth.askAmounts, false);

      const bestBid = bids.length > 0 ? bids[0].price : 0;
      const bestAsk = asks.length > 0 ? asks[0].price : 0;
      const { spread, spreadPercent } = calculateSpread(bestBid, bestAsk);

      const orderBook: LightweightOrderBook = {
        symbol: normalizedSymbol,
        bids,
        asks,
        bestBid,
        bestAsk,
        spread,
        spreadPercent,
        lastUpdated: Date.now(),
        snapshotSource: source,
      };

      set(state => {
        const newOrderBooks = new Map(state.orderBooks);
        newOrderBooks.set(normalizedSymbol, orderBook);
        return {
          orderBooks: newOrderBooks,
          updateCount: state.updateCount + 1,
          lastUpdateTimestamp: Date.now(),
        };
      });

      console.log(`[LightweightOB] Initialized ${normalizedSymbol}: ${bids.length} bids, ${asks.length} asks, spread: ${spread.toFixed(4)} (${spreadPercent.toFixed(2)}%)`);
    },

    simulateTrade: (symbol, side, type, price, amount) => {
      const startTime = Date.now();
      const normalizedSymbol = symbol.toUpperCase();
      
      // Sanity check: prices should be reasonable human values
      if (price > 100000 || price <= 0 || amount <= 0) {
        console.warn(`[LightweightOB] Skipping simulateTrade with invalid values: price=${price}, amount=${amount}`);
        return { filledPrice: price, filledAmount: 0, priceImpact: 0 };
      }
      
      const state = get();
      let orderBook = state.orderBooks.get(normalizedSymbol);
      console.log(`[LightweightOB] simulateTrade START: ${normalizedSymbol} ${side} ${type} ${amount}@${price}`);

      // If no order book exists, create an empty one so limit orders can still rest
      if (!orderBook) {
        console.log(`[LightweightOB] No order book for ${normalizedSymbol}, creating empty one`);
        orderBook = {
          symbol: normalizedSymbol,
          bids: [],
          asks: [],
          bestBid: 0,
          bestAsk: 0,
          spread: 0,
          spreadPercent: 0,
          lastUpdated: Date.now(),
          snapshotSource: 'optimistic',
        };
        // Store it immediately
        set(s => {
          const newOrderBooks = new Map(s.orderBooks);
          newOrderBooks.set(normalizedSymbol, orderBook!);
          return { orderBooks: newOrderBooks };
        });
      }

      const tradeId = `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let filledAmount = 0;
      let totalCost = 0;
      let remainingAmount = amount;

      // Clone the levels we'll modify
      let levels = side === 'buy'
        ? [...orderBook.asks]
        : [...orderBook.bids];

      const newLevels: OrderBookLevel[] = [];

      // Walk through levels and consume liquidity
      for (const level of levels) {
        if (remainingAmount <= 0) {
          newLevels.push(level);
          continue;
        }

        // For limit orders, check price constraints
        if (type === 'limit') {
          if (side === 'buy' && level.price > price) {
            newLevels.push(level);
            continue;
          }
          if (side === 'sell' && level.price < price) {
            newLevels.push(level);
            continue;
          }
        }

        const fillAtLevel = Math.min(remainingAmount, level.amount);
        filledAmount += fillAtLevel;
        totalCost += fillAtLevel * level.price;
        remainingAmount -= fillAtLevel;

        if (level.amount > fillAtLevel) {
          // Partial fill - reduce level
          newLevels.push({
            price: level.price,
            amount: level.amount - fillAtLevel,
            total: 0, // will recalculate
          });
        }
        // If fully consumed, don't add to newLevels
      }

      // Calculate average fill price and price impact
      const avgFillPrice = filledAmount > 0 ? totalCost / filledAmount : price;
      const referencePrice = side === 'buy' ? orderBook.bestAsk : orderBook.bestBid;
      const priceImpact = referencePrice > 0
        ? Math.abs((avgFillPrice - referencePrice) / referencePrice) * 100
        : 0;

      // Recalculate totals for the consumed side
      const updatedLevels = recalculateTotals(newLevels);

      // Prepare the new bids and asks
      let finalBids = side === 'buy' ? orderBook.bids : updatedLevels;
      let finalAsks = side === 'buy' ? updatedLevels : orderBook.asks;

      // For limit orders with remaining amount, add to the resting side (same side as order)
      // A BUY limit that doesn't fully cross rests as a bid
      // A SELL limit that doesn't fully cross rests as an ask
      if (type === 'limit' && remainingAmount > 0) {
        if (side === 'buy') {
          // Add resting buy order to bids
          const restingBids = [...finalBids];
          const existingIdx = restingBids.findIndex(l => Math.abs(l.price - price) < 0.000001);
          if (existingIdx >= 0) {
            restingBids[existingIdx] = {
              ...restingBids[existingIdx],
              amount: restingBids[existingIdx].amount + remainingAmount,
            };
          } else {
            restingBids.push({ price, amount: remainingAmount, total: 0 });
          }
          restingBids.sort((a, b) => b.price - a.price); // Bids sorted highest first
          finalBids = recalculateTotals(restingBids);
        } else {
          // Add resting sell order to asks
          const restingAsks = [...finalAsks];
          const existingIdx = restingAsks.findIndex(l => Math.abs(l.price - price) < 0.000001);
          if (existingIdx >= 0) {
            restingAsks[existingIdx] = {
              ...restingAsks[existingIdx],
              amount: restingAsks[existingIdx].amount + remainingAmount,
            };
          } else {
            restingAsks.push({ price, amount: remainingAmount, total: 0 });
          }
          restingAsks.sort((a, b) => a.price - b.price); // Asks sorted lowest first
          finalAsks = recalculateTotals(restingAsks);
        }
      }

      set(state => {
        const newOrderBooks = new Map(state.orderBooks);
        const currentOB = newOrderBooks.get(normalizedSymbol)!;

        const newBids = finalBids;
        const newAsks = finalAsks;

        const newBestBid = newBids.length > 0 ? newBids[0].price : 0;
        const newBestAsk = newAsks.length > 0 ? newAsks[0].price : 0;
        const { spread, spreadPercent } = calculateSpread(newBestBid, newBestAsk);

        newOrderBooks.set(normalizedSymbol, {
          ...currentOB,
          bids: newBids,
          asks: newAsks,
          bestBid: newBestBid,
          bestAsk: newBestAsk,
          spread,
          spreadPercent,
          lastUpdated: Date.now(),
          snapshotSource: 'optimistic',
        });

        // Add pending trade with optimistic prediction for later reconciliation
        const newPendingTrades = new Map(state.pendingTrades);
        newPendingTrades.set(tradeId, {
          id: tradeId,
          symbol: normalizedSymbol,
          side,
          type,
          price: avgFillPrice,
          amount: filledAmount,
          timestamp: Date.now(),
          status: 'pending',
          optimisticFilledAmount: filledAmount,
          optimisticFilledPrice: avgFillPrice,
        });

        return {
          orderBooks: newOrderBooks,
          pendingTrades: newPendingTrades,
          updateCount: state.updateCount + 1,
          lastUpdateTimestamp: Date.now(),
        };
      });

      // Get updated state for logging
      const updatedOB = get().orderBooks.get(normalizedSymbol);
      const updateCount = get().updateCount;
      const elapsedMs = Date.now() - startTime;
      console.log(`[LightweightOB] Trade simulated in ${elapsedMs}ms: ${side.toUpperCase()} ${filledAmount.toFixed(4)} @ avg ${avgFillPrice.toFixed(4)}, impact: ${priceImpact.toFixed(2)}%`, {
        requestedAmount: amount,
        filledAmount,
        updateCount,
        elapsedMs,
        remainingAmount,
        originalLevelsCount: levels.length,
        newLevelsCount: updatedLevels.length,
        bidsCount: updatedOB?.bids.length,
        asksCount: updatedOB?.asks.length,
      });

      // Dispatch event to help debug React update timing
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lightweightOBUpdated', {
          detail: { symbol: normalizedSymbol, updateCount, timestamp: Date.now() }
        }));
      }

      return { filledPrice: avgFillPrice, filledAmount, priceImpact };
    },

    addLiquidity: (symbol, side, price, amount) => {
      const normalizedSymbol = symbol.toUpperCase();
      
      // Sanity check: prices should be reasonable human values
      if (price > 100000 || price <= 0 || amount <= 0) {
        console.warn(`[LightweightOB] Skipping addLiquidity with invalid values: price=${price}, amount=${amount}`);
        return;
      }

      set(state => {
        const newOrderBooks = new Map(state.orderBooks);
        let orderBook = newOrderBooks.get(normalizedSymbol);

        // Create empty order book if it doesn't exist
        if (!orderBook) {
          orderBook = {
            symbol: normalizedSymbol,
            bids: [],
            asks: [],
            bestBid: 0,
            bestAsk: 0,
            spread: 0,
            spreadPercent: 0,
            lastUpdated: Date.now(),
            snapshotSource: 'optimistic',
          };
        }

        const levels = side === 'buy' ? [...orderBook.bids] : [...orderBook.asks];

        // Find existing level or insert new one
        const existingIdx = levels.findIndex(l => Math.abs(l.price - price) < 0.000001);
        if (existingIdx >= 0) {
          levels[existingIdx] = {
            ...levels[existingIdx],
            amount: levels[existingIdx].amount + amount,
          };
        } else {
          levels.push({ price, amount, total: 0 });
        }

        // Re-sort
        if (side === 'buy') {
          levels.sort((a, b) => b.price - a.price);
        } else {
          levels.sort((a, b) => a.price - b.price);
        }

        const updatedLevels = recalculateTotals(levels);

        let newBids = orderBook.bids;
        let newAsks = orderBook.asks;

        if (side === 'buy') {
          newBids = updatedLevels;
        } else {
          newAsks = updatedLevels;
        }

        const newBestBid = newBids.length > 0 ? newBids[0].price : 0;
        const newBestAsk = newAsks.length > 0 ? newAsks[0].price : 0;
        const { spread, spreadPercent } = calculateSpread(newBestBid, newBestAsk);

        newOrderBooks.set(normalizedSymbol, {
          ...orderBook,
          bids: newBids,
          asks: newAsks,
          bestBid: newBestBid,
          bestAsk: newBestAsk,
          spread,
          spreadPercent,
          lastUpdated: Date.now(),
          snapshotSource: 'optimistic',
        });

        return {
          orderBooks: newOrderBooks,
          updateCount: state.updateCount + 1,
          lastUpdateTimestamp: Date.now(),
        };
      });

      console.log(`[LightweightOB] Added liquidity: ${side.toUpperCase()} ${amount.toFixed(4)} @ ${price.toFixed(4)}`);
    },

    removeLiquidity: (symbol, side, price, amount) => {
      const normalizedSymbol = symbol.toUpperCase();
      
      // Sanity check: prices should be reasonable human values
      if (price > 100000 || price <= 0 || amount <= 0) {
        console.warn(`[LightweightOB] Skipping removeLiquidity with invalid values: price=${price}, amount=${amount}`);
        return;
      }

      set(state => {
        const newOrderBooks = new Map(state.orderBooks);
        const orderBook = newOrderBooks.get(normalizedSymbol);

        if (!orderBook) {
          console.warn(`[LightweightOB] No order book for ${normalizedSymbol}`);
          return state;
        }

        let levels = side === 'buy' ? [...orderBook.bids] : [...orderBook.asks];

        // Find and reduce or remove the level
        const existingIdx = levels.findIndex(l => Math.abs(l.price - price) < 0.000001);
        if (existingIdx >= 0) {
          const newAmount = levels[existingIdx].amount - amount;
          if (newAmount <= 0.00000001) {
            levels.splice(existingIdx, 1);
          } else {
            levels[existingIdx] = {
              ...levels[existingIdx],
              amount: newAmount,
            };
          }
        }

        const updatedLevels = recalculateTotals(levels);

        let newBids = orderBook.bids;
        let newAsks = orderBook.asks;

        if (side === 'buy') {
          newBids = updatedLevels;
        } else {
          newAsks = updatedLevels;
        }

        const newBestBid = newBids.length > 0 ? newBids[0].price : 0;
        const newBestAsk = newAsks.length > 0 ? newAsks[0].price : 0;
        const { spread, spreadPercent } = calculateSpread(newBestBid, newBestAsk);

        newOrderBooks.set(normalizedSymbol, {
          ...orderBook,
          bids: newBids,
          asks: newAsks,
          bestBid: newBestBid,
          bestAsk: newBestAsk,
          spread,
          spreadPercent,
          lastUpdated: Date.now(),
          snapshotSource: 'optimistic',
        });

        return {
          orderBooks: newOrderBooks,
          updateCount: state.updateCount + 1,
          lastUpdateTimestamp: Date.now(),
        };
      });

      console.log(`[LightweightOB] Removed liquidity: ${side.toUpperCase()} ${amount.toFixed(4)} @ ${price.toFixed(4)}`);
    },

    getOrderBook: (symbol) => {
      return get().orderBooks.get(symbol.toUpperCase());
    },

    getPendingTrades: (symbol) => {
      const normalizedSymbol = symbol.toUpperCase();
      const trades: PendingTrade[] = [];
      get().pendingTrades.forEach((trade) => {
        if (trade.symbol === normalizedSymbol) {
          trades.push(trade);
        }
      });
      return trades.sort((a, b) => b.timestamp - a.timestamp);
    },

    markTradeFilled: (tradeId) => {
      set(state => {
        const newPendingTrades = new Map(state.pendingTrades);
        const trade = newPendingTrades.get(tradeId);
        if (trade) {
          newPendingTrades.set(tradeId, { ...trade, status: 'filled' });
        }
        return { pendingTrades: newPendingTrades };
      });
    },
    
    reconcileConfirmedFill: (fill: ConfirmedFill) => {
      const normalizedSymbol = fill.symbol.toUpperCase();
      const state = get();
      
      // Find a matching pending trade to reconcile with
      // Match by: symbol, side, and approximate price/amount (within 5% tolerance)
      let matchingTradeId: string | null = null;
      let matchingTrade: PendingTrade | null = null;
      
      state.pendingTrades.forEach((trade, id) => {
        if (trade.symbol !== normalizedSymbol) return;
        if (trade.side !== fill.side) return;
        if (trade.status !== 'pending') return;
        
        // Check if this trade is recent enough (within 60 seconds)
        const ageMs = Date.now() - trade.timestamp;
        if (ageMs > 60_000) return;
        
        // Check price tolerance (within 5%)
        const priceDiff = Math.abs(trade.price - fill.price) / Math.max(trade.price, fill.price);
        if (priceDiff > 0.05) return;
        
        // Check amount tolerance (within 20% - fills can be partial)
        const amountDiff = Math.abs(trade.amount - fill.amount) / Math.max(trade.amount, fill.amount);
        if (amountDiff > 0.20) return;
        
        // Found a match
        if (!matchingTrade || trade.timestamp > matchingTrade.timestamp) {
          matchingTradeId = id;
          matchingTrade = trade;
        }
      });
      
      if (matchingTrade && matchingTradeId) {
        // We found a matching optimistic trade - reconcile it
        const optimisticAmount = matchingTrade.amount;
        const actualAmount = fill.amount;
        const amountDifference = actualAmount - optimisticAmount;
        
        console.log(`[LightweightOB] Reconciling fill: optimistic=${optimisticAmount.toFixed(4)}, actual=${actualAmount.toFixed(4)}, diff=${amountDifference.toFixed(4)}`);
        
        set(state => {
          const newPendingTrades = new Map(state.pendingTrades);
          newPendingTrades.set(matchingTradeId!, {
            ...matchingTrade!,
            status: 'reconciled',
            actualFilledAmount: fill.amount,
            actualFilledPrice: fill.price,
            txHash: fill.txHash,
          });
          
          // If there's a significant difference, adjust the order book
          if (Math.abs(amountDifference) > 0.0001) {
            const newOrderBooks = new Map(state.orderBooks);
            const orderBook = newOrderBooks.get(normalizedSymbol);
            
            if (orderBook) {
              // If actual fill was LESS than optimistic, we removed too much - add back
              // If actual fill was MORE than optimistic, we didn't remove enough - remove more
              const adjustSide = fill.side === 'buy' ? 'asks' : 'bids';
              let levels = adjustSide === 'bids' ? [...orderBook.bids] : [...orderBook.asks];
              
              if (amountDifference < 0) {
                // We over-consumed - add liquidity back at the fill price
                const addAmount = Math.abs(amountDifference);
                const existingIdx = levels.findIndex(l => Math.abs(l.price - fill.price) < 0.000001);
                if (existingIdx >= 0) {
                  levels[existingIdx] = {
                    ...levels[existingIdx],
                    amount: levels[existingIdx].amount + addAmount,
                  };
                } else {
                  levels.push({ price: fill.price, amount: addAmount, total: 0 });
                }
                // Re-sort
                if (adjustSide === 'bids') {
                  levels.sort((a, b) => b.price - a.price);
                } else {
                  levels.sort((a, b) => a.price - b.price);
                }
                console.log(`[LightweightOB] Reconcile: adding back ${addAmount.toFixed(4)} @ ${fill.price.toFixed(4)} (over-consumed)`);
              } else if (amountDifference > 0) {
                // We under-consumed - remove more liquidity
                const removeAmount = amountDifference;
                const existingIdx = levels.findIndex(l => Math.abs(l.price - fill.price) < 0.000001);
                if (existingIdx >= 0) {
                  const newAmount = levels[existingIdx].amount - removeAmount;
                  if (newAmount <= 0.00000001) {
                    levels.splice(existingIdx, 1);
                  } else {
                    levels[existingIdx] = { ...levels[existingIdx], amount: newAmount };
                  }
                }
                console.log(`[LightweightOB] Reconcile: removing ${removeAmount.toFixed(4)} @ ${fill.price.toFixed(4)} (under-consumed)`);
              }
              
              const updatedLevels = recalculateTotals(levels);
              const newBids = adjustSide === 'bids' ? updatedLevels : orderBook.bids;
              const newAsks = adjustSide === 'asks' ? updatedLevels : orderBook.asks;
              const newBestBid = newBids.length > 0 ? newBids[0].price : 0;
              const newBestAsk = newAsks.length > 0 ? newAsks[0].price : 0;
              const { spread, spreadPercent } = calculateSpread(newBestBid, newBestAsk);
              
              newOrderBooks.set(normalizedSymbol, {
                ...orderBook,
                bids: newBids,
                asks: newAsks,
                bestBid: newBestBid,
                bestAsk: newBestAsk,
                spread,
                spreadPercent,
                lastUpdated: Date.now(),
                snapshotSource: 'optimistic',
              });
              
              return {
                orderBooks: newOrderBooks,
                pendingTrades: newPendingTrades,
                updateCount: state.updateCount + 1,
                lastUpdateTimestamp: Date.now(),
              };
            }
          }
          
          return {
            pendingTrades: newPendingTrades,
            updateCount: state.updateCount + 1,
            lastUpdateTimestamp: Date.now(),
          };
        });
      } else {
        // No matching optimistic trade - this is an external fill, apply it directly
        console.log(`[LightweightOB] No matching optimistic trade for fill, applying as external`);
        get().applyExternalFill(fill);
      }
    },
    
    applyExternalFill: (fill: ConfirmedFill) => {
      const normalizedSymbol = fill.symbol.toUpperCase();
      
      // Sanity check
      if (fill.price > 100000 || fill.price <= 0 || fill.amount <= 0) {
        console.warn(`[LightweightOB] Skipping external fill with invalid values:`, fill);
        return;
      }
      
      set(state => {
        const newOrderBooks = new Map(state.orderBooks);
        const orderBook = newOrderBooks.get(normalizedSymbol);
        
        if (!orderBook) {
          console.warn(`[LightweightOB] No order book for external fill: ${normalizedSymbol}`);
          return state;
        }
        
        // A fill consumes liquidity from the opposite side
        // Buy fill consumes asks, sell fill consumes bids
        const consumeSide = fill.side === 'buy' ? 'asks' : 'bids';
        let levels = consumeSide === 'bids' ? [...orderBook.bids] : [...orderBook.asks];
        
        // Find and reduce liquidity at or near the fill price
        let remainingAmount = fill.amount;
        const newLevels: OrderBookLevel[] = [];
        
        for (const level of levels) {
          if (remainingAmount <= 0) {
            newLevels.push(level);
            continue;
          }
          
          // Only consume from levels at or better than the fill price
          const isConsumable = fill.side === 'buy'
            ? level.price <= fill.price * 1.001  // Buy consumes asks at or below fill price
            : level.price >= fill.price * 0.999; // Sell consumes bids at or above fill price
          
          if (!isConsumable) {
            newLevels.push(level);
            continue;
          }
          
          const consumeAtLevel = Math.min(remainingAmount, level.amount);
          remainingAmount -= consumeAtLevel;
          
          if (level.amount > consumeAtLevel) {
            newLevels.push({
              price: level.price,
              amount: level.amount - consumeAtLevel,
              total: 0,
            });
          }
        }
        
        const updatedLevels = recalculateTotals(newLevels);
        const newBids = consumeSide === 'bids' ? updatedLevels : orderBook.bids;
        const newAsks = consumeSide === 'asks' ? updatedLevels : orderBook.asks;
        const newBestBid = newBids.length > 0 ? newBids[0].price : 0;
        const newBestAsk = newAsks.length > 0 ? newAsks[0].price : 0;
        const { spread, spreadPercent } = calculateSpread(newBestBid, newBestAsk);
        
        newOrderBooks.set(normalizedSymbol, {
          ...orderBook,
          bids: newBids,
          asks: newAsks,
          bestBid: newBestBid,
          bestAsk: newBestAsk,
          spread,
          spreadPercent,
          lastUpdated: Date.now(),
          snapshotSource: 'optimistic',
        });
        
        console.log(`[LightweightOB] Applied external fill: ${fill.side.toUpperCase()} ${fill.amount.toFixed(4)} @ ${fill.price.toFixed(4)}`);
        
        return {
          orderBooks: newOrderBooks,
          updateCount: state.updateCount + 1,
          lastUpdateTimestamp: Date.now(),
        };
      });
    },
    
    cleanupStaleTrades: (maxAgeMs = 120_000) => {
      const now = Date.now();
      set(state => {
        const newPendingTrades = new Map(state.pendingTrades);
        let cleaned = 0;
        
        newPendingTrades.forEach((trade, id) => {
          const age = now - trade.timestamp;
          if (age > maxAgeMs && trade.status === 'pending') {
            // Mark as stale/cancelled rather than deleting
            newPendingTrades.set(id, { ...trade, status: 'cancelled' });
            cleaned++;
          }
          // Remove very old trades (> 5 minutes) entirely
          if (age > 300_000) {
            newPendingTrades.delete(id);
            cleaned++;
          }
        });
        
        if (cleaned > 0) {
          console.log(`[LightweightOB] Cleaned up ${cleaned} stale trades`);
          return { pendingTrades: newPendingTrades };
        }
        return state;
      });
    },

    reset: () => {
      set({
        orderBooks: new Map(),
        pendingTrades: new Map(),
        updateCount: 0,
        lastUpdateTimestamp: 0,
      });
    },
  }))
);

// Selector hooks for efficient re-renders
export const useOrderBook = (symbol: string) => {
  const normalizedSymbol = symbol?.toUpperCase() || '';
  return useLightweightOrderBookStore(
    state => state.orderBooks.get(normalizedSymbol),
    // Use shallow equality for the OrderBook object
    (a, b) => a === b
  );
};

// Stats cache to avoid creating new objects on every render
const statsCache = new Map<string, {
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  bidCount: number;
  askCount: number;
  lastUpdated: number;
  snapshotSource: 'api' | 'rpc' | 'optimistic';
} | null>();

export const useOrderBookStats = (symbol: string) => {
  const normalizedSymbol = symbol?.toUpperCase() || '';
  
  return useLightweightOrderBookStore(
    state => {
      const ob = state.orderBooks.get(normalizedSymbol);
      if (!ob) {
        const cached = statsCache.get(normalizedSymbol);
        if (cached === null) return null;
        statsCache.set(normalizedSymbol, null);
        return null;
      }
      
      // Check if we can reuse cached stats
      const cached = statsCache.get(normalizedSymbol);
      if (
        cached &&
        cached.bestBid === ob.bestBid &&
        cached.bestAsk === ob.bestAsk &&
        cached.spread === ob.spread &&
        cached.spreadPercent === ob.spreadPercent &&
        cached.bidCount === ob.bids.length &&
        cached.askCount === ob.asks.length &&
        cached.lastUpdated === ob.lastUpdated &&
        cached.snapshotSource === ob.snapshotSource
      ) {
        return cached;
      }
      
      // Create new stats object and cache it
      const stats = {
        bestBid: ob.bestBid,
        bestAsk: ob.bestAsk,
        spread: ob.spread,
        spreadPercent: ob.spreadPercent,
        bidCount: ob.bids.length,
        askCount: ob.asks.length,
        lastUpdated: ob.lastUpdated,
        snapshotSource: ob.snapshotSource,
      };
      statsCache.set(normalizedSymbol, stats);
      return stats;
    },
    // Shallow equality - if the cached object is returned, it will be === 
    (a, b) => a === b
  );
};

export const useUpdateCount = () => {
  return useLightweightOrderBookStore(state => state.updateCount);
};

// Expose store globally for debugging/testing in browser console
if (typeof window !== 'undefined') {
  (window as any).__lightweightOrderBookStore = useLightweightOrderBookStore;
  (window as any).__testOptimisticTrade = (symbol: string, side: 'buy' | 'sell', amount: number) => {
    const store = useLightweightOrderBookStore.getState();
    const ob = store.orderBooks.get(symbol.toUpperCase());
    if (!ob) {
      console.error('No order book for', symbol);
      return;
    }
    const price = side === 'buy' ? ob.bestAsk : ob.bestBid;
    console.log(`[TEST] Simulating ${side} trade: ${amount} @ ${price}`);
    const result = store.simulateTrade(symbol, side, 'market', price, amount);
    console.log('[TEST] Trade result:', result);
    return result;
  };
  console.log('[LightweightOB] Debug functions exposed: window.__lightweightOrderBookStore, window.__testOptimisticTrade(symbol, side, amount)');
}
