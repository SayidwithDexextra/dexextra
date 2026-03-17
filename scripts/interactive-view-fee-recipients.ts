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
  creator_wallet_address?: string | null;
  created_at: string | null;
};

const FEE_VIEW_ABI = [
  'function getTradingParameters() view returns (uint256 marginRequirement, uint256 fee, address recipient)',
  'function getFeeStructure() view returns (uint256 takerFeeBps, uint256 makerFeeBps, address protocolFeeRecipient, uint256 protocolFeeShareBps, uint256 legacyTradingFee, address marketOwnerFeeRecipient)',
  'function owner() view returns (address)',
];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

type FeeHealth =
  | 'HEALTHY'
  | 'FEES_UNCONFIGURED'
  | 'LEGACY_FACET'
  | 'RECIPIENT_MISMATCH'
  | 'NO_CREATOR'
  | 'RPC_ERROR'
  | 'UNKNOWN_ERROR';

interface SweepResult {
  index: number;
  label: string;
  marketAddress: string;
  health: FeeHealth;
  owner: string | null;
  feeRecipient: string | null;
  protocolFeeRecipient: string | null;
  takerFeeBps: bigint | null;
  makerFeeBps: bigint | null;
  protocolFeeShareBps: bigint | null;
  marginRequirementBps: bigint | null;
  legacyTradingFee: bigint | null;
  supabaseCreator: string | null;
  hasFeeStructure: boolean;
  errorMsg: string | null;
}

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '-';
  if (addr === ZERO_ADDR) return '0x0…0000';
  if (!addr.startsWith('0x') || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function bpsToPercent(bps: bigint): string {
  const pct = Number(bps) / 100;
  return `${pct}%`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function isNetworkError(msg: string): boolean {
  const patterns = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'fetch failed', 'network', 'timeout', 'socket hang up'];
  const lower = msg.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
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
      .select('id, metric_id, category, chain_id, network, deployment_status, market_address, creator_wallet_address, created_at')
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
      .select('id, market_identifier, symbol, category, chain_id, network, deployment_status, market_address, creator_wallet_address, created_at')
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

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (i < retries - 1 && isNetworkError(e?.message || String(e))) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

async function sweepMarket(
  provider: ethers.JsonRpcProvider,
  m: MarketRow,
  index: number
): Promise<SweepResult> {
  const label = (m.market_identifier || m.metric_id || m.symbol || m.id) ?? 'unknown';
  const marketAddress = m.market_address!;
  const supabaseCreator = m.creator_wallet_address ?? null;

  const base: SweepResult = {
    index,
    label,
    marketAddress,
    health: 'UNKNOWN_ERROR',
    owner: null,
    feeRecipient: null,
    protocolFeeRecipient: null,
    takerFeeBps: null,
    makerFeeBps: null,
    protocolFeeShareBps: null,
    marginRequirementBps: null,
    legacyTradingFee: null,
    supabaseCreator,
    hasFeeStructure: false,
    errorMsg: null,
  };

  const contract = new ethers.Contract(marketAddress, FEE_VIEW_ABI, provider);

  // owner()
  try {
    base.owner = await withRetry(() => contract.owner());
  } catch (e: any) {
    if (isNetworkError(e?.message || '')) {
      base.health = 'RPC_ERROR';
      base.errorMsg = e?.message?.slice(0, 80) || String(e);
      return base;
    }
  }

  // getTradingParameters() — exists on both legacy and current facets
  let hasTradingParams = false;
  try {
    const [marginReq, fee, recipient] = await withRetry(() => contract.getTradingParameters());
    base.marginRequirementBps = BigInt(marginReq);
    base.legacyTradingFee = BigInt(fee);
    base.feeRecipient = String(recipient);
    hasTradingParams = true;
  } catch (e: any) {
    if (isNetworkError(e?.message || '')) {
      base.health = 'RPC_ERROR';
      base.errorMsg = e?.message?.slice(0, 80) || String(e);
      return base;
    }
  }

  // getFeeStructure() — only on upgraded OBViewFacet
  try {
    const [takerBps, makerBps, protoRecipient, protoShareBps, legacyFee, ownerRecipient] =
      await withRetry(() => contract.getFeeStructure());
    base.takerFeeBps = BigInt(takerBps);
    base.makerFeeBps = BigInt(makerBps);
    base.protocolFeeRecipient = String(protoRecipient);
    base.protocolFeeShareBps = BigInt(protoShareBps);
    base.feeRecipient = String(ownerRecipient);
    base.hasFeeStructure = true;
    if (base.legacyTradingFee === null) base.legacyTradingFee = BigInt(legacyFee);
  } catch (e: any) {
    if (isNetworkError(e?.message || '')) {
      base.health = 'RPC_ERROR';
      base.errorMsg = e?.message?.slice(0, 80) || String(e);
      return base;
    }
    // Contract revert → missing facet
  }

  // Classify health
  if (!hasTradingParams && !base.hasFeeStructure) {
    base.health = 'RPC_ERROR';
    base.errorMsg = 'All view calls reverted — contract may not be a Diamond or is unreachable';
    return base;
  }

  if (!base.hasFeeStructure) {
    base.health = 'LEGACY_FACET';
    return base;
  }

  if (!supabaseCreator) {
    base.health = 'NO_CREATOR';
    return base;
  }

  // Check if fee structure is actually configured
  const feesUnconfigured =
    base.takerFeeBps === 0n &&
    base.makerFeeBps === 0n &&
    base.protocolFeeShareBps === 0n &&
    (base.protocolFeeRecipient === ZERO_ADDR || base.protocolFeeRecipient === null);

  if (feesUnconfigured) {
    base.health = 'FEES_UNCONFIGURED';
    return base;
  }

  // Check recipient match
  const onChainRecipient = base.feeRecipient;
  if (onChainRecipient && supabaseCreator) {
    if (onChainRecipient.toLowerCase() !== supabaseCreator.toLowerCase()) {
      base.health = 'RECIPIENT_MISMATCH';
      return base;
    }
  }

  base.health = 'HEALTHY';
  return base;
}

function printSweepResults(results: SweepResult[]) {
  const sep = '═'.repeat(120);
  const thin = '─'.repeat(120);

  // Summary table
  console.log(`\n${sep}`);
  console.log('  SWEEP RESULTS — All Markets Fee Structure Health Check');
  console.log(sep);

  const header = [
    '#'.padStart(3),
    'Market'.padEnd(35),
    'Health'.padEnd(20),
    'Owner Fee Rcpt'.padEnd(14),
    'Proto Fee Rcpt'.padEnd(14),
    'Taker'.padEnd(7),
    'Maker'.padEnd(7),
    'Proto%'.padEnd(7),
    'Match',
  ].join(' │ ');

  console.log(thin);
  console.log(header);
  console.log(thin);

  for (const r of results) {
    const healthIcons: Record<FeeHealth, string> = {
      HEALTHY: '✅ HEALTHY',
      FEES_UNCONFIGURED: '⚠️  FEES_UNCONFIG',
      LEGACY_FACET: '🔧 LEGACY_FACET',
      RECIPIENT_MISMATCH: '❌ RCPT_MISMATCH',
      NO_CREATOR: '❓ NO_CREATOR',
      RPC_ERROR: '🌐 RPC_ERROR',
      UNKNOWN_ERROR: '💀 UNKNOWN',
    };

    const matchIcon =
      r.feeRecipient && r.supabaseCreator
        ? r.feeRecipient.toLowerCase() === r.supabaseCreator.toLowerCase()
          ? '✅'
          : '❌'
        : r.health === 'NO_CREATOR'
          ? 'N/A'
          : '??';

    const row = [
      String(r.index).padStart(3),
      r.label.slice(0, 35).padEnd(35),
      (healthIcons[r.health] || r.health).padEnd(20),
      shortAddr(r.feeRecipient).padEnd(14),
      shortAddr(r.protocolFeeRecipient).padEnd(14),
      (r.takerFeeBps !== null ? `${r.takerFeeBps}bp` : '-').padEnd(7),
      (r.makerFeeBps !== null ? `${r.makerFeeBps}bp` : '-').padEnd(7),
      (r.protocolFeeShareBps !== null ? bpsToPercent(r.protocolFeeShareBps) : '-').padEnd(7),
      matchIcon,
    ].join(' │ ');
    console.log(row);
  }

  console.log(thin);

  // Category breakdown
  const healthy = results.filter((r) => r.health === 'HEALTHY');
  const unconfigured = results.filter((r) => r.health === 'FEES_UNCONFIGURED');
  const legacy = results.filter((r) => r.health === 'LEGACY_FACET');
  const mismatch = results.filter((r) => r.health === 'RECIPIENT_MISMATCH');
  const noCreator = results.filter((r) => r.health === 'NO_CREATOR');
  const rpcErr = results.filter((r) => r.health === 'RPC_ERROR');
  const unknown = results.filter((r) => r.health === 'UNKNOWN_ERROR');

  console.log(`\n${sep}`);
  console.log('  HEALTH SUMMARY');
  console.log(sep);
  console.log(`  ✅ Healthy (fully configured):  ${healthy.length}`);
  console.log(`  ⚠️  Fees unconfigured:           ${unconfigured.length}`);
  console.log(`  🔧 Legacy facet (needs upgrade): ${legacy.length}`);
  console.log(`  ❌ Recipient mismatch:           ${mismatch.length}`);
  console.log(`  ❓ No creator in Supabase:        ${noCreator.length}`);
  console.log(`  🌐 RPC error (unreachable):      ${rpcErr.length}`);
  console.log(`  💀 Unknown error:                ${unknown.length}`);
  console.log(`  ── Total:                        ${results.length}`);

  // Detailed issue reports
  if (legacy.length) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log('  🔧 LEGACY FACET — These markets need the OBViewFacet + OBAdminFacet diamond upgrade');
    console.log('     They only have getTradingParameters() — missing getFeeStructure() / updateFeeStructure()');
    console.log('     FIX: Run upgrade-fee-structure-interactive.js to add the new facets');
    console.log(`${'─'.repeat(120)}`);
    for (const r of legacy) {
      console.log(`     [${r.index}] ${padRight(r.label, 35)} OB=${r.marketAddress}  owner=${shortAddr(r.owner)}  feeRecipient=${shortAddr(r.feeRecipient)}`);
    }
  }

  if (unconfigured.length) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log('  ⚠️  FEES UNCONFIGURED — These markets have the new facets but fee params are all zero');
    console.log('     protocolFeeRecipient=0x0, takerFeeBps=0, makerFeeBps=0, protocolFeeShareBps=0');
    console.log('     FIX: Call updateFeeStructure(takerBps, makerBps, protocolRecipient, protocolShareBps) on each');
    console.log(`${'─'.repeat(120)}`);
    for (const r of unconfigured) {
      console.log(`     [${r.index}] ${padRight(r.label, 35)} OB=${r.marketAddress}  owner=${shortAddr(r.owner)}  feeRecipient=${shortAddr(r.feeRecipient)}`);
    }
  }

  if (mismatch.length) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log('  ❌ RECIPIENT MISMATCH — On-chain feeRecipient does NOT match Supabase creator_wallet_address');
    console.log('     FIX: Call updateTradingParameters() to set feeRecipient to the creator wallet');
    console.log(`${'─'.repeat(120)}`);
    for (const r of mismatch) {
      console.log(`     [${r.index}] ${padRight(r.label, 35)} on-chain=${r.feeRecipient}  supabase=${r.supabaseCreator}`);
    }
  }

  if (noCreator.length) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log('  ❓ NO CREATOR — No creator_wallet_address in Supabase; cannot verify fee recipient');
    console.log('     FIX: Set creator_wallet_address in the markets table for these entries');
    console.log(`${'─'.repeat(120)}`);
    for (const r of noCreator) {
      console.log(`     [${r.index}] ${padRight(r.label, 35)} OB=${r.marketAddress}  on-chain feeRecipient=${shortAddr(r.feeRecipient)}`);
    }
  }

  if (rpcErr.length) {
    console.log(`\n${'─'.repeat(120)}`);
    console.log('  🌐 RPC ERROR — Could not reach these contracts; likely transient network issue');
    console.log('     FIX: Re-run the sweep; if persistent, check the RPC endpoint');
    console.log(`${'─'.repeat(120)}`);
    for (const r of rpcErr) {
      console.log(`     [${r.index}] ${padRight(r.label, 35)} OB=${r.marketAddress}  err=${r.errorMsg?.slice(0, 60)}`);
    }
  }

  console.log('');
}

