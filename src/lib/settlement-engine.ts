import { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getMetricAIWorkerBaseUrl } from './metricAiWorker';

// ── Types ──

export type MarketRow = {
  id: string;
  name: string | null;
  description: string | null;
  market_identifier: string;
  market_address: string | null;
  market_status: string;
  settlement_date: string | null;
  proposed_settlement_value: number | null;
  proposed_settlement_at: string | null;
  settlement_window_expires_at: string | null;
  settlement_disputed: boolean | null;
  market_config: Record<string, unknown> | null;
  initial_order: Record<string, unknown> | null;
  ai_source_locator: Record<string, unknown> | null;
};

export type TickResult = {
  marketId: string;
  marketIdentifier: string;
  action: string;
  ok: boolean;
  settlementDate?: string | null;
  settlementWindowExpiresAt?: string | null;
  reason?: string;
  details?: Record<string, unknown>;
};

export type TickResponse = {
  ok: boolean;
  mode: string;
  scanned?: number;
  results?: TickResult[];
  skipped?: boolean;
  reason?: string;
  settlesAt?: string | null;
  result?: TickResult;
  error?: string;
};

// ── Config (read once at module load, mirrors the edge function defaults) ──

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw || '');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

function resolveMetricAiWorkerUrl(): string {
  try {
    return getMetricAIWorkerBaseUrl();
  } catch {
    return (process.env.METRIC_AI_WORKER_URL || process.env.NEXT_PUBLIC_METRIC_AI_WORKER_URL || '').replace(/\/+$/, '');
  }
}

function getConfig() {
  return {
    rpcUrl: process.env.RPC_URL || process.env.JSON_RPC_URL || '',
    privateKey: process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    metricAiWorkerUrl: resolveMetricAiWorkerUrl(),
    tickLimit: parsePositiveInt(process.env.SETTLEMENT_TICK_LIMIT, 50),
    defaultWindowSeconds: parsePositiveInt(process.env.SETTLEMENT_WINDOW_SECONDS, 24 * 60 * 60),
    onchainDriftToleranceSeconds: parsePositiveInt(process.env.SETTLEMENT_CHAIN_DRIFT_TOLERANCE_SECONDS, 5 * 60),
    requireOnchainSettlementCheck: parseBool(process.env.REQUIRE_ONCHAIN_SETTLEMENT_CHECK, false),
  };
}

