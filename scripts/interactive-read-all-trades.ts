import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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

const TRADE_TUPLE = `tuple(
  uint256 tradeId,
  address buyer,
  address seller,
  uint256 price,
  uint256 amount,
  uint256 timestamp,
  uint256 buyOrderId,
  uint256 sellOrderId,
  bool buyerIsMargin,
  bool sellerIsMargin,
  uint256 tradeValue,
  uint256 buyerFee,
  uint256 sellerFee
)`;

const ORDER_BOOK_ABI = [
  `function getAllTrades(uint256 offset, uint256 limit) view returns (${TRADE_TUPLE}[] tradeData, bool hasMore)`,
  `function getRecentTrades(uint256 count) view returns (${TRADE_TUPLE}[] tradeData)`,
  `function getUserTrades(address user, uint256 offset, uint256 limit) view returns (${TRADE_TUPLE}[] tradeData, bool hasMore)`,
  `function getTradeById(uint256 tradeId) view returns (${TRADE_TUPLE} trade)`,
  `function getTradeStatistics() view returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees)`,
  `function getLastTwentyTrades() view returns (${TRADE_TUPLE}[] tradeData)`,
];

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '-';
  if (!addr.startsWith('0x') || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getRpcUrl(): string {
  const rpc =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.POLYGON_RPC_URL;
  if (!rpc) {
    throw new Error(
      'Missing RPC url env. Set RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL / NEXT_PUBLIC_RPC_URL).'
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

function fmt6(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return ethers.formatUnits(value, 6);
}

function fmt18(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return ethers.formatUnits(value, 18);
}

function fmtTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function loadEnv() {
  const cwd = process.cwd();
  for (const file of ['.env.local', '.env']) {
    const full = path.join(cwd, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
    }
  }
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
      .select('id, metric_id, category, chain_id, network, deployment_status, market_address, central_vault_address, created_at')
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

interface ParsedTrade {
  tradeId: bigint;
  buyer: string;
  seller: string;
  price: bigint;
  amount: bigint;
  timestamp: bigint;
  buyOrderId: bigint;
  sellOrderId: bigint;
  buyerIsMargin: boolean;
  sellerIsMargin: boolean;
  tradeValue: bigint;
  buyerFee: bigint;
  sellerFee: bigint;
}

function parseTrade(raw: any): ParsedTrade {
  return {
    tradeId: BigInt(raw.tradeId),
    buyer: raw.buyer,
    seller: raw.seller,
    price: BigInt(raw.price),
    amount: BigInt(raw.amount),
    timestamp: BigInt(raw.timestamp),
    buyOrderId: BigInt(raw.buyOrderId),
    sellOrderId: BigInt(raw.sellOrderId),
    buyerIsMargin: raw.buyerIsMargin,
    sellerIsMargin: raw.sellerIsMargin,
    tradeValue: BigInt(raw.tradeValue),
    buyerFee: BigInt(raw.buyerFee),
    sellerFee: BigInt(raw.sellerFee),
  };
}

function printTradeTable(trades: ParsedTrade[]) {
  if (!trades.length) {
    console.log('  (no trades)');
    return;
  }

  const header = [
    'ID'.padStart(5),
    'Time (UTC)'.padEnd(20),
    'Price'.padStart(14),
    'Amount'.padStart(20),
    'Value (USDC)'.padStart(14),
    'Buyer'.padEnd(13),
    'Seller'.padEnd(13),
    'B.Fee'.padStart(10),
    'S.Fee'.padStart(10),
  ].join(' │ ');

  const sep = '─'.repeat(header.length);

  console.log(sep);
  console.log(header);
  console.log(sep);

  for (const t of trades) {
    const row = [
      String(t.tradeId).padStart(5),
      fmtTime(t.timestamp).padEnd(20),
      fmt6(t.price).padStart(14),
      fmt18(t.amount).padStart(20),
      fmt6(t.tradeValue).padStart(14),
      shortAddr(t.buyer).padEnd(13),
      shortAddr(t.seller).padEnd(13),
      fmt6(t.buyerFee).padStart(10),
      fmt6(t.sellerFee).padStart(10),
    ].join(' │ ');
    console.log(row);
  }

  console.log(sep);
}

async function main() {
  loadEnv();
  const rl = createInterface({ input, output });

  try {
    console.log('--- Interactive Trade Reader (getAllTrades) ---');
    console.log('Env requirements:');
    console.log('- SUPABASE_SERVICE_ROLE_KEY');
    console.log('- NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)');
    console.log('- RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL / NEXT_PUBLIC_RPC_URL)\n');

    const rpcUrl = getRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const net = await provider.getNetwork();
    console.log(`RPC: ${rpcUrl}`);
    console.log(`RPC chainId: ${net.chainId.toString()}\n`);

    const all = await fetchDeployedMarkets();
    if (!all.length) {
      console.log('No deployed markets found in Supabase.');
      return;
    }

    while (true) {
      const filter = (await rl.question('Filter markets (enter for all, "q" to quit): ')).trim();
      if (filter.toLowerCase() === 'q') return;

      const markets = filter
        ? all.filter((m) => {
            const hay = `${m.market_identifier || ''} ${m.symbol || ''} ${m.category || ''} ${m.network || ''}`.toLowerCase();
            return hay.includes(filter.toLowerCase());
          })
        : all;

      if (!markets.length) {
        console.log('No matches.\n');
        continue;
      }

      const maxShow = 40;
      console.log(`\nShowing ${Math.min(maxShow, markets.length)} / ${markets.length} markets:`);
      markets.slice(0, maxShow).forEach((m, i) => {
        const label = m.market_identifier || m.metric_id || m.symbol || m.id;
        console.log(
          `[${i}] ${label} | chain=${m.chain_id ?? '?'} ${m.network ?? ''} | OB=${shortAddr(m.market_address)}`
        );
      });
      if (markets.length > maxShow) console.log(`... (${markets.length - maxShow} more hidden; refine your filter)\n`);
      else console.log('');

      const rawIdx = (await rl.question('Select market index (or "q" to quit): ')).trim();
      if (rawIdx.toLowerCase() === 'q') return;
      const idx = Number(rawIdx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= Math.min(maxShow, markets.length)) {
        console.log('Invalid selection.\n');
        continue;
      }

      const picked = markets[idx];
      if (!picked.market_address || !ethers.isAddress(picked.market_address)) {
        console.log('Selected row has no valid market_address.\n');
        continue;
      }

      if (picked.chain_id != null && BigInt(picked.chain_id) !== net.chainId) {
        console.log(
          `⚠️  ChainId mismatch: Supabase says ${picked.chain_id}, RPC says ${net.chainId.toString()}.\n`
        );
      }

      const ob = new ethers.Contract(picked.market_address, ORDER_BOOK_ABI, provider);
      const label = picked.market_identifier || picked.metric_id || picked.symbol || picked.id;

      // Fetch stats first
      let totalTrades = 0n;
      let totalVolume = 0n;
      let totalFees = 0n;
      try {
        const stats = await ob.getTradeStatistics();
        totalTrades = BigInt(stats.totalTrades);
        totalVolume = BigInt(stats.totalVolume);
        totalFees = BigInt(stats.totalFees);
      } catch (e: any) {
        console.log(`⚠️  getTradeStatistics failed: ${e?.message || String(e)}`);
      }

      console.log(`\n=== ${label} ===`);
      console.log(`OrderBook: ${picked.market_address}`);
      console.log(`Total trades on chain: ${totalTrades.toString()}`);
      console.log(`Total volume (USDC):   ${fmt6(totalVolume)}`);
      console.log(`Total fees (USDC):     ${fmt6(totalFees)}\n`);

      if (totalTrades === 0n) {
        console.log('No trades recorded for this market.\n');
        continue;
      }

      const action = (
        await rl.question(
          'Action:\n' +
            '  [a] All trades (paginated, newest first)\n' +
            '  [r] Recent N trades\n' +
            '  [u] User trades (by address)\n' +
            '  [i] Single trade by ID\n' +
            '  [d] Dump ALL trades (full download)\n' +
            '  [q] Back to market list\n' +
            'Choice: '
        )
      )
        .trim()
        .toLowerCase();

      if (action === 'q') continue;

      if (action === 'a') {
        // Paginated newest-first
        const PAGE = 100;
        let offset = 0;
        let keepGoing = true;

        while (keepGoing) {
          try {
            const result = await ob.getAllTrades(offset, PAGE);
            const trades = (result.tradeData as any[]).map(parseTrade).filter((t) => t.tradeId > 0n);
            const hasMore = result.hasMore as boolean;

            console.log(`\n--- Page offset=${offset}, showing ${trades.length} trades ---`);
            printTradeTable(trades);

            if (!hasMore) {
              console.log('(end of trades)\n');
              keepGoing = false;
            } else {
              const next = (await rl.question('Press enter for next page, or "q" to stop: ')).trim();
              if (next.toLowerCase() === 'q') keepGoing = false;
              else offset += PAGE;
            }
          } catch (e: any) {
            console.log(`Error fetching trades: ${e?.message || String(e)}\n`);
            keepGoing = false;
          }
        }
      } else if (action === 'r') {
        const countStr = (await rl.question('How many recent trades? (1-100): ')).trim();
        const count = Math.min(100, Math.max(1, Number(countStr) || 20));
        try {
          const trades = (await ob.getRecentTrades(count) as any[]).map(parseTrade).filter((t) => t.tradeId > 0n);
          console.log(`\n--- ${trades.length} most recent trades ---`);
          printTradeTable(trades);
          console.log('');
        } catch (e: any) {
          console.log(`Error: ${e?.message || String(e)}\n`);
        }
      } else if (action === 'u') {
        const addr = (await rl.question('User address: ')).trim();
        if (!ethers.isAddress(addr)) {
          console.log('Invalid address.\n');
          continue;
        }
        const PAGE = 100;
        let offset = 0;
        let keepGoing = true;
        while (keepGoing) {
          try {
            const result = await ob.getUserTrades(addr, offset, PAGE);
            const trades = (result.tradeData as any[]).map(parseTrade).filter((t) => t.tradeId > 0n);
            const hasMore = result.hasMore as boolean;

            console.log(`\n--- User ${shortAddr(addr)} trades, offset=${offset}, showing ${trades.length} ---`);
            printTradeTable(trades);

            if (!hasMore) {
              console.log('(end of user trades)\n');
              keepGoing = false;
            } else {
              const next = (await rl.question('Press enter for next page, or "q" to stop: ')).trim();
              if (next.toLowerCase() === 'q') keepGoing = false;
              else offset += PAGE;
            }
          } catch (e: any) {
            console.log(`Error: ${e?.message || String(e)}\n`);
            keepGoing = false;
          }
        }
      } else if (action === 'i') {
        const idStr = (await rl.question('Trade ID: ')).trim();
        const tradeId = Number(idStr);
        if (!Number.isInteger(tradeId) || tradeId < 1) {
          console.log('Invalid trade ID.\n');
          continue;
        }
        try {
          const raw = await ob.getTradeById(tradeId);
          const t = parseTrade(raw);
          if (t.tradeId === 0n) {
            console.log('Trade not found.\n');
          } else {
            console.log(`\n--- Trade #${t.tradeId} ---`);
            console.log(`  Time:     ${fmtTime(t.timestamp)}`);
            console.log(`  Price:    ${fmt6(t.price)} USDC`);
            console.log(`  Amount:   ${fmt18(t.amount)}`);
            console.log(`  Value:    ${fmt6(t.tradeValue)} USDC`);
            console.log(`  Buyer:    ${t.buyer} (margin=${t.buyerIsMargin}, fee=${fmt6(t.buyerFee)})`);
            console.log(`  Seller:   ${t.seller} (margin=${t.sellerIsMargin}, fee=${fmt6(t.sellerFee)})`);
            console.log(`  BuyOrdId: ${t.buyOrderId.toString()}`);
            console.log(`  SellOrdId:${t.sellOrderId.toString()}\n`);
          }
        } catch (e: any) {
          console.log(`Error: ${e?.message || String(e)}\n`);
        }
      } else if (action === 'd') {
        // Full dump: paginate through everything
        const PAGE = 100;
        let offset = 0;
        let hasMore = true;
        const allTrades: ParsedTrade[] = [];
        const t0 = Date.now();

        console.log(`\nDownloading all ${totalTrades.toString()} trades...`);

        while (hasMore) {
          try {
            const result = await ob.getAllTrades(offset, PAGE);
            const batch = (result.tradeData as any[]).map(parseTrade).filter((t) => t.tradeId > 0n);
            allTrades.push(...batch);
            hasMore = result.hasMore as boolean;
            offset += PAGE;
            process.stdout.write(`\r  fetched ${allTrades.length} / ~${totalTrades.toString()} trades...`);
          } catch (e: any) {
            console.log(`\nError at offset ${offset}: ${e?.message || String(e)}`);
            hasMore = false;
          }
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`\n  Done: ${allTrades.length} trades in ${elapsed}s\n`);

        const outFile = `trades-${label.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;
        const csvHeader = 'tradeId,timestamp,price_usdc,amount,value_usdc,buyer,seller,buyerFee_usdc,sellerFee_usdc';
        const csvRows = allTrades.map(
          (t) =>
            `${t.tradeId},${fmtTime(t.timestamp)},${fmt6(t.price)},${fmt18(t.amount)},${fmt6(t.tradeValue)},${t.buyer},${t.seller},${fmt6(t.buyerFee)},${fmt6(t.sellerFee)}`
        );

        fs.writeFileSync(outFile, [csvHeader, ...csvRows].join('\n'), 'utf-8');
        console.log(`  Saved to ${outFile}\n`);
        printTradeTable(allTrades.slice(0, 10));
        if (allTrades.length > 10) console.log(`  ... (${allTrades.length - 10} more in CSV)\n`);
      } else {
        console.log('Unknown action.\n');
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});