async function readFeeRecipients(
  provider: ethers.JsonRpcProvider,
  marketAddress: string
): Promise<{
  owner: string | null;
  feeRecipient: string | null;
  marginRequirementBps: bigint | null;
  legacyTradingFee: bigint | null;
  takerFeeBps: bigint | null;
  makerFeeBps: bigint | null;
  protocolFeeRecipient: string | null;
  protocolFeeShareBps: bigint | null;
  marketOwnerFeeRecipient: string | null;
}> {
  const contract = new ethers.Contract(marketAddress, FEE_VIEW_ABI, provider);

  const result = {
    owner: null as string | null,
    feeRecipient: null as string | null,
    marginRequirementBps: null as bigint | null,
    legacyTradingFee: null as bigint | null,
    takerFeeBps: null as bigint | null,
    makerFeeBps: null as bigint | null,
    protocolFeeRecipient: null as string | null,
    protocolFeeShareBps: null as bigint | null,
    marketOwnerFeeRecipient: null as string | null,
  };

  try {
    result.owner = await withRetry(() => contract.owner());
  } catch {
    // owner() may not exist on all contracts
  }

  try {
    const [marginReq, fee, recipient] = await withRetry(() => contract.getTradingParameters());
    result.marginRequirementBps = BigInt(marginReq);
    result.legacyTradingFee = BigInt(fee);
    result.feeRecipient = String(recipient);
  } catch (e: any) {
    console.log(`  ⚠️  getTradingParameters() failed: ${e?.message || String(e)}`);
  }

  try {
    const [takerBps, makerBps, protoRecipient, protoShareBps, legacyFee, ownerRecipient] =
      await withRetry(() => contract.getFeeStructure());
    result.takerFeeBps = BigInt(takerBps);
    result.makerFeeBps = BigInt(makerBps);
    result.protocolFeeRecipient = String(protoRecipient);
    result.protocolFeeShareBps = BigInt(protoShareBps);
    result.marketOwnerFeeRecipient = String(ownerRecipient);
    if (result.legacyTradingFee === null) result.legacyTradingFee = BigInt(legacyFee);
  } catch (e: any) {
    console.log(`  ⚠️  getFeeStructure() failed (may not be deployed): ${e?.message || String(e)}`);
  }

  return result;
}

