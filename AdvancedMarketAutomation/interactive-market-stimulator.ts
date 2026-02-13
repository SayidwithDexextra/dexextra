#!/usr/bin/env tsx
/**
 * interactive-market-stimulator.ts
 *
 * Resumable gasless liquidity packer:
 * - Reads wallets from AdvancedMarketAutomation/wallets.csv
 * - Lists active markets via local Next app (default APP_URL=http://localhost:3000)
 * - Creates session-based gasless sessions for wallets
 * - Packs the order book with lots of non-crossing RESTING orders on both sides
 * - Does NOT place market orders and tries hard to avoid crossing/matching
 * - Caps per-wallet collateral usage (reads CoreVault getAvailableCollateral) to avoid draining wallets
 * - Persists per-market state to AdvancedMarketAutomation/state/<chainId>/<orderBook>/
 *
 * Usage:
 *   tsx AdvancedMarketAutomation/interactive-market-stimulator.ts
 *
 * Options:
 *   --csv <path>           CSV path (default AdvancedMarketAutomation/wallets.csv)
 *   --wallets <n>          Use first N wallets (default 10)
 *
 * Env (from .env.local preferred):
 *   APP_URL=http://localhost:3000
 *   RPC_URL or RPC_URL_HYPEREVM
 *   SESSION_REGISTRY_ADDRESS
 *   CHAIN_ID (or NEXT_PUBLIC_CHAIN_ID)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { Contract, JsonRpcProvider, formatUnits, getAddress } from 'ethers';
import { loadAmaEnv } from './lib/env';
import { loadWalletsFromCsvFile } from './lib/wallets';
import { AmaStateStore, MarketCheckpoint, MarketRef, RunConfig } from './lib/stateStore';
import { fetchActiveMarkets, formatMarketLabel } from './lib/markets';
import { OrderbookChainReader } from './lib/orderbookChain';
import { buildSessionPermit, createGaslessSessionViaApi, fetchRelayerSetRoot, fetchSessionNonce, signSessionPermit } from './lib/gaslessSession';
import { submitSessionTrade } from './lib/gaslessTrade';
import { LiveMarket } from './lib/strategy';

function parseArgs(argv: string[]) {
  const args = {
    csv: 'AdvancedMarketAutomation/wallets.csv',
    wallets: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv' && argv[i + 1]) args.csv = argv[++i];
    else if (a === '--wallets' && argv[i + 1]) args.wallets = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'Interactive Gasless Market Stimulator',
          '',
          'Usage:',
          '  tsx AdvancedMarketAutomation/interactive-market-stimulator.ts',
          '',
          'Options:',
          '  --csv <path>        CSV path (default AdvancedMarketAutomation/wallets.csv)',
          '  --wallets <n>       Use first N wallets (default 100)',
          '',
          'Env:',
          '  APP_URL, RPC_URL (or RPC_URL_HYPEREVM), SESSION_REGISTRY_ADDRESS, CHAIN_ID (or NEXT_PUBLIC_CHAIN_ID)',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.wallets) || args.wallets <= 0) throw new Error('--wallets must be > 0');
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function toPrice6(price: number): bigint {
  return BigInt(Math.round(price * 1_000_000));
}

function toAmount18(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000_000_000_000_000));
}

async function fetchLive(appUrl: string, symbol: string): Promise<LiveMarket> {
  const url = new URL('/api/orderbook/live', appUrl);
  url.searchParams.set('symbol', symbol);
  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();
  if (!res.ok) throw new Error(`GET /api/orderbook/live failed: ${res.status} ${txt}`);
  const json = JSON.parse(txt);
  const data = json?.data || {};
  return {
    orderBookAddress: data?.orderBookAddress ?? null,
    bestBid: data?.bestBid ?? null,
    bestAsk: data?.bestAsk ?? null,
    lastTradePrice: data?.lastTradePrice ?? null,
    markPrice: data?.markPrice ?? null,
    depth: data?.depth ?? null,
  };
}

async function pickMarketInteractively(rl: readline.Interface, markets: MarketRef[]): Promise<MarketRef> {
  if (markets.length === 0) throw new Error('No active markets returned by /api/markets');
  let filtered = markets.slice();
  while (true) {
    console.log('\nActive markets (top 25):');
    filtered.slice(0, 25).forEach((m, i) => console.log(`  [${i}] ${formatMarketLabel(m)}`));
    const q = (await rl.question('\nType search text to filter, or enter index to select: ')).trim();
    if (q === '') continue;
    const maybeIdx = Number(q);
    if (Number.isInteger(maybeIdx) && maybeIdx >= 0 && maybeIdx < filtered.slice(0, 25).length) {
      return filtered[maybeIdx];
    }
    const term = q.toLowerCase();
    filtered = markets.filter((m) => {
      const a = (m.symbol || '').toLowerCase();
      const b = (m.market_identifier || '').toLowerCase();
      const c = (m.market_address || '').toLowerCase();
      return a.includes(term) || b.includes(term) || c.includes(term);
    });
    if (filtered.length === 0) {
      console.log('No matches. Try again.');
      filtered = markets.slice();
    }
  }
}

async function buildConfig(rl: readline.Interface, existing?: RunConfig): Promise<RunConfig> {
  const base: RunConfig =
    existing ?? ({
      // These legacy fields are kept for checkpoint compatibility but are not used by the liquidity packer.
      makerRatio: 0,
      maxOpenOrdersPerMaker: 0,
      minDelayMs: 250,
      maxDelayMs: 1200,
      sizeMin: 0.05,
      sizeMax: 0.25,
      mode: 'MEAN',
    } as RunConfig);

  const minDelayRaw = (await rl.question(`Min delay ms [${base.minDelayMs}]: `)).trim();
  const minDelayMs = minDelayRaw ? Number(minDelayRaw) : base.minDelayMs;

  const maxDelayRaw = (await rl.question(`Max delay ms [${base.maxDelayMs}]: `)).trim();
  const maxDelayMs = maxDelayRaw ? Number(maxDelayRaw) : base.maxDelayMs;

  const sizeMinRaw = (await rl.question(`Order size min (units) [${base.sizeMin}]: `)).trim();
  const sizeMin = sizeMinRaw ? Number(sizeMinRaw) : base.sizeMin;

  const sizeMaxRaw = (await rl.question(`Order size max (units) [${base.sizeMax}]: `)).trim();
  const sizeMax = sizeMaxRaw ? Number(sizeMaxRaw) : base.sizeMax;

  const cfg: RunConfig = {
    makerRatio: base.makerRatio,
    maxOpenOrdersPerMaker: base.maxOpenOrdersPerMaker,
    minDelayMs: Number.isFinite(minDelayMs) && minDelayMs >= 0 ? minDelayMs : base.minDelayMs,
    maxDelayMs: Number.isFinite(maxDelayMs) && maxDelayMs >= minDelayMs ? maxDelayMs : base.maxDelayMs,
    sizeMin: Number.isFinite(sizeMin) && sizeMin > 0 ? sizeMin : base.sizeMin,
    sizeMax: Number.isFinite(sizeMax) && sizeMax >= sizeMin ? sizeMax : base.sizeMax,
    mode: 'MEAN',
  };
  return cfg;
}

function setupKillSwitch(onStop: () => void) {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  try {
    stdin.setRawMode(true);
  } catch {
    return;
  }
  stdin.resume();
  stdin.on('data', (buf) => {
    const s = buf.toString('utf8');
    if (s === 'q' || s === 'Q') onStop();
    // Ctrl+C
    if (buf.length === 1 && buf[0] === 3) onStop();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAmaEnv();

  const rl = readline.createInterface({ input, output });
  const stateStore = new AmaStateStore();
  const chain = new OrderbookChainReader(env.rpcUrl);
  const provider = new JsonRpcProvider(env.rpcUrl);
  const rpcChainId = await chain.getChainId();
  if (rpcChainId !== env.chainId) {
    console.log(`\n[warn] Env chainId=${env.chainId} but RPC reports chainId=${rpcChainId}. Using RPC chainId for signing.\n`);
  }

  const csvPath = path.resolve(process.cwd(), args.csv);
  if (!fs.existsSync(csvPath)) throw new Error(`wallets.csv not found: ${csvPath}`);
  const walletsAll = loadWalletsFromCsvFile(csvPath);
  const wallets = walletsAll.slice(0, args.wallets);
  console.log(`Loaded ${wallets.length} wallets from CSV.`);

  console.log(`Fetching markets from ${env.appUrl} ...`);
  const markets = await fetchActiveMarkets(env.appUrl, 200);
  const market = await pickMarketInteractively(rl, markets);
  console.log(`\nSelected market: ${formatMarketLabel(market)}\n`);

  const chainId = rpcChainId;
  const orderBook = market.market_address;
  const existingCp = stateStore.loadCheckpoint(chainId, orderBook);
  // Widen type: crypto.randomUUID() is a UUID-template type, but checkpoints persist runId as plain string.
  let runId: string = crypto.randomUUID();

  let config: RunConfig;

  if (existingCp) {
    const ans = (await rl.question('Resume existing state for this market? [Y/n]: ')).trim().toLowerCase();
    const resume = ans !== 'n' && ans !== 'no';
    if (resume) {
      config = existingCp.config;
      runId = existingCp.run?.runId || runId;
      console.log('Resuming with prior config + role assignments.');
    } else {
      config = await buildConfig(rl, undefined);
    }
  } else {
    config = await buildConfig(rl, undefined);
  }

  // Reconcile local action journal into derived wallet lastActionAt (helps avoid reusing a wallet too aggressively on resume)
  if (existingCp) {
    const lines = stateStore.readActions(chainId, orderBook, 50000);
    const lastByTrader = new Map<string, number>();
    for (const l of lines) {
      const t = String((l as any)?.trader || '').toLowerCase();
      const ts = Number((l as any)?.ts ?? 0);
      if (!t || !Number.isFinite(ts) || ts <= 0) continue;
      const prev = lastByTrader.get(t) ?? 0;
      if (ts > prev) lastByTrader.set(t, ts);
    }
    // We'll apply these later when we seed cp.wallets.
    (globalThis as any).__amaLastActionByTrader = lastByTrader;
  }

  // Build initial checkpoint
  const cp: MarketCheckpoint = {
    version: 1,
    chainId,
    orderBook,
    market,
    run: { runId, startedAt: nowIso(), updatedAt: nowIso() },
    config,
    wallets: {},
  };

  // Seed wallet checkpoints (no private keys stored)
  for (const w of wallets) {
    const addrLower = w.address.toLowerCase();
    const prev = existingCp?.wallets?.[addrLower] || stateStore.loadWallet(chainId, orderBook, w.address) || null;
    const lastByTrader: Map<string, number> | undefined = (globalThis as any).__amaLastActionByTrader;
    const journalLast = lastByTrader?.get(addrLower);
    cp.wallets[addrLower] = {
      nickname: w.nickname,
      role: 'MAKER', // kept for compatibility with existing checkpoint schema; not used by liquidity packer
      sessionId: prev?.sessionId,
      sessionExpiry: prev?.sessionExpiry,
      lastActionAt: (journalLast && journalLast > 0)
        ? Math.max(journalLast, Number(prev?.lastActionAt ?? 0) || 0)
        : prev?.lastActionAt,
    };
  }

  stateStore.saveCheckpoint(cp);

  // Ensure sessions exist / are not expired (sign-once per wallet)
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionLifetimeSec = 24 * 60 * 60;
  const expiry = nowSec + sessionLifetimeSec;
  const relayerSetRoot = await fetchRelayerSetRoot(env.appUrl);
  for (const w of wallets) {
    const addrLower = w.address.toLowerCase();
    const wcp = cp.wallets[addrLower];
    const stillValid = wcp.sessionId && wcp.sessionExpiry && (nowSec + 60) < wcp.sessionExpiry;
    if (stillValid) continue;

    const nonce = await fetchSessionNonce(env.appUrl, w.address);
    const permit = buildSessionPermit({
      trader: w.address,
      relayerSetRoot,
      expirySec: expiry,
      nonce,
      allowedMarkets: [market.market_id_bytes32 as `0x${string}`],
    });
    const sig = await signSessionPermit({
      privateKey: w.privateKey,
      chainId,
      registryAddress: env.sessionRegistryAddress,
      permit,
    });
    const created = await createGaslessSessionViaApi({
      appUrl: env.appUrl,
      orderBook,
      permit,
      signature: sig,
    });

    wcp.sessionId = created.sessionId;
    wcp.sessionExpiry = expiry;
    wcp.lastActionAt = Date.now();
    stateStore.saveWallet(chainId, orderBook, w.address, wcp);
    stateStore.appendAction({
      ts: Date.now(),
      runId,
      chainId,
      orderBook,
      marketIdBytes32: market.market_id_bytes32,
      trader: w.address,
      nickname: w.nickname,
      role: wcp.role,
      action: 'SESSION_INIT',
      params: { expiry },
      txHash: created.txHash,
    });
    cp.run.updatedAt = nowIso();
    stateStore.saveCheckpoint(cp);
  }

  // Startup rehydrate pass (chain truth) so resume is safe even if local files drifted.
  // (Liquidity packer will not aggressively cancel here; it will only add/cycle to targets.)
  console.log('Rehydrating open orders from chain truth (startup pass)...');
  for (const w of wallets) await chain.getUserOpenOrders(orderBook, w.address);

  console.log('\nSessions ready. Starting stimulator loop. Press q to stop.\n');

  let stopping = false;
  setupKillSwitch(() => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });

  // Liquidity packer parameters (conservative defaults; tuned to avoid depleting wallets)
  async function askNumber(prompt: string, def: number): Promise<number> {
    const raw = (await rl.question(prompt)).trim();
    const n = raw ? Number(raw) : def;
    return Number.isFinite(n) ? n : def;
  }

  const ordersPerSidePerWallet = Math.max(
    1,
    Math.floor(await askNumber('Orders per side per wallet [6]: ', 6))
  );
  const maxWalletUtilization = clamp(
    await askNumber('Max wallet collateral usage fraction 0..1 [0.20]: ', 0.2),
    0.02,
    0.9
  );
  const minDistanceTicks = Math.max(
    1,
    Math.floor(await askNumber('Min distance from mid in ticks (avoid crossing) [10]: ', 10))
  );
  const maxDistanceTicks = Math.max(
    minDistanceTicks,
    Math.floor(await askNumber('Max distance from mid in ticks [120]: ', 120))
  );

  // Resolve vault + marketId from the orderBook so we can read available collateral
  const ob = new Contract(getAddress(orderBook), [
    'function marketStatic() view returns (address vault,bytes32 marketId,bool useVWAP,uint256 vwapWindow)',
    'function getLeverageInfo() view returns (bool enabled,uint256 maxLev,uint256 marginReq,address controller)',
    'function bestBid() view returns (uint256)',
    'function bestAsk() view returns (uint256)',
  ], provider);
  const [vaultAddr, marketId] = (await ob.marketStatic()) as [string, string, boolean, bigint];
  const [, , marginReqBps] = (await ob.getLeverageInfo()) as [boolean, bigint, bigint, string];
  const coreVault = new Contract(
    getAddress(vaultAddr),
    [
      'function getAvailableCollateral(address user) view returns (uint256)',
      'function getMarkPrice(bytes32 marketId) view returns (uint256)',
    ],
    provider
  );
  console.log(`Liquidity packer using vault=${vaultAddr} marketId=${String(marketId).slice(0, 10)}…`);

  function tickSize(): number {
    const t = market.tick_size && Number.isFinite(market.tick_size) && market.tick_size! > 0 ? Number(market.tick_size) : 0.01;
    return t;
  }

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  function toPrice6(price: number): bigint {
    return BigInt(Math.round(price * 1_000_000));
  }

  function toAmount18(amount: number): bigint {
    return BigInt(Math.round(amount * 1_000_000_000_000_000_000));
  }

  function estimateMarginRequired6(params: { price6: bigint; amount18: bigint; isBuy: boolean }): bigint {
    // MetaTradeFacet uses notional6 = amount18 * price6 / 1e18
    const notional6 = (params.amount18 * params.price6) / 1_000_000_000_000_000_000n;
    const bps = params.isBuy ? BigInt(marginReqBps) : 15000n; // matches /api/gasless/trade precheck convention
    return (notional6 * bps) / 10000n;
  }

  function pickNonCrossingPrice(params: {
    mid: number;
    isBuy: boolean;
    walletSeed: number;
    level: number;
    bestBid?: number | null;
    bestAsk?: number | null;
  }): number | null {
    const t = tickSize();
    const span = Math.max(1, maxDistanceTicks - minDistanceTicks);
    // Use a deterministic-ish offset so orders "don't match each other" but remain stable across ticks
    const wobble = (Math.sin((params.walletSeed + 1) * 999 + (params.level + 1) * 1337) + 1) / 2; // 0..1
    const distTicks = minDistanceTicks + Math.floor(wobble * span);
    const raw = params.isBuy ? params.mid - distTicks * t : params.mid + distTicks * t;
    let p = Math.round(raw / t) * t;

    // Hard no-cross guard vs top-of-book when available
    const bb = params.bestBid ?? null;
    const ba = params.bestAsk ?? null;
    const bufferTicks = Math.max(2, Math.floor(minDistanceTicks / 4));
    if (params.isBuy) {
      if (ba && ba > 0) {
        const maxBuy = ba - bufferTicks * t;
        if (maxBuy <= 0) return null;
        p = Math.min(p, maxBuy);
      }
      if (bb && bb > 0) p = Math.min(p, bb); // never become the new best bid above current bb unless spread is empty
    } else {
      if (bb && bb > 0) {
        const minSell = bb + bufferTicks * t;
        p = Math.max(p, minSell);
      }
      if (ba && ba > 0) p = Math.max(p, ba); // never undercut best ask
    }
    p = clamp(p, t, 1e12);
    p = Math.round(p / t) * t;

    // Final non-cross sanity (after rounding/clamp)
    if (params.isBuy && ba && ba > 0 && p >= ba) return null;
    if (!params.isBuy && bb && bb > 0 && p <= bb) return null;
    return p;
  }

  async function ensureWalletPacked(params: {
    wallet: (typeof wallets)[number];
    walletIndex: number;
    live: LiveMarket;
    refMarkPrice: number | null;
  }) {
    const { wallet, walletIndex, live, refMarkPrice } = params;
    const addrLower = wallet.address.toLowerCase();
    const wcp = cp.wallets[addrLower];
    const openOrders = await chain.getUserOpenOrders(orderBook, wallet.address);
    const buyOrders = openOrders.filter((o) => o.isBuy);
    const sellOrders = openOrders.filter((o) => !o.isBuy);

    // Read available collateral (USDC 6 decimals) and cap how much we allow to be reserved by open margin orders.
    const available6 = BigInt(await coreVault.getAvailableCollateral(wallet.address));
    const cap6 = (available6 * BigInt(Math.round(maxWalletUtilization * 10000))) / 10000n;
    const reserved6 = openOrders.reduce((acc, o) => acc + (o.isMarginOrder ? (o.marginRequired ?? 0n) : 0n), 0n);
    let remaining6 = cap6 > reserved6 ? cap6 - reserved6 : 0n;

    // Determine mid + best bid/ask
    const bestBidFloat = typeof live.bestBid === 'number' ? live.bestBid : null;
    const bestAskFloat = typeof live.bestAsk === 'number' ? live.bestAsk : null;
    const bookMid =
      (bestBidFloat && bestAskFloat && bestBidFloat > 0 && bestAskFloat > 0)
        ? (bestBidFloat + bestAskFloat) / 2
        : null;
    // Prefer order book mid when it exists; otherwise anchor around mark (with CoreVault fallback) so
    // we don't place liquidity near an invalid mark like "1".
    const anchor = bookMid ?? refMarkPrice ?? live.lastTradePrice ?? null;
    if (!anchor || anchor <= 0) return;

    const placeOne = async (isBuy: boolean, level: number) => {
      // pick price + amount
      const price = pickNonCrossingPrice({
        mid: anchor,
        isBuy,
        walletSeed: walletIndex,
        level,
        bestBid: bestBidFloat,
        bestAsk: bestAskFloat,
      });
      if (!price) return;
      const price6 = toPrice6(price);

      // jitter size per wallet/level so orders are varied
      const t = (Math.cos((walletIndex + 1) * 123 + (level + 1) * 77) + 1) / 2; // 0..1
      const size = config.sizeMin + (config.sizeMax - config.sizeMin) * t;
      let amount18 = toAmount18(size);

      // Ensure we do not exceed remaining cap; scale down if needed.
      let req6 = estimateMarginRequired6({ price6, amount18, isBuy });
      if (req6 <= 0n) return;
      if (remaining6 <= 0n) return;

      if (req6 > remaining6) {
        // scale amount18 down proportionally, keep a small cushion
        const scaled = (amount18 * remaining6) / req6;
        amount18 = (scaled * 9n) / 10n; // 90% cushion
        // Minimum size guard (avoid dust reverts)
        const minAmount18 = 10_000_000_000_000n; // 1e13 (smaller than 1e12 floor used in API precheck)
        if (amount18 < minAmount18) return;
        req6 = estimateMarginRequired6({ price6, amount18, isBuy });
        if (req6 > remaining6) return;
      }

      // Place as a MARGIN limit order so collateral checks apply
      const tx = await submitSessionTrade({
        appUrl: env.appUrl,
        orderBook,
        method: 'sessionPlaceMarginLimit',
        sessionId: String(wcp.sessionId),
        tradeParams: {
          trader: wallet.address,
          price: price6.toString(),
          amount: amount18.toString(),
          isBuy,
        },
      });

      stateStore.appendAction({
        ts: Date.now(),
        runId,
        chainId,
        orderBook,
        marketIdBytes32: market.market_id_bytes32,
        trader: wallet.address,
        nickname: wallet.nickname,
        role: 'MAKER',
        action: 'PLACE_LIMIT',
        params: {
          // human-friendly debug
          isBuy,
          price,
          amount: Number(formatUnits(amount18, 18)),
          estMarginRequired: Number(formatUnits(req6, 6)),
        },
        txHash: tx.txHash,
      });

      remaining6 = remaining6 - req6;
      wcp.lastActionAt = Date.now();
      stateStore.saveWallet(chainId, orderBook, wallet.address, wcp);
      cp.run.updatedAt = nowIso();
      stateStore.saveCheckpoint(cp);
    };

    // If too many orders already, cancel oldest to keep churn and avoid runaway collateral lock.
    const maxPerSide = Math.max(ordersPerSidePerWallet, 1);
    const hardMax = maxPerSide * 2;
    if (buyOrders.length > hardMax || sellOrders.length > hardMax) {
      const all = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp));
      const toCancel = all.slice(0, Math.max(1, all.length - (hardMax * 2)));
      for (const o of toCancel) {
        try {
          const tx = await submitSessionTrade({
            appUrl: env.appUrl,
            orderBook,
            method: 'sessionCancelOrder',
            sessionId: String(wcp.sessionId),
            tradeParams: { trader: wallet.address, orderId: o.orderId.toString() },
          });
          stateStore.appendAction({
            ts: Date.now(),
            runId,
            chainId,
            orderBook,
            marketIdBytes32: market.market_id_bytes32,
            trader: wallet.address,
            nickname: wallet.nickname,
            role: 'MAKER',
            action: 'CANCEL_ORDER',
            params: { orderId: o.orderId.toString(), reason: 'hardmax_churn' },
            txHash: tx.txHash,
          });
        } catch (e: any) {
          stateStore.appendAction({
            ts: Date.now(),
            runId,
            chainId,
            orderBook,
            marketIdBytes32: market.market_id_bytes32,
            trader: wallet.address,
            nickname: wallet.nickname,
            role: 'MAKER',
            action: 'ERROR',
            error: `cancel failed: ${e?.message || String(e)}`,
          });
        }
      }
    }

    // Place missing buys then sells to reach the target per side.
    const needBuys = Math.max(0, maxPerSide - buyOrders.length);
    const needSells = Math.max(0, maxPerSide - sellOrders.length);

    for (let i = 0; i < needBuys; i++) await placeOne(true, i);
    for (let i = 0; i < needSells; i++) await placeOne(false, i);

    // Print a compact per-wallet status line occasionally
    const a = Number(formatUnits(available6, 6));
    const r = Number(formatUnits(reserved6, 6));
    const c = Number(formatUnits(cap6, 6));
    console.log(
      `[${wallet.nickname || `User${walletIndex + 1}`}] buys=${buyOrders.length} sells=${sellOrders.length} avail=${a.toFixed(2)} cap=${c.toFixed(2)} reserved=${r.toFixed(2)}`
    );
  }

  while (!stopping) {
    const delay = randInt(config.minDelayMs, config.maxDelayMs);
    try {
      const live = await fetchLive(env.appUrl, market.symbol);
      // Reference mark price for placing liquidity:
      // - Prefer orderbook mark (from /api/orderbook/live)
      // - If it's 1 (known bad/default) or otherwise invalid, fall back to CoreVault.getMarkPrice(marketId)
      const obMark = typeof live.markPrice === 'number' ? live.markPrice : null;
      const obMarkLooksBad = obMark !== null && Math.abs(obMark - 1) < 1e-9;
      let refMarkPrice: number | null = (obMark && obMark > 0 && !obMarkLooksBad) ? obMark : null;
      if (!refMarkPrice) {
        try {
          const cvMark6 = BigInt(await coreVault.getMarkPrice(marketId as any));
          const cvMark = Number(formatUnits(cvMark6, 6));
          if (Number.isFinite(cvMark) && cvMark > 0) refMarkPrice = cvMark;
        } catch {
          // keep null; we'll fall back to bid/ask mid or lastTrade inside ensureWalletPacked
        }
      }

      // Pack the book: attempt to top each wallet up to the target per side without crossing or overusing collateral.
      for (let i = 0; i < wallets.length && !stopping; i++) {
        await ensureWalletPacked({ wallet: wallets[i], walletIndex: i, live, refMarkPrice });
        // tiny pause between wallets to avoid bursting relayer/RPC too hard
        await sleep(25);
      }
    } catch (e: any) {
      stateStore.appendAction({
        ts: Date.now(),
        runId,
        chainId,
        orderBook,
        marketIdBytes32: market.market_id_bytes32,
        trader: 'unknown',
        action: 'ERROR',
        error: e?.message || String(e),
      });
      // back off slightly on repeated errors
      await sleep(Math.max(500, delay));
    }

    await sleep(delay);
  }

  cp.run.updatedAt = nowIso();
  stateStore.saveCheckpoint(cp);
  rl.close();
  console.log('\nStopped. State checkpoint saved.\n');
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});


