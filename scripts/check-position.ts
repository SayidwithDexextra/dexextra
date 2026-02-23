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
      .select('id, metric_id, category, chain_id, network, deployment_status, market_address, created_at')
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
      .select('id, market_identifier, symbol, category, chain_id, network, deployment_status, market_address, central_vault_address, market_id_bytes32, created_at')
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
    console.log('--- Position Checker (getPositionSummary) ---');
    console.log('Checks on-chain position state for a given wallet + market.\n');

    const rpcUrl = getRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const net = await provider.getNetwork();
    console.log(`RPC: ${rpcUrl}`);
    console.log(`Chain ID: ${net.chainId.toString()}\n`);

    const all = await fetchDeployedMarkets();
    if (!all.length) {
      console.log('No deployed markets found.');
      return;
    }

    while (true) {
      const filter = (await rl.question('Filter markets (enter for all, "q" to quit): ')).trim();
      if (filter.toLowerCase() === 'q') return;

      const markets = filter
        ? all.filter((m) => {
            const hay = `${m.market_identifier || ''} ${m.symbol || ''} ${m.metric_id || ''} ${m.category || ''} ${m.network || ''}`.toLowerCase();
            return hay.includes(filter.toLowerCase());
          })
        : all;

      if (!markets.length) {
        console.log('No matches.\n');
        continue;
      }

      const maxShow = 40;
      console.log(`\n${Math.min(maxShow, markets.length)} / ${markets.length} markets:`);
      markets.slice(0, maxShow).forEach((m, i) => {
        const label = m.market_identifier || m.metric_id || m.symbol || m.id;
        console.log(
          `[${i}] ${label} | chain=${m.chain_id ?? '?'} ${m.network ?? ''} | OB=${shortAddr(m.market_address)} | Vault=${shortAddr(m.central_vault_address)}`
        );
      });
      if (markets.length > maxShow) console.log(`... (${markets.length - maxShow} more hidden)\n`);
      else console.log('');

      const rawIdx = (await rl.question('Select market index (or "q"): ')).trim();
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

      const orderBookAbi = [
        'function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)',
        'function calculateMarkPrice() view returns (uint256)',
      ];
      const vaultAbi = [
        'function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)',
        'function getMarkPrice(bytes32 marketId) view returns (uint256)',
      ];

      const ob = new ethers.Contract(picked.market_address, orderBookAbi, provider);

      let vaultAddress: string | null = null;
      let marketId: string | null = null;
      try {
        const res = await ob.marketStatic();
        vaultAddress = String(res?.vault);
        marketId = String(res?.marketId);
      } catch (e: any) {
        console.warn(`⚠️ Could not read orderBook.marketStatic(): ${e?.message || String(e)}`);
      }

      vaultAddress =
        (vaultAddress && ethers.isAddress(vaultAddress) ? vaultAddress : null) ||
        (picked.central_vault_address && ethers.isAddress(picked.central_vault_address) ? picked.central_vault_address : null);
      marketId =
        (marketId && /^0x[0-9a-fA-F]{64}$/.test(marketId) ? marketId : null) ||
        (picked.market_id_bytes32 && /^0x[0-9a-fA-F]{64}$/.test(picked.market_id_bytes32) ? picked.market_id_bytes32 : null);

      if (!vaultAddress) {
        console.log('❌ Could not resolve vault address.\n');
        continue;
      }
      if (!marketId) {
        console.log('❌ Could not resolve marketId bytes32.\n');
        continue;
      }

      const label = picked.market_identifier || picked.metric_id || picked.symbol || picked.id;
      console.log(`\nMarket: ${label}`);
      console.log(`OrderBook: ${picked.market_address}`);
      console.log(`Vault: ${vaultAddress}`);
      console.log(`MarketId: ${marketId}`);

      let markPrice: bigint | null = null;
      try {
        markPrice = (await ob.calculateMarkPrice()) as bigint;
        console.log(`Mark Price: ${fmt6(markPrice)}`);
      } catch {
        console.log('Mark Price: (could not read)');
      }

      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);

      // Wallet loop — check multiple wallets against same market
      while (true) {
        const walletInput = (await rl.question('\nPaste wallet address (or "b" to go back, "q" to quit): ')).trim();
        if (walletInput.toLowerCase() === 'q') return;
        if (walletInput.toLowerCase() === 'b') break;

        if (!ethers.isAddress(walletInput)) {
          console.log('Invalid address.');
          continue;
        }

        const wallet = ethers.getAddress(walletInput);

        try {
          const [size, entryPrice, marginLocked] = await vault.getPositionSummary(wallet, marketId);

          console.log('\n=== Position Summary ===');
          console.log(`Wallet:        ${wallet}`);
          console.log(`Size:          ${size.toString()} (${fmt18(size > 0n ? size : -size)} contracts)`);
          console.log(`Direction:     ${size === 0n ? 'NONE' : size > 0n ? 'LONG' : 'SHORT'}`);
          console.log(`Entry Price:   ${fmt6(entryPrice)}   (raw=${entryPrice.toString()})`);
          console.log(`Margin Locked: ${fmt6(marginLocked)}   (raw=${marginLocked.toString()})`);

          if (size !== 0n && markPrice !== null && markPrice > 0n) {
            const absSize = size > 0n ? size : -size;
            const pnl = size > 0n
              ? (markPrice - entryPrice) * absSize / BigInt(1e18)
              : (entryPrice - markPrice) * absSize / BigInt(1e18);
            const pnlSign = pnl >= 0n ? '+' : '';
            console.log(`Unrealized PnL: ${pnlSign}${fmt6(pnl)} USDC (approx, at mark=${fmt6(markPrice)})`);

            if (pnl < 0n && (-pnl) > marginLocked) {
              console.log('⚠️  LOSS EXCEEDS MARGIN — this position would revert on close!');
            }
          }

          if (size === 0n) {
            console.log('\n✅ No position exists for this wallet in this market.');
          }
        } catch (e: any) {
          console.log(`\n❌ getPositionSummary failed: ${e?.message || String(e)}`);
        }
        console.log('');
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