function printFeeReport(
  label: string,
  marketAddress: string,
  supabaseCreator: string | null | undefined,
  fees: Awaited<ReturnType<typeof readFeeRecipients>>
) {
  const sep = '═'.repeat(70);
  const thin = '─'.repeat(70);

  console.log(`\n${sep}`);
  console.log(`  Market: ${label}`);
  console.log(`  OrderBook: ${marketAddress}`);
  console.log(sep);

  console.log('\n  CONTRACT OWNER');
  console.log(thin);
  console.log(`  owner():                    ${fees.owner ?? '(unavailable)'}`);

  console.log('\n  FEE RECIPIENTS');
  console.log(thin);
  console.log(`  Market Owner (on-chain):    ${fees.marketOwnerFeeRecipient ?? fees.feeRecipient ?? '(unavailable)'}`);
  console.log(`  Protocol Fee Recipient:     ${fees.protocolFeeRecipient ?? '(unavailable)'}`);
  console.log(`  Creator Wallet (Supabase):  ${supabaseCreator ?? '(not set)'}`);

  const onChainOwnerRecipient = fees.marketOwnerFeeRecipient ?? fees.feeRecipient;
  if (onChainOwnerRecipient && supabaseCreator) {
    const match = onChainOwnerRecipient.toLowerCase() === supabaseCreator.toLowerCase();
    console.log(
      `  On-chain ↔ Supabase match:  ${match ? '✅ YES' : '❌ NO — feeRecipient does not match creator_wallet_address'}`
    );
  }

  console.log('\n  FEE PARAMETERS');
  console.log(thin);

  if (fees.takerFeeBps !== null) {
    console.log(`  Taker Fee:                  ${fees.takerFeeBps.toString()} bps (${bpsToPercent(fees.takerFeeBps)})`);
  }
  if (fees.makerFeeBps !== null) {
    console.log(`  Maker Fee:                  ${fees.makerFeeBps.toString()} bps (${bpsToPercent(fees.makerFeeBps)})`);
  }
  if (fees.protocolFeeShareBps !== null) {
    console.log(`  Protocol Fee Share:         ${fees.protocolFeeShareBps.toString()} bps (${bpsToPercent(fees.protocolFeeShareBps)})`);
  }
  if (fees.marginRequirementBps !== null) {
    console.log(`  Margin Requirement:         ${fees.marginRequirementBps.toString()} bps (${bpsToPercent(fees.marginRequirementBps)})`);
  }
  if (fees.legacyTradingFee !== null) {
    console.log(`  Legacy Trading Fee (raw):   ${fees.legacyTradingFee.toString()}`);
  }

  console.log('');
}