// ── Utilities ──

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeDateMs(input: string | null | undefined): number | null {
  if (!input) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

function isWindowActive(market: MarketRow): boolean {
  const exp = safeDateMs(market.settlement_window_expires_at);
  return exp !== null && exp > Date.now();
}

function metricUrlsForMarket(market: MarketRow): string[] {
  const urls: string[] = [];
  const cfg = asRecord(market.market_config);
  const initial = asRecord(market.initial_order);
  const aiLocator = asRecord(cfg.ai_source_locator);

  const candidates = [
    initial.metricUrl,
    initial.metric_url,
    aiLocator.url,
    aiLocator.primary_source_url,
    cfg.metric_source_url,
  ];

  for (const c of candidates) {
    const value = typeof c === 'string' ? c.trim() : '';
    if (value && !urls.includes(value)) urls.push(value);
  }
  return urls;
}

function nextMarketConfig(
  market: MarketRow,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const cfg = asRecord(market.market_config);
  const scheduler = asRecord(cfg.settlement_scheduler);
  return {
    ...cfg,
    settlement_scheduler: {
      ...scheduler,
      ...patch,
    },
  };
}

// ── AI price determination ──

async function getAIPriceDetermination(
  market: MarketRow,
): Promise<{ price: number; jobId: string; waybackUrl: string | null; waybackPageUrl: string | null; screenshotUrl: string | null } | null> {
  const { metricAiWorkerUrl } = getConfig();
  if (!metricAiWorkerUrl) {
    console.warn('[settlement-engine] metricAiWorkerUrl is empty, cannot determine AI price');
    return null;
  }
  const urls = metricUrlsForMarket(market);
  if (urls.length === 0) {
    console.warn(`[settlement-engine] no metric URLs found for ${market.market_identifier}`);
    return null;
  }

  const richDescription = [
    `Settlement price determination for "${market.name || market.market_identifier}".`,
    market.description ? `Market description: ${market.description}.` : '',
    `Metric source URL(s): ${urls.join(', ')}.`,
    `Find the current numeric value of this metric from the source page(s).`,
  ].filter(Boolean).join(' ');

  console.log(`[settlement-engine] requesting AI price for ${market.market_identifier}`, { metricAiWorkerUrl, urls, richDescription });
  const startRes = await fetch(`${metricAiWorkerUrl}/api/metric-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metric: market.name || market.market_identifier,
      description: richDescription,
      urls,
      related_market_id: market.id,
      related_market_identifier: market.market_identifier,
      context: 'settlement',
    }),
  });

  if (startRes.status !== 202) {
    const errBody = await startRes.text().catch(() => '');
    console.warn(`[settlement-engine] AI worker returned ${startRes.status} for ${market.market_identifier}`, errBody.slice(0, 500));
    return null;
  }
  const startJson = await startRes.json().catch(() => ({}));
  const jobId = typeof startJson?.jobId === 'string' ? startJson.jobId : '';
  if (!jobId) {
    console.warn(`[settlement-engine] AI worker returned no jobId for ${market.market_identifier}`);
    return null;
  }
  console.log(`[settlement-engine] AI job started: ${jobId} for ${market.market_identifier}`);

  const timeoutMs = 30_000;
  const pollEveryMs = 2_000;
  const startTs = Date.now();

  while (Date.now() - startTs < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollEveryMs));
    const pollRes = await fetch(
      `${metricAiWorkerUrl}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`,
      { cache: 'no-store' },
    );
    const pollJson = await pollRes.json().catch(() => ({}));
    if (pollJson?.status === 'completed' && pollJson?.result) {
      const candidate = Number(
        pollJson.result?.asset_price_suggestion ?? pollJson.result?.value,
      );
      if (Number.isFinite(candidate) && candidate > 0) {
        const waybackUrl: string | null =
          pollJson.result?.settlement_wayback_url
          || pollJson.result?.sources?.[0]?.wayback_screenshot_url
          || null;
        const waybackPageUrl: string | null =
          pollJson.result?.settlement_wayback_page_url
          || pollJson.result?.sources?.[0]?.wayback_url
          || null;
        const screenshotUrl: string | null =
          pollJson.result?.sources?.[0]?.screenshot_url
          || null;
        return { price: candidate, jobId, waybackUrl, waybackPageUrl, screenshotUrl };
      }
      return null;
    }
    if (pollJson?.status === 'failed') return null;
  }
  return null;
}

// ── On-chain helpers ──

async function verifyOnchainSettlementTime(
  market: MarketRow,
): Promise<{ ok: boolean; reason?: string; chainTs?: number }> {
  const cfg = getConfig();
  if (!cfg.requireOnchainSettlementCheck) return { ok: true };
  if (!cfg.rpcUrl) return { ok: false, reason: 'rpc_not_configured' };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, reason: 'invalid_market_address' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const lifecycle = new ethers.Contract(
      market.market_address,
      ['function getSettlementTimestamp() external view returns (uint256)'],
      provider,
    );
    const chainTsBig: bigint = await lifecycle.getSettlementTimestamp();
    const chainTs = Number(chainTsBig);
    if (!Number.isFinite(chainTs) || chainTs <= 0) {
      return { ok: false, reason: 'invalid_chain_timestamp' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (chainTs > nowSec) return { ok: false, reason: 'chain_settlement_not_due', chainTs };

    const dbMs = safeDateMs(market.settlement_date);
    if (dbMs !== null) {
      const dbSec = Math.floor(dbMs / 1000);
      if (Math.abs(dbSec - chainTs) > cfg.onchainDriftToleranceSeconds) {
        return { ok: false, reason: 'chain_db_settlement_mismatch', chainTs };
      }
    }

    return { ok: true, chainTs };
  } catch (err) {
    return { ok: false, reason: `chain_check_failed:${String(err)}` };
  }
}

async function settlementSyncLifecycleOnChain(
  market: MarketRow,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getConfig();
  if (!cfg.rpcUrl || !cfg.privateKey) return { ok: false, error: 'rpc_or_key_not_configured' };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, error: 'invalid_market_address' };
  }
  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const wallet = new ethers.Wallet(cfg.privateKey, provider);
    const contract = new ethers.Contract(
      market.market_address,
      ['function syncLifecycle() external returns (uint8 previousState, uint8 newState)'],
      wallet,
    );
    const tx = await contract.syncLifecycle();
    await tx.wait();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `sync_lifecycle_failed:${String(err)}` };
  }
}

async function commitEvidenceOnChain(
  market: MarketRow,
  waybackUrl: string,
): Promise<{ ok: boolean; evidenceHash?: string; error?: string }> {
  const cfg = getConfig();
  if (!cfg.rpcUrl || !cfg.privateKey) return { ok: false, error: 'rpc_or_key_not_configured' };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, error: 'invalid_market_address' };
  }
  try {
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(waybackUrl));
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const wallet = new ethers.Wallet(cfg.privateKey, provider);
    const contract = new ethers.Contract(
      market.market_address,
      ['function commitEvidence(string calldata evidenceUrl) external'],
      wallet,
    );
    const tx = await contract.commitEvidence(waybackUrl);
    await tx.wait();
    console.log(`[settlement-engine] evidence committed on-chain: ${evidenceHash} (url: ${waybackUrl})`);
    return { ok: true, evidenceHash };
  } catch (err) {
    return { ok: false, error: `commit_evidence_failed:${String(err)}` };
  }
}

async function finalizeOnChain(
  market: MarketRow,
  finalPrice: number,
): Promise<{ ok: boolean; txHash?: string; reason?: string }> {
  const cfg = getConfig();
  if (!cfg.rpcUrl) return { ok: false, reason: 'rpc_not_configured' };
  if (!cfg.privateKey) return { ok: false, reason: 'private_key_not_configured' };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, reason: 'invalid_market_address' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const wallet = new ethers.Wallet(cfg.privateKey, provider);
    const ob = new ethers.Contract(
      market.market_address,
      ['function settleMarket(uint256 finalPrice) external'],
      wallet,
    );
    const tx = await ob.settleMarket(ethers.parseUnits(finalPrice.toString(), 6));
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (err) {
    return { ok: false, reason: `onchain_settle_failed:${String(err)}` };
  }
}

// ── Core settlement logic ──

async function maybeStartSettlementWindow(
  supabase: SupabaseClient,
  market: MarketRow,
): Promise<TickResult> {
  if (market.market_status !== 'ACTIVE') {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'status_not_active',
    };
  }

  if (isWindowActive(market)) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'window_already_active',
    };
  }

  const syncResult = await settlementSyncLifecycleOnChain(market);
  if (!syncResult.ok) {
    console.warn(`[settlement-engine] syncLifecycle warning for ${market.market_identifier}: ${syncResult.error}`);
  }

  const chainCheck = await verifyOnchainSettlementTime(market);
  if (!chainCheck.ok) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: chainCheck.reason || 'chain_check_failed',
      details: { chainTs: chainCheck.chainTs ?? null },
    };
  }

  const ai = await getAIPriceDetermination(market);
  if (!ai) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'ai_price_failed',
    };
  }

  // Commit evidence hash on-chain before anything else (tamper-proof commitment).
  // Use waybackPageUrl (the archived page) as the canonical evidence source; fall back to waybackUrl.
  const evidenceUrl = ai.waybackPageUrl || ai.waybackUrl;
  let evidenceHash: string | null = null;
  if (evidenceUrl) {
    const commitResult = await commitEvidenceOnChain(market, evidenceUrl);
    if (commitResult.ok) {
      evidenceHash = commitResult.evidenceHash ?? null;
    } else {
      console.warn(`[settlement-engine] evidence hash commit warning for ${market.market_identifier}: ${commitResult.error}`);
    }
  }

  const { defaultWindowSeconds } = getConfig();
  const cfg = asRecord(market.market_config);
  const perMarketWindow = typeof cfg.settlement_window_seconds === 'number' && cfg.settlement_window_seconds > 0
    ? cfg.settlement_window_seconds
    : defaultWindowSeconds;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + perMarketWindow * 1000);

  const updatedConfig = nextMarketConfig(market, {
    stage: 'window_started',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    ai_job_id: ai.jobId,
  });
  if (ai.waybackUrl) {
    updatedConfig.settlement_wayback_url = ai.waybackUrl;
  }
  if (ai.waybackPageUrl) {
    updatedConfig.settlement_wayback_page_url = ai.waybackPageUrl;
  }
  if (ai.screenshotUrl) {
    updatedConfig.settlement_screenshot_url = ai.screenshotUrl;
  }
  if (evidenceHash) {
    updatedConfig.settlement_evidence_hash = evidenceHash;
  }

  const { error } = await supabase
    .from('markets')
    .update({
      proposed_settlement_value: ai.price,
      proposed_settlement_at: now.toISOString(),
      settlement_window_expires_at: expiresAt.toISOString(),
      proposed_settlement_by: 'AI_SYSTEM',
      market_status: 'SETTLEMENT_REQUESTED',
      market_config: updatedConfig,
      updated_at: now.toISOString(),
    })
    .eq('id', market.id)
    .eq('market_status', 'ACTIVE');

  if (error) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: `db_update_failed:${error.message}`,
    };
  }

  return {
    marketId: market.id, marketIdentifier: market.market_identifier,
    action: 'start_window', ok: true,
    settlementDate: market.settlement_date,
    settlementWindowExpiresAt: expiresAt.toISOString(),
    details: { aiPrice: ai.price, aiJobId: ai.jobId, expiresAt: expiresAt.toISOString(), waybackUrl: ai.waybackUrl, waybackPageUrl: ai.waybackPageUrl, evidenceHash },
  };
}

async function maybeFinalizeSettlement(
  supabase: SupabaseClient,
  market: MarketRow,
): Promise<TickResult> {
  if (market.market_status !== 'SETTLEMENT_REQUESTED') {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'status_not_settlement_requested',
    };
  }

  if (market.settlement_disputed === true) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'settlement_disputed',
    };
  }

  const syncResult = await settlementSyncLifecycleOnChain(market);
  if (!syncResult.ok) {
    console.warn(`[settlement-engine] syncLifecycle warning for ${market.market_identifier}: ${syncResult.error}`);
  }

  const exp = safeDateMs(market.settlement_window_expires_at);
  if (exp === null || exp > Date.now()) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'window_not_expired',
    };
  }

  const ai = await getAIPriceDetermination(market);
  if (!ai) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: 'ai_final_price_failed',
    };
  }

  let txHash: string | null = null;
  const settle = await finalizeOnChain(market, ai.price);
  if (!settle.ok) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: settle.reason || 'onchain_finalize_failed',
    };
  }
  txHash = settle.txHash || null;

  const now = new Date().toISOString();
  const finalConfig = nextMarketConfig(market, {
    stage: 'settled',
    settled_at: now,
    ai_job_id: ai.jobId,
    tx_hash: txHash,
  });
  if (ai.waybackUrl) {
    finalConfig.settlement_wayback_url = ai.waybackUrl;
  }
  if (ai.waybackPageUrl) {
    finalConfig.settlement_wayback_page_url = ai.waybackPageUrl;
  }
  if (ai.screenshotUrl) {
    finalConfig.settlement_screenshot_url = ai.screenshotUrl;
  }

  const { error } = await supabase
    .from('markets')
    .update({
      market_status: 'SETTLED',
      settlement_value: ai.price,
      settlement_timestamp: now,
      market_config: finalConfig,
      updated_at: now,
    })
    .eq('id', market.id)
    .eq('market_status', 'SETTLEMENT_REQUESTED');

  if (error) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: `db_finalize_failed:${error.message}`,
    };
  }

  return {
    marketId: market.id, marketIdentifier: market.market_identifier,
    action: 'finalize', ok: true,
    settlementDate: market.settlement_date,
    settlementWindowExpiresAt: market.settlement_window_expires_at,
    details: { aiPrice: ai.price, aiJobId: ai.jobId, txHash },
  };
}

// ── Public API ──

const MARKET_SELECT = `
  id,
  name,
  description,
  market_identifier,
  market_address,
  market_status,
  settlement_date,
  proposed_settlement_value,
  proposed_settlement_at,
  settlement_window_expires_at,
  settlement_disputed,
  market_config,
  initial_order,
  ai_source_locator
`;

/**
 * Batch scan: find all due markets and start/finalize settlement as appropriate.
 */
export async function runSettlementTick(supabase: SupabaseClient): Promise<TickResponse> {
  const { tickLimit } = getConfig();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .in('market_status', ['ACTIVE', 'SETTLEMENT_REQUESTED'])
    .lte('settlement_date', nowIso)
    .eq('is_active', true)
    .order('settlement_date', { ascending: true })
    .limit(tickLimit);

  if (error) {
    return { ok: false, mode: 'tick', error: `scan_failed:${error.message}` };
  }

  const markets = (data || []) as MarketRow[];
  const results: TickResult[] = [];

  for (const market of markets) {
    if (market.market_status === 'ACTIVE') {
      results.push(await maybeStartSettlementWindow(supabase, market));
    } else if (market.market_status === 'SETTLEMENT_REQUESTED') {
      results.push(await maybeFinalizeSettlement(supabase, market));
    }
  }

  return { ok: true, mode: 'tick', scanned: markets.length, results };
}

/**
 * Single-market check: verify if a specific market is due and act accordingly.
 */
export async function runSingleSettlementCheck(
  supabase: SupabaseClient,
  marketId: string,
): Promise<TickResponse> {
  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('id', marketId)
    .maybeSingle();

  if (error) return { ok: false, mode: 'single_check', error: `market_fetch_failed:${error.message}` };
  if (!data) return { ok: false, mode: 'single_check', error: 'market_not_found' };

  const market = data as MarketRow;
  const settlementMs = safeDateMs(market.settlement_date);
  if (settlementMs === null) {
    return { ok: false, mode: 'single_check', error: 'invalid_settlement_date' };
  }

  if (settlementMs > Date.now()) {
    return {
      ok: true, mode: 'single_check',
      skipped: true, reason: 'settlement_not_due',
      settlesAt: market.settlement_date,
    };
  }

  let result: TickResult;
  if (market.market_status === 'ACTIVE') {
    result = await maybeStartSettlementWindow(supabase, market);
  } else if (market.market_status === 'SETTLEMENT_REQUESTED') {
    result = await maybeFinalizeSettlement(supabase, market);
  } else {
    result = {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: 'single_check',
      ok: false,
      reason: 'unsupported_status',
    };
  }

  return { ok: true, mode: 'single_check', result };
}

/**
 * Explicitly start the settlement window for a market, bypassing the
 * "settlement_not_due" date guard. Used when QStash fires settlement_start
 * before the settlement date (challenge window should be open BEFORE T0
 * so it expires right when the market finalises).
 */
export async function forceStartSettlementWindow(
  supabase: SupabaseClient,
  marketId: string,
): Promise<TickResponse> {
  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('id', marketId)
    .maybeSingle();

  if (error) return { ok: false, mode: 'settlement_start', error: `market_fetch_failed:${error.message}` };
  if (!data) return { ok: false, mode: 'settlement_start', error: 'market_not_found' };

  const market = data as MarketRow;

  if (market.market_status !== 'ACTIVE') {
    return {
      ok: true, mode: 'settlement_start',
      skipped: true, reason: `status_is_${market.market_status}`,
    };
  }

  const result = await maybeStartSettlementWindow(supabase, market);
  return { ok: true, mode: 'settlement_start', result };
}
