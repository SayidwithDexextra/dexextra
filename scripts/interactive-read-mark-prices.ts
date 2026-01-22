import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

type MarketRow = {
  id: string;
  // Compatible across `orderbook_markets_view` and `markets`
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

async function fetchDeployedMarkets(): Promise<MarketRow[]> {
  const { url, key } = getSupabaseCreds();
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prefer the compatibility view used throughout the app.
  // Fallback to `markets` if the view isn't available or doesn't contain expected columns.
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
    // Fallback to unified `markets` table with a minimal projection that avoids missing columns.
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

async function main() {
  loadEnv();
  const rl = createInterface({ input, output });
  try {
    console.log('--- Interactive Mark Price Reader (Vault + OrderBook) ---');
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
      console.log('No deployed markets found in Supabase (`markets` where deployment_status=DEPLOYED).');
      return;
    }

    // Loop: allow multiple reads without restarting script
    while (true) {
      const filter = (await rl.question('Filter (press enter for all, or "q" to quit): ')).trim();
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
          `[${i}] ${label} | chain=${m.chain_id ?? '?'} ${m.network ?? ''} | OB=${shortAddr(
            m.market_address
          )} | Vault=${shortAddr(m.central_vault_address)}`
        );
      });
      if (markets.length > maxShow) console.log(`... (${markets.length - maxShow} more hidden; refine your filter)\n`);
      else console.log('');

      const rawIdx = (await rl.question('Select index (or "q" to quit): ')).trim();
      if (rawIdx.toLowerCase() === 'q') return;
      const idx = Number(rawIdx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= Math.min(maxShow, markets.length)) {
        console.log('Invalid selection.\n');
        continue;
      }

      const picked = markets[idx];
      if (!picked.market_address || !ethers.isAddress(picked.market_address)) {
        console.log('Selected row has no valid `market_address`.\n');
        continue;
      }

      if (picked.chain_id != null && BigInt(picked.chain_id) !== net.chainId) {
        console.log(
          `⚠️ ChainId mismatch: Supabase says ${picked.chain_id}, RPC says ${net.chainId.toString()}. Prices may error or be from the wrong network.\n`
        );
      }

      const orderBookAbi = [
        'function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)',
        'function calculateMarkPrice() view returns (uint256)',
        'function getMarketPriceData() view returns (uint256 midPrice,uint256 bestBidPrice,uint256 bestAskPrice,uint256 lastTradePriceReturn,uint256 markPrice,uint256 spread,uint256 spreadBps,bool isValid)',
      ];
      const vaultAbi = ['function getMarkPrice(bytes32 marketId) view returns (uint256)'];

      const ob = new ethers.Contract(picked.market_address, orderBookAbi, provider);

      let onchainVault: string | null = null;
      let onchainMarketId: string | null = null;
      let useVWAP: boolean | null = null;
      let vwapWindow: bigint | null = null;
      try {
        const res = await ob.marketStatic();
        onchainVault = String(res?.vault);
        onchainMarketId = String(res?.marketId);
        useVWAP = Boolean(res?.useVWAP);
        vwapWindow = BigInt(res?.vwapWindow ?? 0);
      } catch (e: any) {
        console.warn('⚠️ Could not read orderBook.marketStatic(); will fall back to Supabase fields if possible.');
        console.warn(`   ${e?.message || String(e)}\n`);
      }

      const vaultAddress =
        (onchainVault && ethers.isAddress(onchainVault) ? onchainVault : null) ||
        (picked.central_vault_address && ethers.isAddress(picked.central_vault_address) ? picked.central_vault_address : null);
      const marketId =
        (onchainMarketId && /^0x[0-9a-fA-F]{64}$/.test(onchainMarketId) ? onchainMarketId : null) ||
        (picked.market_id_bytes32 && /^0x[0-9a-fA-F]{64}$/.test(picked.market_id_bytes32) ? picked.market_id_bytes32 : null);

      if (!vaultAddress) {
        console.log('❌ Could not resolve vault address (neither on-chain nor Supabase had a valid one).\n');
        continue;
      }
      if (!marketId) {
        console.log('❌ Could not resolve marketId bytes32 (neither on-chain nor Supabase had it).\n');
        continue;
      }

      if (picked.market_id_bytes32 && onchainMarketId && picked.market_id_bytes32.toLowerCase() !== onchainMarketId.toLowerCase()) {
        console.log(`⚠️ marketId mismatch: Supabase=${picked.market_id_bytes32} vs on-chain=${onchainMarketId}`);
      }
      if (picked.central_vault_address && onchainVault && picked.central_vault_address.toLowerCase() !== onchainVault.toLowerCase()) {
        console.log(`⚠️ vault mismatch: Supabase=${picked.central_vault_address} vs on-chain=${onchainVault}`);
      }

      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);

      // Vault mark price (stored in CoreVault)
      let vaultMark: bigint | null = null;
      try {
        vaultMark = (await vault.getMarkPrice(marketId)) as bigint;
      } catch (e: any) {
        console.log(`❌ vault.getMarkPrice failed: ${e?.message || String(e)}\n`);
      }

      // OrderBook mark price (computed from book)
      let obMark: bigint | null = null;
      let mid: bigint | null = null;
      let bestBid: bigint | null = null;
      let bestAsk: bigint | null = null;
      let last: bigint | null = null;
      let valid: boolean | null = null;
      try {
        obMark = (await ob.calculateMarkPrice()) as bigint;
      } catch {
        // fallback to getMarketPriceData
        try {
          const r = await ob.getMarketPriceData();
          mid = (r?.midPrice ?? 0n) as bigint;
          bestBid = (r?.bestBidPrice ?? 0n) as bigint;
          bestAsk = (r?.bestAskPrice ?? 0n) as bigint;
          last = (r?.lastTradePriceReturn ?? 0n) as bigint;
          obMark = (r?.markPrice ?? 0n) as bigint;
          valid = Boolean(r?.isValid);
        } catch (e: any) {
          console.log(`❌ orderbook mark read failed: ${e?.message || String(e)}\n`);
        }
      }

      // If calculateMarkPrice succeeded, still try to enrich via getMarketPriceData (optional)
      if (mid === null && bestBid === null && bestAsk === null) {
        try {
          const r = await ob.getMarketPriceData();
          mid = (r?.midPrice ?? 0n) as bigint;
          bestBid = (r?.bestBidPrice ?? 0n) as bigint;
          bestAsk = (r?.bestAskPrice ?? 0n) as bigint;
          last = (r?.lastTradePriceReturn ?? 0n) as bigint;
          valid = Boolean(r?.isValid);
        } catch {
          // ignore
        }
      }

      const label = picked.market_identifier || picked.metric_id || picked.symbol || picked.id;
      console.log('\n=== Result ===');
      console.log(`Market: ${label}`);
      console.log(`OrderBook: ${picked.market_address}`);
      console.log(`Vault: ${vaultAddress}`);
      console.log(`MarketId: ${marketId}`);
      if (useVWAP !== null) console.log(`OrderBook VWAP: ${useVWAP ? 'enabled' : 'disabled'} (window=${vwapWindow?.toString?.() ?? '0'}s)`);
      console.log('');

      console.log(`Vault mark (CoreVault.getMarkPrice): ${fmt6(vaultMark)}   (raw=${vaultMark?.toString?.() ?? '-'})`);
      console.log(`OB mark   (OrderBook.calculateMarkPrice): ${fmt6(obMark)}   (raw=${obMark?.toString?.() ?? '-'})`);

      if (mid !== null || bestBid !== null || bestAsk !== null || last !== null) {
        console.log('');
        console.log(`OB mid:  ${fmt6(mid)}   bid: ${fmt6(bestBid)}   ask: ${fmt6(bestAsk)}   last: ${fmt6(last)}   valid: ${valid ?? '-'}`);
      }

      console.log('');
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});