const SWEEP_MODE = process.argv.includes('--sweep');

async function runSweep(provider: ethers.JsonRpcProvider, all: MarketRow[]) {
  console.log(`\n🔍 Sweeping ${all.length} market(s) with retry logic (3 retries per call)...\n`);

  const results: SweepResult[] = [];
  for (let i = 0; i < all.length; i++) {
    const m = all[i];
    if (!m.market_address || !ethers.isAddress(m.market_address)) continue;

    const label = (m.market_identifier || m.metric_id || m.symbol || m.id) ?? '?';
    process.stdout.write(`  [${i + 1}/${all.length}] ${padRight(label, 35)} `);

    const r = await sweepMarket(provider, m, i);
    results.push(r);

    const icons: Record<FeeHealth, string> = {
      HEALTHY: '✅',
      FEES_UNCONFIGURED: '⚠️ ',
      LEGACY_FACET: '🔧',
      RECIPIENT_MISMATCH: '❌',
      NO_CREATOR: '❓',
      RPC_ERROR: '🌐',
      UNKNOWN_ERROR: '💀',
    };
    console.log(`${icons[r.health]} ${r.health}${r.errorMsg ? ` (${r.errorMsg.slice(0, 50)})` : ''}`);
  }

  printSweepResults(results);
}

async function main() {
  loadEnv();

  console.log('--- Interactive Fee Recipient Viewer ---');
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

  console.log(`Loaded ${all.length} deployed market(s) from Supabase.\n`);

  if (SWEEP_MODE) {
    await runSweep(provider, all);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const filter = (
        await rl.question(
          'Commands:\n' +
            '  [enter]  List all markets for individual inspection\n' +
            '  [s]      Sweep all — full health check with retry logic\n' +
            '  [q]      Quit\n' +
            '  [text]   Filter markets by keyword\n' +
            'Choice: '
        )
      ).trim();

      if (filter.toLowerCase() === 'q') return;

      // ── Sweep mode ──
      if (filter.toLowerCase() === 's') {
        await runSweep(provider, all);
        continue;
      }

      // ── List / filter mode ──
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
          `[${i}] ${label} | chain=${m.chain_id ?? '?'} ${m.network ?? ''} | OB=${shortAddr(m.market_address)} | creator=${shortAddr(m.creator_wallet_address)}`
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

      const label = picked.market_identifier || picked.metric_id || picked.symbol || picked.id;
      console.log(`\nReading on-chain fee structure for ${label}...`);

      const fees = await readFeeRecipients(provider, picked.market_address);
      printFeeReport(label, picked.market_address, picked.creator_wallet_address, fees);
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});
