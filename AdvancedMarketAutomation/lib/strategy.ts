import { MarketRef, RunConfig, WalletRole } from './stateStore';

export type LiveMarket = {
  orderBookAddress: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  markPrice: number | null;
  depth?: any;
};

export type DecidedAction =
  | { kind: 'SKIP'; reason: string }
  | {
      kind: 'PLACE_LIMIT';
      isBuy: boolean;
      price: number; // float, UI units
      amount: number; // float, UI units
    }
  | {
      kind: 'PLACE_MARKET';
      isBuy: boolean;
      amount: number; // float, UI units
    }
  | {
      kind: 'MODIFY_OLDEST';
      price: number; // float, UI units
      amount: number; // float, UI units
    }
  | { kind: 'CANCEL_ONE'; orderId: bigint };

function randBetween(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function chooseBool(pTrue: number): boolean {
  return Math.random() < pTrue;
}

export function decideNextAction(params: {
  market: MarketRef;
  config: RunConfig;
  role: WalletRole;
  openOrdersCount: number;
  live: LiveMarket;
}): DecidedAction {
  const { market, config, role, openOrdersCount, live } = params;

  const bestBid = live.bestBid ?? null;
  const bestAsk = live.bestAsk ?? null;
  const mid =
    bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : (live.markPrice ?? live.lastTradePrice ?? null);

  const tick = market.tick_size && Number.isFinite(market.tick_size) && market.tick_size! > 0
    ? Number(market.tick_size)
    : 0.01;

  const size = randBetween(config.sizeMin, config.sizeMax);

  if (!mid || mid <= 0) {
    return { kind: 'SKIP', reason: 'No valid mid/mark price yet (no liquidity?)' };
  }

  if (role === 'TAKER') {
    // Takers should not have resting orders; the engine will cancel/skip if needed.
    return {
      kind: 'PLACE_MARKET',
      isBuy: config.mode === 'UP' ? true : config.mode === 'DOWN' ? false : chooseBool(0.5),
      amount: size,
    };
  }

  // MAKER
  if (openOrdersCount >= config.maxOpenOrdersPerMaker) {
    // Engine can cancel the oldest orderId; strategy just signals intent.
    return { kind: 'SKIP', reason: 'maker_max_open_orders' };
  }

  // If we already have one resting order, sometimes prefer modifying it to look more natural.
  // The engine decides which orderId to modify (typically the oldest).
  if (openOrdersCount >= 1) {
    const doModify = chooseBool(0.35);
    if (doModify) {
      const k2 = Math.floor(randBetween(1, 4));
      let p2 = mid;
      // small random drift around mid to avoid repetitive patterns
      p2 = p2 + (chooseBool(0.5) ? 1 : -1) * k2 * tick;
      p2 = clamp(p2, tick, 1e12);
      p2 = Math.round(p2 / tick) * tick;
      return { kind: 'MODIFY_OLDEST', price: p2, amount: size };
    }
  }

  const isBuy = config.mode === 'UP' ? true : config.mode === 'DOWN' ? false : chooseBool(0.5);

  // Place price near spread without crossing:
  // - Buy: at bestBid - k*tick (or mid - k*tick)
  // - Sell: at bestAsk + k*tick (or mid + k*tick)
  const k = Math.floor(randBetween(1, 4)); // 1..3 ticks away
  let price = mid;
  if (isBuy) {
    const anchor = bestBid != null && bestBid > 0 ? bestBid : mid;
    price = anchor - k * tick;
  } else {
    const anchor = bestAsk != null && bestAsk > 0 ? bestAsk : mid;
    price = anchor + k * tick;
  }
  price = clamp(price, tick, 1e12);
  price = Math.round(price / tick) * tick;

  // Ensure no-cross if we have a spread
  if (bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0) {
    if (isBuy && price >= bestAsk) price = bestBid; // fall back to top of book bid
    if (!isBuy && price <= bestBid) price = bestAsk; // fall back to top of book ask
  }

  return { kind: 'PLACE_LIMIT', isBuy, price, amount: size };
}


