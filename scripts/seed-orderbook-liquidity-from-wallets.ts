import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

type WalletRow = {
  nickname: string;
  address: string;
  privateKey: string;
};

type MarketRow = {
  id: string;
  metric_id?: string | null;
  market_identifier?: string | null;
  symbol?: string | null;
  category: string | null;
  chain_id: number | null;
  network: string | null;
  deployment_status: string | null;
  market_address: string | null;
  central_vault_address?: string | null;
  market_id_bytes32?: string | null;
  created_at: string | null;
};

type Args = {
  rpcUrl?: string;
  orderBook?: string;
  marketFilter?: string;
  walletsCsv: string;
  levels: number;
  stepBps: number;
  gapBps: number;
  priceDecimals: number;
  amountDecimals: number;
  minQty: string;
  maxQty: string;
  useMarginOrders: boolean;
  maxWallets?: number;
  dryRun: boolean;
};

function loadEnv() {
  // Next.js loads `.env.local` automatically, but standalone scripts do not.
  // Load `.env.local` first (highest precedence), then `.env` as a fallback.
  const cwd = process.cwd();
  const candidates = ['.env.local', '.env'];
  for (const file of candidates) {
    const full = path.join(cwd, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
    }
  }
}

function getRpcUrl(cli?: string): string {
  if (cli) return cli;
  const rpc =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.POLYGON_RPC_URL;
  if (!rpc) {
    throw new Error(
      'Missing RPC url. Pass --rpc, or set RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL / NEXT_PUBLIC_RPC_URL).'
    );
  }
  return rpc;
}

function getSupabaseCreds(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  return { url, key };
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    walletsCsv: 'AdvancedMarketAutomation/wallets.csv',
    levels: 24,
    stepBps: 15,
    gapBps: 30,
    priceDecimals: 6,
    amountDecimals: 18,
    minQty: '0.5',
    maxQty: '2',
    useMarginOrders: true,
    dryRun: false,
  };

  const takeValue = (i: number): string => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rpc') out.rpcUrl = takeValue(i++);
    else if (a === '--orderbook') out.orderBook = takeValue(i++);
    else if (a === '--market-filter') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) out.marketFilter = '';
      else out.marketFilter = takeValue(i++);
    }
    else if (a === '--wallets') out.walletsCsv = takeValue(i++);
    else if (a === '--levels') out.levels = Number(takeValue(i++));
    else if (a === '--step-bps') out.stepBps = Number(takeValue(i++));
    else if (a === '--gap-bps') out.gapBps = Number(takeValue(i++));
    else if (a === '--price-decimals') out.priceDecimals = Number(takeValue(i++));
    else if (a === '--amount-decimals') out.amountDecimals = Number(takeValue(i++));
    else if (a === '--min-qty') out.minQty = takeValue(i++);
    else if (a === '--max-qty') out.maxQty = takeValue(i++);
    else if (a === '--max-wallets') out.maxWallets = Number(takeValue(i++));
    else if (a === '--no-margin') out.useMarginOrders = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printHelpAndExit();
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!Number.isFinite(out.levels) || out.levels <= 0) throw new Error('--levels must be > 0');
  if (!Number.isFinite(out.stepBps) || out.stepBps <= 0) throw new Error('--step-bps must be > 0');
  if (!Number.isFinite(out.gapBps) || out.gapBps < 1) throw new Error('--gap-bps must be >= 1');
  if (!Number.isFinite(out.priceDecimals) || out.priceDecimals < 0) throw new Error('--price-decimals invalid');
  if (!Number.isFinite(out.amountDecimals) || out.amountDecimals < 0) throw new Error('--amount-decimals invalid');

  return out;
}

