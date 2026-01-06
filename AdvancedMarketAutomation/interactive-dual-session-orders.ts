#!/usr/bin/env tsx
/**
 * interactive-dual-session-orders.ts
 *
 * Purpose:
 *   Fire **two gasless session trades at (almost) the exact same time**
 *   from **two different trader wallets**, so you can observe how the
 *   multi-relayer routing behaves under concurrent load.
 *
 * What this script does:
 *   - Loads core gasless env (APP_URL, RPC_URL[_HYPEREVM], CHAIN_ID, SESSION_REGISTRY_ADDRESS)
 *   - Loads trader private keys from `.env.local`:
 *       - PRIVATE_KEY_USERD
 *       - PRIVATE_KEY_USER2
 *       - PRIVATE_KEY_USER3
 *       - PRIVATE_KEY_USER4
 *   - Lets you interactively:
 *       - Pick which two traders to use
 *       - Pick an active market from `/api/markets`
 *       - Configure side (BUY/SELL), order type (LIMIT/MARKET) and size/price
 *   - Creates a **SessionPermitV2** for each trader via `/api/gasless/session/init`
 *     (using the same `relayerSetRoot` that the frontend uses)
 *   - Once both sessions are ready, sends two `sessionPlace*` trades via
 *     `/api/gasless/trade` using `Promise.all` so they hit the backend together.
 *
 * Requirements:
 *   - `.env.local` (or `.env`) configured with:
 *       APP_URL
 *       RPC_URL or RPC_URL_HYPEREVM
 *       SESSION_REGISTRY_ADDRESS
 *       CHAIN_ID or NEXT_PUBLIC_CHAIN_ID
 *       PRIVATE_KEY_USERD / PRIVATE_KEY_USER2 / PRIVATE_KEY_USER3 / PRIVATE_KEY_USER4
 *   - The Next app running at APP_URL (e.g. `npm run dev` on http://localhost:3000)
 *
 * Usage:
 *   tsx AdvancedMarketAutomation/interactive-dual-session-orders.ts
 */

import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { Wallet, TypedDataDomain, ethers } from 'ethers';

import { loadAmaEnv } from './lib/env';
import { fetchActiveMarkets, formatMarketLabel } from './lib/markets';
import { submitSessionTrade as submitSessionTradeApi } from './lib/gaslessTrade';

type Hex = `0x${string}`;

type TraderWallet = {
  label: string;
  envKey: string;
  privateKey: string;
  address: string;
};

type OrderKind = 'LIMIT' | 'MARKET';
type Side = 'BUY' | 'SELL';

type MarketRef = Awaited<ReturnType<typeof fetchActiveMarkets>>[number];

function nowIso() {
  return new Date().toISOString();
}

function toPrice6(price: number): bigint {
  return BigInt(Math.round(price * 1_000_000));
}

function toAmount18(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000_000_000_000_000));
}

function randomBytes32(): Hex {
  return (`0x${crypto.randomBytes(32).toString('hex')}`) as Hex;
}

function defaultMethodsBitmap(): Hex {
  // bits 0..5 set (placeLimit, placeMarginLimit, placeMarket, placeMarginMarket, modify, cancel)
  const v = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n) | (1n << 5n);
  return (`0x${v.toString(16).padStart(64, '0')}`) as Hex;
}

