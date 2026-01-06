#!/usr/bin/env tsx
/**
 * interactive-market-stimulator.ts
 *
 * Resumable gasless market stimulator:
 * - Reads wallets from AdvancedMarketAutomation/wallets.csv
 * - Lists active markets via local Next app (default APP_URL=http://localhost:3000)
 * - Creates session-based gasless sessions for wallets
 * - Runs a maker/taker loop to simulate organic order flow
 * - Persists per-market state to AdvancedMarketAutomation/state/<chainId>/<orderBook>/
 *
 * Usage:
 *   tsx AdvancedMarketAutomation/interactive-market-stimulator.ts
 *
 * Options:
 *   --csv <path>           CSV path (default AdvancedMarketAutomation/wallets.csv)
 *   --wallets <n>          Use first N wallets (default 100)
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

import { loadAmaEnv } from './lib/env';
import { loadWalletsFromCsvFile } from './lib/wallets';
import { AmaStateStore, MarketCheckpoint, MarketRef, RunConfig, WalletRole } from './lib/stateStore';
import { fetchActiveMarkets, formatMarketLabel } from './lib/markets';
import { OrderbookChainReader } from './lib/orderbookChain';
import { buildSessionPermit, createGaslessSessionViaApi, fetchSessionNonce, signSessionPermit } from './lib/gaslessSession';
import { submitSessionTrade } from './lib/gaslessTrade';
import { decideNextAction, LiveMarket } from './lib/strategy';

function parseArgs(argv: string[]) {
  const args = {
    csv: 'AdvancedMarketAutomation/wallets.csv',
    wallets: 100,
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

async function pickMode(rl: readline.Interface): Promise<RunConfig['mode']> {
  const raw = (await rl.question('Mode? (MEAN/UP/DOWN) [MEAN]: ')).trim().toUpperCase();
  if (raw === 'UP') return 'UP';
  if (raw === 'DOWN') return 'DOWN';
  return 'MEAN';
}

async function buildConfig(rl: readline.Interface, existing?: RunConfig): Promise<RunConfig> {
  const base: RunConfig =
    existing ?? ({
      makerRatio: 0.7,
      maxOpenOrdersPerMaker: 4,
      minDelayMs: 250,
      maxDelayMs: 1200,
      sizeMin: 0.05,
      sizeMax: 0.25,
      mode: 'MEAN',
    } as RunConfig);

  const mode = await pickMode(rl);

  const makerRatioRaw = (await rl.question(`Maker ratio 0..1 [${base.makerRatio}]: `)).trim();
  const makerRatio = makerRatioRaw ? Number(makerRatioRaw) : base.makerRatio;

  const maxOpenRaw = (await rl.question(`Max open orders per maker [${base.maxOpenOrdersPerMaker}]: `)).trim();
  const maxOpenOrdersPerMaker = maxOpenRaw ? Number(maxOpenRaw) : base.maxOpenOrdersPerMaker;

  const minDelayRaw = (await rl.question(`Min delay ms [${base.minDelayMs}]: `)).trim();
  const minDelayMs = minDelayRaw ? Number(minDelayRaw) : base.minDelayMs;

  const maxDelayRaw = (await rl.question(`Max delay ms [${base.maxDelayMs}]: `)).trim();
  const maxDelayMs = maxDelayRaw ? Number(maxDelayRaw) : base.maxDelayMs;

  const sizeMinRaw = (await rl.question(`Order size min (units) [${base.sizeMin}]: `)).trim();
  const sizeMin = sizeMinRaw ? Number(sizeMinRaw) : base.sizeMin;

  const sizeMaxRaw = (await rl.question(`Order size max (units) [${base.sizeMax}]: `)).trim();
  const sizeMax = sizeMaxRaw ? Number(sizeMaxRaw) : base.sizeMax;

  const cfg: RunConfig = {
    makerRatio: Number.isFinite(makerRatio) ? Math.max(0, Math.min(1, makerRatio)) : base.makerRatio,
    maxOpenOrdersPerMaker: Number.isFinite(maxOpenOrdersPerMaker) && maxOpenOrdersPerMaker > 0 ? maxOpenOrdersPerMaker : base.maxOpenOrdersPerMaker,
    minDelayMs: Number.isFinite(minDelayMs) && minDelayMs >= 0 ? minDelayMs : base.minDelayMs,
    maxDelayMs: Number.isFinite(maxDelayMs) && maxDelayMs >= minDelayMs ? maxDelayMs : base.maxDelayMs,
    sizeMin: Number.isFinite(sizeMin) && sizeMin > 0 ? sizeMin : base.sizeMin,
    sizeMax: Number.isFinite(sizeMax) && sizeMax >= sizeMin ? sizeMax : base.sizeMax,
    mode,
  };
  return cfg;
}

function assignRoles(addresses: string[], makerRatio: number): Record<string, WalletRole> {
  const shuffled = addresses.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const makerCount = Math.floor(shuffled.length * makerRatio);
  const roles: Record<string, WalletRole> = {};
  shuffled.forEach((a, idx) => (roles[a.toLowerCase()] = idx < makerCount ? 'MAKER' : 'TAKER'));
  return roles;
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
  let runId = crypto.randomUUID();

  let config: RunConfig;
  let roles: Record<string, WalletRole> = {};

  if (existingCp) {
    const ans = (await rl.question('Resume existing state for this market? [Y/n]: ')).trim().toLowerCase();
    const resume = ans !== 'n' && ans !== 'no';
    if (resume) {
      config = existingCp.config;
      runId = existingCp.run?.runId || runId;
      roles = Object.fromEntries(Object.entries(existingCp.wallets || {}).map(([a, w]) => [a.toLowerCase(), w.role]));
      console.log('Resuming with prior config + role assignments.');
    } else {
      config = await buildConfig(rl, undefined);
    }
  } else {
    config = await buildConfig(rl, undefined);
  }

  if (Object.keys(roles).length === 0) {
    roles = assignRoles(wallets.map((w) => w.address), config.makerRatio);
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
    const role = roles[addrLower] || 'MAKER';
    const lastByTrader: Map<string, number> | undefined = (globalThis as any).__amaLastActionByTrader;
    const journalLast = lastByTrader?.get(addrLower);
    cp.wallets[addrLower] = {
      nickname: w.nickname,
      role,
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
  for (const w of wallets) {
    const addrLower = w.address.toLowerCase();
    const wcp = cp.wallets[addrLower];
    const stillValid = wcp.sessionId && wcp.sessionExpiry && (nowSec + 60) < wcp.sessionExpiry;
    if (stillValid) continue;

    const nonce = await fetchSessionNonce(env.appUrl, w.address);
    const permit = buildSessionPermit({
      trader: w.address,
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
  // We also opportunistically clean up takers (they should have no resting orders).
  console.log('Rehydrating open orders from chain truth (startup pass)...');
  for (const w of wallets) {
    const addrLower = w.address.toLowerCase();
    const wcp = cp.wallets[addrLower];
    const role = wcp.role;
    const openOrders = await chain.getUserOpenOrders(orderBook, w.address);
    if (role === 'TAKER' && openOrders.length > 0) {
      // Cancel oldest to ensure takers don't accidentally have resting orders on resume.
      const oldest = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp))[0];
      try {
        const tx = await submitSessionTrade({
          appUrl: env.appUrl,
          orderBook,
          method: 'sessionCancelOrder',
          sessionId: String(wcp.sessionId),
          tradeParams: { trader: w.address, orderId: oldest.orderId.toString() },
        });
        stateStore.appendAction({
          ts: Date.now(),
          runId,
          chainId,
          orderBook,
          marketIdBytes32: market.market_id_bytes32,
          trader: w.address,
          nickname: w.nickname,
          role,
          action: 'CANCEL_ORDER',
          params: { orderId: oldest.orderId.toString(), reason: 'startup_taker_cleanup' },
          txHash: tx.txHash,
        });
      } catch (e: any) {
        stateStore.appendAction({
          ts: Date.now(),
          runId,
          chainId,
          orderBook,
          marketIdBytes32: market.market_id_bytes32,
          trader: w.address,
          nickname: w.nickname,
          role,
          action: 'ERROR',
          error: `startup cleanup failed: ${e?.message || String(e)}`,
        });
      }
    }
  }

  console.log('\nSessions ready. Starting stimulator loop. Press q to stop.\n');

  let stopping = false;
  setupKillSwitch(() => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });

  const makers = wallets.filter((w) => cp.wallets[w.address.toLowerCase()]?.role === 'MAKER');
  const takers = wallets.filter((w) => cp.wallets[w.address.toLowerCase()]?.role === 'TAKER');

  function pickWalletForTick(): { wallet: (typeof wallets)[number]; role: WalletRole } {
    // Weighted selection: pick maker with makerRatio, otherwise taker
    const wantMaker = Math.random() < config.makerRatio;
    const arr = wantMaker && makers.length ? makers : takers.length ? takers : makers;
    const chosen = arr[randInt(0, arr.length - 1)];
    const role = cp.wallets[chosen.address.toLowerCase()].role;
    return { wallet: chosen, role };
  }

  while (!stopping) {
    const delay = randInt(config.minDelayMs, config.maxDelayMs);
    try {
      const live = await fetchLive(env.appUrl, market.symbol);
      const { wallet, role } = pickWalletForTick();
      const addrLower = wallet.address.toLowerCase();
      const wcp = cp.wallets[addrLower];

      // Always refresh open orders for chosen wallet from chain truth (prevents mistakes on resume)
      const openOrders = await chain.getUserOpenOrders(orderBook, wallet.address);

      // Guardrail: takers must have no resting orders
      if (role === 'TAKER' && openOrders.length > 0) {
        // Cancel oldest to clean state, then continue
        const oldest = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp))[0];
        const tx = await submitSessionTrade({
          appUrl: env.appUrl,
          orderBook,
          method: 'sessionCancelOrder',
          sessionId: String(wcp.sessionId),
          tradeParams: { trader: wallet.address, orderId: oldest.orderId.toString() },
        });
        stateStore.appendAction({
          ts: Date.now(),
          runId,
          chainId,
          orderBook,
          marketIdBytes32: market.market_id_bytes32,
          trader: wallet.address,
          nickname: wallet.nickname,
          role,
          action: 'CANCEL_ORDER',
          params: { orderId: oldest.orderId.toString(), reason: 'taker_cleanup' },
          txHash: tx.txHash,
        });
        wcp.lastActionAt = Date.now();
        stateStore.saveWallet(chainId, orderBook, wallet.address, wcp);
        cp.run.updatedAt = nowIso();
        stateStore.saveCheckpoint(cp);
        await sleep(delay);
        continue;
      }

      // Guardrail: makers should not have both sides open (avoid messy state)
      if (role === 'MAKER' && openOrders.length > 1) {
        const hasBuy = openOrders.some((o) => o.isBuy);
        const hasSell = openOrders.some((o) => !o.isBuy);
        if (hasBuy && hasSell) {
          const oldest = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp))[0];
          const tx = await submitSessionTrade({
            appUrl: env.appUrl,
            orderBook,
            method: 'sessionCancelOrder',
            sessionId: String(wcp.sessionId),
            tradeParams: { trader: wallet.address, orderId: oldest.orderId.toString() },
          });
          stateStore.appendAction({
            ts: Date.now(),
            runId,
            chainId,
            orderBook,
            marketIdBytes32: market.market_id_bytes32,
            trader: wallet.address,
            nickname: wallet.nickname,
            role,
            action: 'CANCEL_ORDER',
            params: { orderId: oldest.orderId.toString(), reason: 'maker_one_sided_enforced' },
            txHash: tx.txHash,
          });
          wcp.lastActionAt = Date.now();
          stateStore.saveWallet(chainId, orderBook, wallet.address, wcp);
          cp.run.updatedAt = nowIso();
          stateStore.saveCheckpoint(cp);
          await sleep(delay);
          continue;
        }
      }

      // If maker is at max open orders, cancel oldest to create churn
      if (role === 'MAKER' && openOrders.length >= config.maxOpenOrdersPerMaker) {
        const oldest = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp))[0];
        const tx = await submitSessionTrade({
          appUrl: env.appUrl,
          orderBook,
          method: 'sessionCancelOrder',
          sessionId: String(wcp.sessionId),
          tradeParams: { trader: wallet.address, orderId: oldest.orderId.toString() },
        });
        stateStore.appendAction({
          ts: Date.now(),
          runId,
          chainId,
          orderBook,
          marketIdBytes32: market.market_id_bytes32,
          trader: wallet.address,
          nickname: wallet.nickname,
          role,
          action: 'CANCEL_ORDER',
          params: { orderId: oldest.orderId.toString(), reason: 'maker_max_open_cancel' },
          txHash: tx.txHash,
        });
        wcp.lastActionAt = Date.now();
        stateStore.saveWallet(chainId, orderBook, wallet.address, wcp);
        cp.run.updatedAt = nowIso();
        stateStore.saveCheckpoint(cp);
        await sleep(delay);
        continue;
      }

      const decision = decideNextAction({
        market,
        config,
        role,
        openOrdersCount: openOrders.length,
        live: live as any,
      });

      if (decision.kind === 'SKIP') {
        stateStore.appendAction({
          ts: Date.now(),
          runId,
          chainId,
          orderBook,
          marketIdBytes32: market.market_id_bytes32,
          trader: wallet.address,
          nickname: wallet.nickname,
          role,
          action: 'SKIP',
          params: { reason: decision.reason },
        });
        await sleep(delay);
        continue;
      }

      if (decision.kind === 'PLACE_LIMIT') {
        const priceWei = toPrice6(decision.price);
        const amountWei = toAmount18(decision.amount);
        const tx = await submitSessionTrade({
          appUrl: env.appUrl,
          orderBook,
          method: 'sessionPlaceLimit',
          sessionId: String(wcp.sessionId),
          tradeParams: {
            trader: wallet.address,
            price: priceWei.toString(),
            amount: amountWei.toString(),
            isBuy: decision.isBuy,
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
          role,
          action: 'PLACE_LIMIT',
          params: { price: decision.price, amount: decision.amount, isBuy: decision.isBuy },
          txHash: tx.txHash,
        });
      } else if (decision.kind === 'PLACE_MARKET') {
        const amountWei = toAmount18(decision.amount);
        const tx = await submitSessionTrade({
          appUrl: env.appUrl,
          orderBook,
          method: 'sessionPlaceMarket',
          sessionId: String(wcp.sessionId),
          tradeParams: {
            trader: wallet.address,
            amount: amountWei.toString(),
            isBuy: decision.isBuy,
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
          role,
          action: 'PLACE_MARKET',
          params: { amount: decision.amount, isBuy: decision.isBuy },
          txHash: tx.txHash,
        });
      } else if (decision.kind === 'MODIFY_OLDEST') {
        if (openOrders.length === 0) {
          stateStore.appendAction({
            ts: Date.now(),
            runId,
            chainId,
            orderBook,
            marketIdBytes32: market.market_id_bytes32,
            trader: wallet.address,
            nickname: wallet.nickname,
            role,
            action: 'SKIP',
            params: { reason: 'modify_no_open_orders' },
          });
        } else {
          const oldest = openOrders.slice().sort((a, b) => Number(a.timestamp - b.timestamp))[0];
          const priceWei = toPrice6(decision.price);
          const amountWei = toAmount18(decision.amount);
          const tx = await submitSessionTrade({
            appUrl: env.appUrl,
            orderBook,
            method: 'sessionModifyOrder',
            sessionId: String(wcp.sessionId),
            tradeParams: {
              trader: wallet.address,
              orderId: oldest.orderId.toString(),
              price: priceWei.toString(),
              amount: amountWei.toString(),
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
            role,
            action: 'MODIFY_ORDER',
            params: {
              orderId: oldest.orderId.toString(),
              price: decision.price,
              amount: decision.amount,
            },
            txHash: tx.txHash,
          });
        }
      }

      wcp.lastActionAt = Date.now();
      stateStore.saveWallet(chainId, orderBook, wallet.address, wcp);
      cp.run.updatedAt = nowIso();
      stateStore.saveCheckpoint(cp);
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