function printHelpAndExit(): never {
  // Keep this short; this repo has multiple environments.
  console.log(`seed-orderbook-liquidity-from-wallets

Seeds a Diamond OrderBook with non-crossing limit orders around the *OrderBook-computed* mark price
(via calculateMarkPrice / getMarketPriceData). Does NOT use CoreVault.getMarkPrice.

Usage:
  tsx scripts/seed-orderbook-liquidity-from-wallets.ts --orderbook 0x... [options]

Options:
  --rpc <url>                  RPC URL (or set RPC_URL in env)
  --orderbook <address>        Diamond OrderBook address (required unless using --market-filter + Supabase env)
  --market-filter [text]       Optional: interactive pick from Supabase markets (requires SUPABASE_* env)
  --wallets <path>             CSV file (default: AdvancedMarketAutomation/wallets.csv)
  --levels <n>                 Levels per side (default: 24)
  --step-bps <bps>             Distance between levels (default: 15)
  --gap-bps <bps>              Center gap between best bid/ask (default: 30). Ensures no matching.
  --min-qty <units>            Min order amount in asset units (default: 0.5)
  --max-qty <units>            Max order amount in asset units (default: 2)
  --no-margin                  Use placeLimitOrder (no margin reservation). Default uses placeMarginLimitOrder.
  --max-wallets <n>            Limit how many wallets from CSV are used
  --dry-run                    Print planned orders, do not send txs
`);
  process.exit(0);
}

function parseWalletsCsv(csvPath: string): WalletRow[] {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error(`wallets CSV appears empty: ${csvPath}`);

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('privatekey') && header.includes('address');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const out: WalletRow[] = [];
  for (const line of dataLines) {
    const [nicknameRaw, addressRaw, pkRaw] = line.split(',').map((x) => (x ?? '').trim());
    const nickname = nicknameRaw || 'wallet';
    const address = addressRaw;
    const privateKey = pkRaw;
    if (!ethers.isAddress(address)) continue;
    if (!ethers.isHexString(privateKey, 32)) continue;
    out.push({ nickname, address, privateKey });
  }
  if (!out.length) throw new Error(`No valid wallets parsed from ${csvPath}`);
  return out;
}