async function fetchRelayerSet(appUrl: string): Promise<{ relayerSetRoot: Hex; relayerAddresses: string[] }> {
  const url = new URL('/api/gasless/session/relayer-set', appUrl);
  const res = await fetch(url.toString(), { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /api/gasless/session/relayer-set failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text);
  const root = String(json?.relayerSetRoot || '').trim();
  if (!root || !/^0x[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error(`Invalid relayerSetRoot from /api/gasless/session/relayer-set: ${root || '(empty)'}`);
  }
  const addrs = Array.isArray(json?.relayerAddresses) ? json.relayerAddresses.map((a: any) => String(a || '').trim()).filter(Boolean) : [];
  return { relayerSetRoot: root as Hex, relayerAddresses: addrs };
}

async function fetchRegistryNonce(appUrl: string, trader: string): Promise<bigint> {
  const url = new URL('/api/gasless/session/nonce', appUrl);
  url.searchParams.set('trader', trader);
  const res = await fetch(url.toString(), { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /api/gasless/session/nonce failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text);
  return BigInt(json?.nonce ?? 0);
}

async function createSessionForTrader(opts: {
  appUrl: string;
  rpcUrl: string;
  registryAddress: string;
  chainIdEnv: number;
  traderWallet: TraderWallet;
  relayerSetRoot: Hex;
  allowedMarkets: Hex[];
  sessionLifetimeSec?: number;
  orderBook?: string;
}): Promise<{ sessionId: Hex; txHash?: string; expirySec: number }> {
  const {
    appUrl,
    rpcUrl,
    registryAddress,
    chainIdEnv,
    traderWallet,
    relayerSetRoot,
    allowedMarkets,
    sessionLifetimeSec,
    orderBook,
  } = opts;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== chainIdEnv) {
    console.log(
      `[dual-sessions] Warning: CHAIN_ID=${chainIdEnv} but RPC network chainId=${chainId}. Using RPC chainId for signing.`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const defaultLifetime = Number(process.env.NEXT_PUBLIC_SESSION_DEFAULT_LIFETIME_SECS ?? 86400);
  const lifetime = Number.isFinite(sessionLifetimeSec ?? 0) && (sessionLifetimeSec ?? 0) > 0
    ? (sessionLifetimeSec as number)
    : defaultLifetime;
  const expirySec = now + lifetime;

  const nonce = await fetchRegistryNonce(appUrl, traderWallet.address);
  const sessionSalt = randomBytes32();
  const bitmap = defaultMethodsBitmap();

  const permit = {
    trader: traderWallet.address,
    relayerSetRoot,
    expiry: expirySec.toString(),
    maxNotionalPerTrade: '0',
    maxNotionalPerSession: '0',
    methodsBitmap: bitmap,
    sessionSalt,
    allowedMarkets,
    nonce: nonce.toString(),
  };

  const domain: TypedDataDomain = {
    name: 'DexetraMeta',
    version: '1',
    chainId,
    verifyingContract: registryAddress,
  };

  const types = {
    SessionPermit: [
      { name: 'trader', type: 'address' },
      { name: 'relayerSetRoot', type: 'bytes32' },
      { name: 'expiry', type: 'uint256' },
      { name: 'maxNotionalPerTrade', type: 'uint256' },
      { name: 'maxNotionalPerSession', type: 'uint256' },
      { name: 'methodsBitmap', type: 'bytes32' },
      { name: 'sessionSalt', type: 'bytes32' },
      { name: 'allowedMarkets', type: 'bytes32[]' },
      { name: 'nonce', type: 'uint256' },
    ],
  } as const;

  const wallet = new Wallet(traderWallet.privateKey);
  const signature = await wallet.signTypedData(domain, types as any, permit as any);

  const url = new URL('/api/gasless/session/init', appUrl);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderBook, permit, signature }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /api/gasless/session/init failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text);
  const sessionId = String(json?.sessionId || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
    throw new Error(`Session init succeeded but returned invalid sessionId: ${sessionId || '(empty)'}`);
  }
  return {
    sessionId: sessionId as Hex,
    txHash: json?.txHash ? String(json.txHash) : undefined,
    expirySec,
  };
}

async function pickMarketInteractively(rl: readline.Interface, markets: MarketRef[]): Promise<MarketRef> {
  if (markets.length === 0) throw new Error('No active markets returned by /api/markets');
  let filtered = markets.slice();
  while (true) {
    console.log('\nActive markets (top 20):');
    filtered.slice(0, 20).forEach((m, i) => console.log(`  [${i}] ${formatMarketLabel(m)}`));
    const q = (await rl.question('\nType search text to filter, or enter index to select: ')).trim();
    if (q === '') continue;
    const maybeIdx = Number(q);
    if (Number.isInteger(maybeIdx) && maybeIdx >= 0 && maybeIdx < filtered.slice(0, 20).length) {
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

async function loadTraderWalletsFromEnv(): Promise<TraderWallet[]> {
  const candidates: { label: string; envKey: string }[] = [
    { label: 'UserD', envKey: 'PRIVATE_KEY_USERD' },
    { label: 'User2', envKey: 'PRIVATE_KEY_USER2' },
    { label: 'User3', envKey: 'PRIVATE_KEY_USER3' },
    { label: 'User4', envKey: 'PRIVATE_KEY_USER4' },
  ];
  const out: TraderWallet[] = [];
  for (const c of candidates) {
    const pk = (process.env[c.envKey] || '').trim();
    if (!pk) continue;
    try {
      const w = new Wallet(pk);
      out.push({
        label: c.label,
        envKey: c.envKey,
        privateKey: pk,
        address: w.address,
      });
    } catch {
      console.warn(`[dual-sessions] Skipping ${c.envKey}: invalid private key`);
    }
  }
  return out;
}

async function pickTwoTradersInteractively(rl: readline.Interface, traders: TraderWallet[]): Promise<[TraderWallet, TraderWallet]> {
  if (traders.length < 2) {
    throw new Error('Need at least two trader private keys set in .env.local (PRIVATE_KEY_USERD, PRIVATE_KEY_USER2, PRIVATE_KEY_USER3, PRIVATE_KEY_USER4).');
  }
  console.log('\nAvailable trader wallets (from .env.local):');
  traders.forEach((t, i) => {
    console.log(`  [${i}] ${t.label}  env=${t.envKey}  address=${t.address}`);
  });

  const askIndex = async (prompt: string, max: number, defaultIdx: number): Promise<number> => {
    while (true) {
      const raw = (await rl.question(`${prompt} [${defaultIdx}]: `)).trim();
      const idx = raw === '' ? defaultIdx : Number(raw);
      if (Number.isInteger(idx) && idx >= 0 && idx < max) return idx;
      console.log(`Please enter an integer between 0 and ${max - 1}.`);
    }
  };

  const firstIdx = await askIndex('Select FIRST trader index', traders.length, 0);
  let secondIdx = await askIndex('Select SECOND trader index', traders.length, 1);
  while (secondIdx === firstIdx) {
    console.log('Second trader must be different from first.');
    secondIdx = await askIndex('Select SECOND trader index', traders.length, (firstIdx + 1) % traders.length);
  }
  return [traders[firstIdx], traders[secondIdx]];
}

async function askOrderConfig(rl: readline.Interface): Promise<{ kind: OrderKind; side: Side; size: number; price?: number }> {
  const sideRaw = (await rl.question('Side? (BUY/SELL) [BUY]: ')).trim().toUpperCase();
  const side: Side = sideRaw === 'SELL' ? 'SELL' : 'BUY';

  const kindRaw = (await rl.question('Order type? (LIMIT/MARKET) [LIMIT]: ')).trim().toUpperCase();
  const kind: OrderKind = kindRaw === 'MARKET' ? 'MARKET' : 'LIMIT';

  const sizeRaw = (await rl.question('Order size (in units, e.g. 0.1): ')).trim();
  const size = Number(sizeRaw || '0');
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Order size must be > 0');
  }

  let price: number | undefined;
  if (kind === 'LIMIT') {
    const priceRaw = (await rl.question('Limit price (e.g. 100.25): ')).trim();
    price = Number(priceRaw || '0');
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Limit price must be > 0');
    }
  }

  return { kind, side, size, price };
}

async function main() {
  console.log('[dual-sessions] Starting interactive dual-session order tool at', nowIso());

  const env = loadAmaEnv();
  const chainIdEnv = env.chainId;

  const rl = readline.createInterface({ input, output });

  try {
    const traders = await loadTraderWalletsFromEnv();
    const [t1, t2] = await pickTwoTradersInteractively(rl, traders);
    console.log(`\nSelected traders:\n  1) ${t1.label} (${t1.address}) from ${t1.envKey}\n  2) ${t2.label} (${t2.address}) from ${t2.envKey}\n`);

    console.log(`Fetching active markets from ${env.appUrl} ...`);
    const markets = await fetchActiveMarkets(env.appUrl, 200);
    const market = await pickMarketInteractively(rl, markets);
    console.log(`\nSelected market: ${formatMarketLabel(market)}\n`);

    const orderCfg = await askOrderConfig(rl);
    console.log('\nOrder config:');
    console.log(`  Kind: ${orderCfg.kind}`);
    console.log(`  Side: ${orderCfg.side}`);
    console.log(`  Size: ${orderCfg.size}`);
    if (orderCfg.kind === 'LIMIT') console.log(`  Price: ${orderCfg.price}`);

    console.log('\nFetching relayer set and building sessions for both traders...');
    const relayerSet = await fetchRelayerSet(env.appUrl);
    console.log(`[dual-sessions] relayerSetRoot=${relayerSet.relayerSetRoot}`);

    const allowedMarkets: Hex[] = [market.market_id_bytes32 as Hex];

    const [s1, s2] = await Promise.all([
      createSessionForTrader({
        appUrl: env.appUrl,
        rpcUrl: env.rpcUrl,
        registryAddress: env.sessionRegistryAddress,
        chainIdEnv,
        traderWallet: t1,
        relayerSetRoot: relayerSet.relayerSetRoot,
        allowedMarkets,
        orderBook: market.market_address,
      }),
      createSessionForTrader({
        appUrl: env.appUrl,
        rpcUrl: env.rpcUrl,
        registryAddress: env.sessionRegistryAddress,
        chainIdEnv,
        traderWallet: t2,
        relayerSetRoot: relayerSet.relayerSetRoot,
        allowedMarkets,
        orderBook: market.market_address,
      }),
    ]);

    console.log('\nSessions created:');
    console.log(`  ${t1.label}: sessionId=${s1.sessionId}, expiresAt=${new Date(s1.expirySec * 1000).toISOString()}, txHash=${s1.txHash || '(pending)'}`);
    console.log(`  ${t2.label}: sessionId=${s2.sessionId}, expiresAt=${new Date(s2.expirySec * 1000).toISOString()}, txHash=${s2.txHash || '(pending)'}`);

    await rl.question('\nPress Enter to fire BOTH orders at the same time...');

    const isBuy = orderCfg.side === 'BUY';
    const amountWei = toAmount18(orderCfg.size);
    const priceWei = orderCfg.kind === 'LIMIT' ? toPrice6(orderCfg.price as number) : 0n;

    const method = orderCfg.kind === 'LIMIT' ? 'sessionPlaceLimit' : 'sessionPlaceMarket';

    console.log(`\n[dual-sessions] Sending two ${method} trades concurrently via /api/gasless/trade ...`);

    const sendTrade = (trader: TraderWallet, sessionId: Hex) =>
      submitSessionTradeApi({
        appUrl: env.appUrl,
        orderBook: market.market_address,
        method,
        sessionId: String(sessionId),
        tradeParams:
          method === 'sessionPlaceLimit'
            ? {
                trader: trader.address,
                price: priceWei.toString(),
                amount: amountWei.toString(),
                isBuy,
              }
            : {
                trader: trader.address,
                amount: amountWei.toString(),
                isBuy,
              },
      });

    const [tx1, tx2] = await Promise.all([sendTrade(t1, s1.sessionId), sendTrade(t2, s2.sessionId)]);

    console.log('\nTrades submitted:');
    console.log(`  ${t1.label}: txHash=${tx1.txHash}`);
    console.log(`  ${t2.label}: txHash=${tx2.txHash}`);
    console.log('\nDone. You can inspect relayer logs / metrics to confirm multi-key behavior.');
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('[dual-sessions] Fatal error:', e?.stack || e?.message || String(e));
  process.exit(1);
});