function shortAddr(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function mulDivBps(value: bigint, bps: number, denomBps = 10000): bigint {
  return (value * BigInt(bps)) / BigInt(denomBps);
}

function clampBigint(x: bigint, lo: bigint, hi: bigint): bigint {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function randomBetween(min: bigint, max: bigint): bigint {
  if (max <= min) return min;
  const span = max - min;
  // Use crypto randomness to avoid Number precision limits with 18-decimal BigInt values.
  // Modulo bias is acceptable for this seeding use-case.
  const buf = crypto.randomBytes(16); // 128-bit
  const r = BigInt(`0x${buf.toString('hex')}`);
  return min + (r % span);
}

async function fetchDeployedMarkets(): Promise<MarketRow[]> {
  const { url, key } = getSupabaseCreds();
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const viewName = process.env.SUPABASE_MARKETS_SOURCE || 'orderbook_markets_view';
  let data: any[] | null = null;
  let error: any = null;

  if (viewName) {
    const r = await supabase
      .from(viewName)
      .select(
        'id, metric_id, category, chain_id, network, deployment_status, market_address, central_vault_address, created_at'
      )
      .eq('is_active', true)
      .eq('deployment_status', 'DEPLOYED')
      .not('market_address', 'is', null)
      .order('created_at', { ascending: false });
    data = r.data as any[] | null;
    error = r.error;
  }

  if (error) {
    const r2 = await supabase
      .from('markets')
      .select('id, market_identifier, symbol, category, chain_id, network, deployment_status, market_address, created_at')
      .eq('is_active', true)
      .eq('deployment_status', 'DEPLOYED')
      .not('market_address', 'is', null)
      .order('created_at', { ascending: false });
    data = r2.data as any[] | null;
    error = r2.error;
  }

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data || []) as MarketRow[];
}

async function pickOrderBookFromSupabaseInteractively(
  provider: ethers.Provider,
  initialFilterText: string
): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const all = await fetchDeployedMarkets();
    if (!all.length) throw new Error('No deployed markets found in Supabase (deployment_status=DEPLOYED).');

    const net = await provider.getNetwork();
    let filter = initialFilterText || '';

    while (true) {
      if (!filter) {
        filter = (await rl.question('Market filter (press enter for all, or "q" to quit): ')).trim();
        if (filter.toLowerCase() === 'q') throw new Error('Aborted.');
      }

      const markets = filter
        ? all.filter((m) => {
            const hay = `${m.market_identifier || ''} ${m.metric_id || ''} ${m.symbol || ''} ${m.category || ''} ${
              m.network || ''
            }`.toLowerCase();
            return hay.includes(filter.toLowerCase());
          })
        : all;

      if (!markets.length) {
        console.log('No matches.\n');
        filter = '';
        continue;
      }

      const maxShow = 40;
      console.log(`\nShowing ${Math.min(maxShow, markets.length)} / ${markets.length} markets:`);
      markets.slice(0, maxShow).forEach((m, i) => {
        const label = m.market_identifier || m.metric_id || m.symbol || m.id;
        console.log(
          `[${i}] ${label} | chain=${m.chain_id ?? '?'} ${m.network ?? ''} | OB=${shortAddr(m.market_address || '-')}`
        );
      });
      if (markets.length > maxShow) console.log(`... (${markets.length - maxShow} more hidden; refine your filter)\n`);
      else console.log('');

      const rawIdx = (await rl.question('Select index (or "r" to refilter, "q" to quit): ')).trim();
      if (rawIdx.toLowerCase() === 'q') throw new Error('Aborted.');
      if (rawIdx.toLowerCase() === 'r') {
        filter = '';
        continue;
      }
      const idx = Number(rawIdx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= Math.min(maxShow, markets.length)) {
        console.log('Invalid selection.\n');
        continue;
      }
      const picked = markets[idx];
      const ob = picked.market_address;
      if (!ob || !ethers.isAddress(ob)) {
        console.log('Selected row has no valid `market_address`.\n');
        filter = '';
        continue;
      }
      if (picked.chain_id != null && BigInt(picked.chain_id) !== net.chainId) {
        console.log(
          `⚠️ ChainId mismatch: Supabase says ${picked.chain_id}, RPC says ${net.chainId.toString()}. If you continue, txs may fail.\n`
        );
      }
      return ob;
    }
  } finally {
    rl.close();
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const rpcUrl = getRpcUrl(args.rpcUrl);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();

  const resolvedWalletsPath = path.isAbsolute(args.walletsCsv)
    ? args.walletsCsv
    : path.join(process.cwd(), args.walletsCsv);
  const walletsAll = parseWalletsCsv(resolvedWalletsPath);
  const wallets = args.maxWallets ? walletsAll.slice(0, args.maxWallets) : walletsAll;

  let orderBookAddress = args.orderBook;
  if (!orderBookAddress && args.marketFilter !== undefined) {
    orderBookAddress = await pickOrderBookFromSupabaseInteractively(provider, args.marketFilter);
  }
  if (!orderBookAddress) {
    throw new Error('Missing --orderbook. Run with --help for usage.');
  }
  if (!ethers.isAddress(orderBookAddress)) {
    throw new Error(`Invalid --orderbook address: ${orderBookAddress}`);
  }

  // Pricing reads (Diamond mark, not CoreVault)
  const pricingAbi = [
    'function calculateMarkPrice() view returns (uint256)',
    'function getMarketPriceData() view returns (uint256 midPrice,uint256 bestBidPrice,uint256 bestAskPrice,uint256 lastTradePriceReturn,uint256 markPrice,uint256 spread,uint256 spreadBps,bool isValid)',
    'function getBestPrices() view returns (uint256 bidPrice,uint256 askPrice)',
    'function isBookCrossed() view returns (bool)',
  ];
  const viewAbi = [
    'function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)',
  ];
  const placementAbi = [
    'function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) returns (uint256 orderId)',
    'function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) returns (uint256 orderId)',
  ];

  const obPricing = new ethers.Contract(orderBookAddress, pricingAbi, provider);
  const obView = new ethers.Contract(orderBookAddress, viewAbi, provider);

  let mark: bigint | null = null;
  let bestBid: bigint | null = null;
  let bestAsk: bigint | null = null;
  try {
    mark = (await obPricing.calculateMarkPrice()) as bigint;
  } catch {
    // fallback
    const mp = await obPricing.getMarketPriceData();
    mark = (mp?.markPrice ?? 0n) as bigint;
    bestBid = (mp?.bestBidPrice ?? 0n) as bigint;
    bestAsk = (mp?.bestAskPrice ?? 0n) as bigint;
  }
  if (bestBid === null || bestAsk === null) {
    try {
      const bp = await obPricing.getBestPrices();
      bestBid = (bp?.bidPrice ?? (Array.isArray(bp) ? bp[0] : 0n)) as bigint;
      bestAsk = (bp?.askPrice ?? (Array.isArray(bp) ? bp[1] : 0n)) as bigint;
    } catch {
      bestBid = 0n;
      bestAsk = 0n;
    }
  }
  if (!mark || mark <= 0n) throw new Error('Could not read OrderBook mark price (calculateMarkPrice/getMarketPriceData)');

  const crossed = await obPricing.isBookCrossed().catch(() => false);
  const ms = await obView.marketStatic().catch(() => null);
  const vaultAddr = ms && ethers.isAddress(ms?.vault) ? String(ms.vault) : null;
  const marketId = ms?.marketId ? String(ms.marketId) : null;

  console.log('--- Seed OrderBook Liquidity (Diamond mark) ---');
  console.log(`RPC: ${rpcUrl}`);
  console.log(`chainId: ${net.chainId.toString()}`);
  console.log(`OrderBook: ${orderBookAddress}`);
  if (vaultAddr) console.log(`Vault: ${vaultAddr}`);
  if (marketId) console.log(`MarketId: ${marketId}`);
  console.log(`Wallets: ${wallets.length} (from ${path.relative(process.cwd(), resolvedWalletsPath)})`);
  console.log('');
  console.log(
    `OrderBook mark: ${ethers.formatUnits(mark, args.priceDecimals)}  (raw=${mark.toString()})`
  );
  console.log(
    `Best bid/ask:   ${ethers.formatUnits(bestBid ?? 0n, args.priceDecimals)} / ${ethers.formatUnits(
      bestAsk ?? 0n,
      args.priceDecimals
    )}  crossed=${crossed ? 'YES' : 'NO'}`
  );
  console.log('');

  // Convert qty bounds (amount is in 1e18 units; price is 6 decimals)
  const minQty = ethers.parseUnits(args.minQty, args.amountDecimals);
  const maxQty = ethers.parseUnits(args.maxQty, args.amountDecimals);
  if (minQty <= 0n || maxQty <= 0n) throw new Error('--min-qty/--max-qty must be > 0');

  // Ensure "do not match" even vs existing book:
  // - Place bids below both: (mark - gap/2) and (existing bestAsk - 1 tick)
  // - Place asks above both: (mark + gap/2) and (existing bestBid + 1 tick)
  const tick = 1n; // smallest unit at `priceDecimals`
  const halfGapBps = Math.floor(args.gapBps / 2);
  const idealBid0 = mulDivBps(mark, 10000 - halfGapBps);
  const idealAsk0 = mulDivBps(mark, 10000 + halfGapBps);

  const shiftDown =
    bestAsk && bestAsk > tick && idealBid0 >= bestAsk - tick ? idealBid0 - (bestAsk - tick) : 0n;
  const shiftUp = bestBid && idealAsk0 <= bestBid + tick ? (bestBid + tick) - idealAsk0 : 0n;

  // Build price ladders around mark (linear in bps from mark), then shift as needed
  // to avoid crossing any existing resting liquidity.
  const bidPrices: bigint[] = [];
  const askPrices: bigint[] = [];
  for (let i = 0; i < args.levels; i++) {
    const delta = halfGapBps + args.stepBps * i;
    if (delta >= 10000) break;
    const bid = mulDivBps(mark, 10000 - delta) - shiftDown;
    const ask = mulDivBps(mark, 10000 + delta) + shiftUp;
    if (bid <= 0n || ask <= 0n) continue;
    // keep a safety gap
    if (bid + tick >= ask) continue;
    bidPrices.push(bid);
    askPrices.push(ask);
  }
  if (!bidPrices.length || !askPrices.length) {
    throw new Error('No price levels produced. Check --levels/--step-bps/--gap-bps.');
  }

  // Plan orders: one bid and one ask per level, round-robin wallets.
  type PlannedOrder = { wallet: WalletRow; isBuy: boolean; price: bigint; amount: bigint };
  const planned: PlannedOrder[] = [];
  const wN = wallets.length;
  for (let i = 0; i < Math.min(bidPrices.length, askPrices.length); i++) {
    const bidWallet = wallets[(i * 2) % wN];
    const askWallet = wallets[(i * 2 + 1) % wN];
    const bidAmt = clampBigint(randomBetween(minQty, maxQty), minQty, maxQty);
    const askAmt = clampBigint(randomBetween(minQty, maxQty), minQty, maxQty);
    planned.push({ wallet: bidWallet, isBuy: true, price: bidPrices[i], amount: bidAmt });
    planned.push({ wallet: askWallet, isBuy: false, price: askPrices[i], amount: askAmt });
  }

  console.log(`Planned orders: ${planned.length} (levels=${Math.floor(planned.length / 2)} per side)`);
  console.log(
    `Mode: ${args.dryRun ? 'DRY RUN' : 'SEND TXS'} | method=${
      args.useMarginOrders ? 'placeMarginLimitOrder' : 'placeLimitOrder'
    }`
  );
  console.log(
    `Qty range: ${args.minQty}..${args.maxQty} (decimals=${args.amountDecimals}) | step=${args.stepBps}bps | gap=${args.gapBps}bps`
  );
  console.log('');

  const showPreview = Math.min(planned.length, 10);
  console.log(`Preview (first ${showPreview}):`);
  for (let i = 0; i < showPreview; i++) {
    const o = planned[i];
    console.log(
      `- ${o.isBuy ? 'BID' : 'ASK'} ${ethers.formatUnits(o.amount, args.amountDecimals)} @ ${ethers.formatUnits(
        o.price,
        args.priceDecimals
      )}  (${o.wallet.nickname} ${shortAddr(o.wallet.address)})`
    );
  }
  console.log('');

  if (args.dryRun) return;

  // Send txs sequentially to avoid nonce contention; rotate wallets naturally.
  for (let i = 0; i < planned.length; i++) {
    const o = planned[i];
    const signer = new ethers.Wallet(o.wallet.privateKey, provider);
    const obPlace = new ethers.Contract(orderBookAddress, placementAbi, signer);

    const fn = args.useMarginOrders ? 'placeMarginLimitOrder' : 'placeLimitOrder';
    try {
      const tx = await (obPlace as any)[fn](o.price, o.amount, o.isBuy);
      const side = o.isBuy ? 'BID' : 'ASK';
      console.log(
        `[${i + 1}/${planned.length}] ${side} ${ethers.formatUnits(o.amount, args.amountDecimals)} @ ${ethers.formatUnits(
          o.price,
          args.priceDecimals
        )}  (${o.wallet.nickname} ${shortAddr(o.wallet.address)})  tx=${tx.hash}`
      );
      await tx.wait();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      console.warn(
        `[${i + 1}/${planned.length}] SKIP ${o.isBuy ? 'BID' : 'ASK'} (${o.wallet.nickname} ${shortAddr(
          o.wallet.address
        )}): ${msg}`
      );
    }
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});

