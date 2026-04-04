import { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getMetricAIWorkerBaseUrl } from './metricAiWorker';
import { loadRelayerPoolFromEnv } from './relayerKeys';

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
  alternative_settlement_value: number | null;
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
    settlementAiPollTimeoutMs: parsePositiveInt(process.env.SETTLEMENT_AI_POLL_TIMEOUT_MS, 120_000),
  };
}

/** Base URL used for AI worker webhooks (must be reachable from the worker process). */
function normalizeAppUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
}

/**
 * Webhook callbacks from the metric-ai-worker cannot reach localhost / missing APP_URL.
 * In those cases we must poll the worker from this app and complete settlement inline.
 */
function shouldUseInlineSettlementAi(): boolean {
  if (parseBool(process.env.SETTLEMENT_AI_INLINE, false)) return true;
  const appUrl = normalizeAppUrl();
  if (!appUrl) return true;
  try {
    const u = new URL(appUrl);
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
    if (h.endsWith('.local')) return true;
    return false;
  } catch {
    return true;
  }
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

// Challenge window opens AT settlement_date (T0) and runs for challengeWindow
// seconds AFTER T0. Finalize fires at T0 + challengeWindow + buffer.
function challengeWindowMs(market: MarketRow): number {
  const cfg = asRecord(market.market_config);
  const explicit = Number(cfg.challenge_window_seconds || cfg.challenge_duration_seconds || 0);
  if (explicit > 0) return explicit * 1000;
  return getConfig().defaultWindowSeconds * 1000;
}

function windowExpiryMs(market: MarketRow): number | null {
  const stl = safeDateMs(market.settlement_date);
  if (stl === null) return null;
  return stl + challengeWindowMs(market);
}

function isWindowActive(market: MarketRow): boolean {
  const exp = windowExpiryMs(market);
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

/**
 * Poll the metric-ai-worker until a price is returned (used by cron and inline settlement).
 */
export async function getAIPriceDetermination(
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

  const maxRetries = parsePositiveInt(process.env.SETTLEMENT_AI_MAX_RETRIES, 3);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      console.log(`[settlement-engine] retrying AI price for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`);
    }

    const richDescription = [
      `Settlement price determination for "${market.name || market.market_identifier}".`,
      market.description ? `Market description: ${market.description}.` : '',
      `Metric source URL(s): ${urls.join(', ')}.`,
      `Find the current numeric value of this metric from the source page(s).`,
    ].filter(Boolean).join(' ');

    console.log(`[settlement-engine] requesting AI price for ${market.market_identifier}`, { metricAiWorkerUrl, urls, attempt });
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
      console.warn(`[settlement-engine] AI worker returned ${startRes.status} for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`, errBody.slice(0, 500));
      continue;
    }
    const startJson = await startRes.json().catch(() => ({}));
    const jobId = typeof startJson?.jobId === 'string' ? startJson.jobId : '';
    if (!jobId) {
      console.warn(`[settlement-engine] AI worker returned no jobId for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`);
      continue;
    }
    console.log(`[settlement-engine] AI job started: ${jobId} for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`);

    const timeoutMs = getConfig().settlementAiPollTimeoutMs;
    const pollEveryMs = 2_000;
    const startTs = Date.now();
    let shouldRetry = false;

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
        console.warn(`[settlement-engine] AI returned zero/invalid price for ${market.market_identifier} (attempt ${attempt}/${maxRetries}): ${candidate}`);
        shouldRetry = true;
        break;
      }
      if (pollJson?.status === 'failed') {
        console.warn(`[settlement-engine] AI job failed for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`);
        shouldRetry = true;
        break;
      }
    }

    if (!shouldRetry) {
      console.warn(`[settlement-engine] AI job timed out for ${market.market_identifier} (attempt ${attempt}/${maxRetries})`);
    }
  }

  console.error(`[settlement-engine] all ${maxRetries} AI price attempts exhausted for ${market.market_identifier}, not proposing settlement`);
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

export async function settlementSyncLifecycleOnChain(
  market: MarketRow,
): Promise<{ ok: boolean; previousState?: number; newState?: number; error?: string }> {
  const cfg = getConfig();
  if (!cfg.rpcUrl) return { ok: false, error: 'rpc_not_configured' };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, error: 'invalid_market_address' };
  }

  const relayers = loadRelayerPoolFromEnv({
    pool: 'lifecycle_sync',
    globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
    allowFallbackSingleKey: true,
  });
  if (relayers.length === 0) {
    return { ok: false, error: 'no_relayer_keys_configured' };
  }

  const relayer = relayers[Math.floor(Math.random() * relayers.length)];

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const wallet = new ethers.Wallet(relayer.privateKey, provider);
    const contract = new ethers.Contract(
      market.market_address,
      ['function syncLifecycle() external returns (uint8 previousState, uint8 newState)'],
      wallet,
    );
    const tx = await contract.syncLifecycle();
    const receipt = await tx.wait();

    let previousState: number | undefined;
    let newState: number | undefined;
    const iface = new ethers.Interface([
      'event LifecycleSync(address indexed market, address indexed caller, uint8 previousState, uint8 newState, bool progressed, bool devMode, bool settledOnChain, uint256 rolloverWindowStart, uint256 challengeWindowStart, uint256 challengeWindowEnd, uint256 timestamp)',
    ]);
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'LifecycleSync') {
          previousState = Number(parsed.args.previousState);
          newState = Number(parsed.args.newState);
        }
      } catch {}
    }

    console.log(`[settlement-engine] syncLifecycle via relayer ${relayer.address} for ${market.market_identifier}`, {
      previousState, newState, txHash: receipt?.hash,
    });
    return { ok: true, previousState, newState };
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

async function resolveChallengeOnChain(
  market: MarketRow,
  challengerWon: boolean,
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
    const contract = new ethers.Contract(
      market.market_address,
      ['function resolveChallenge(bool challengerWins) external'],
      wallet,
    );
    const tx = await contract.resolveChallenge(challengerWon);
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (err) {
    return { ok: false, reason: `resolve_challenge_failed:${String(err)}` };
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

      reason: 'status_not_active',
    };
  }

  if (isWindowActive(market)) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,

      reason: 'window_already_active',
    };
  }

  const ai = await getAIPriceDetermination(market);
  if (!ai) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'start_window', ok: false,
      settlementDate: market.settlement_date,

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

  const now = new Date();
  const settlementMs = safeDateMs(market.settlement_date);
  const cwMs = challengeWindowMs(market);
  const expiresAt = settlementMs
    ? new Date(Math.max(settlementMs + cwMs, now.getTime() + 60_000))
    : new Date(now.getTime() + getConfig().defaultWindowSeconds * 1000);

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

      reason: `db_update_failed:${error.message}`,
    };
  }

  const syncResult = await settlementSyncLifecycleOnChain(market);
  if (!syncResult.ok) {
    console.warn(`[settlement-engine] syncLifecycle at window start warning for ${market.market_identifier}: ${syncResult.error}`);
  }

  return {
    marketId: market.id, marketIdentifier: market.market_identifier,
    action: 'start_window', ok: true,
    settlementDate: market.settlement_date,
    details: { aiPrice: ai.price, aiJobId: ai.jobId, expiresAt: expiresAt.toISOString(), waybackUrl: ai.waybackUrl, waybackPageUrl: ai.waybackPageUrl, evidenceHash, lifecycleSync: syncResult },
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

      reason: 'status_not_settlement_requested',
    };
  }

  let umaDisputeNeedsOnChainResolution = false;
  let umaChallengerWon = false;

  if (market.settlement_disputed === true) {
    const cfg = asRecord(market.market_config);
    const umaResolved = cfg.uma_resolved === true;

    if (!umaResolved) {
      return {
        marketId: market.id, marketIdentifier: market.market_identifier,
        action: 'finalize', ok: false,
        settlementDate: market.settlement_date,
        reason: 'settlement_disputed_awaiting_uma',
      };
    }

    umaChallengerWon = cfg.uma_challenger_won === true;
    umaDisputeNeedsOnChainResolution = true;

    if (umaChallengerWon) {
      const challengerPrice = market.alternative_settlement_value
        ?? (cfg.uma_winning_price as number | undefined);
      if (challengerPrice && Number.isFinite(challengerPrice) && challengerPrice > 0) {
        market.proposed_settlement_value = challengerPrice;
        console.log(`[settlement-engine] UMA resolved: challenger won for ${market.market_identifier}, adopting price ${challengerPrice}`);
      } else {
        console.warn(`[settlement-engine] UMA challenger won but no valid winning price for ${market.market_identifier}`);
        return {
          marketId: market.id, marketIdentifier: market.market_identifier,
          action: 'finalize', ok: false,
          settlementDate: market.settlement_date,
          reason: 'uma_challenger_won_no_valid_price',
        };
      }
    } else {
      console.log(`[settlement-engine] UMA resolved: proposer won for ${market.market_identifier}, keeping original price`);
    }
  }

  const syncResult = await settlementSyncLifecycleOnChain(market);
  if (!syncResult.ok) {
    console.warn(`[settlement-engine] syncLifecycle warning for ${market.market_identifier}: ${syncResult.error}`);
  }

  const exp = windowExpiryMs(market);
  if (exp === null || exp > Date.now()) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: exp !== null ? new Date(exp).toISOString() : market.settlement_date,
      reason: 'window_not_expired',
    };
  }

  let proposedPrice = market.proposed_settlement_value;
  if (proposedPrice === null || proposedPrice === undefined || !Number.isFinite(proposedPrice) || proposedPrice <= 0) {
    console.warn(`[settlement-engine] no proposed_settlement_value for ${market.market_identifier}, attempting inline AI price fetch`);
    const ai = await getAIPriceDetermination(market);
    if (ai && Number.isFinite(ai.price) && ai.price > 0) {
      proposedPrice = ai.price;

      const healNow = new Date();
      const healSettlementMs = safeDateMs(market.settlement_date);
      const healCwMs = challengeWindowMs(market);
      const healExpires = healSettlementMs
        ? new Date(Math.max(healSettlementMs + healCwMs, healNow.getTime() + 60_000))
        : new Date(healNow.getTime() + getConfig().defaultWindowSeconds * 1000);

      const healConfig = nextMarketConfig(market, {
        stage: 'window_started',
        started_at: healNow.toISOString(),
        expires_at: healExpires.toISOString(),
        ai_job_id: ai.jobId,
        healed: true,
      });

      const { error: healErr } = await supabase
        .from('markets')
        .update({
          proposed_settlement_value: ai.price,
          proposed_settlement_at: healNow.toISOString(),

          proposed_settlement_by: 'AI_SYSTEM_HEALED',
          market_config: healConfig,
          updated_at: healNow.toISOString(),
        })
        .eq('id', market.id);

      if (healErr) {
        console.error(`[settlement-engine] self-heal DB update failed for ${market.market_identifier}: ${healErr.message}`);
        return {
          marketId: market.id, marketIdentifier: market.market_identifier,
          action: 'finalize', ok: false,
          settlementDate: market.settlement_date,
    
          reason: 'self_heal_db_update_failed',
        };
      }

      console.log(`[settlement-engine] self-healed proposed_settlement_value for ${market.market_identifier}`, {
        price: ai.price, jobId: ai.jobId, expiresAt: healExpires.toISOString(),
      });

      return {
        marketId: market.id, marketIdentifier: market.market_identifier,
        action: 'finalize', ok: false,
        settlementDate: market.settlement_date,
        reason: 'self_healed_reopened_window',
        details: { aiPrice: ai.price, aiJobId: ai.jobId, newExpiresAt: healExpires.toISOString() },
      };
    }

    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,

      reason: 'no_proposed_settlement_value',
    };
  }

  // If UMA resolved a dispute, call resolveChallenge() on HL before settling
  if (umaDisputeNeedsOnChainResolution && market.market_address) {
    const resolveResult = await resolveChallengeOnChain(market, umaChallengerWon);
    if (!resolveResult.ok) {
      console.warn(`[settlement-engine] resolveChallenge warning for ${market.market_identifier}: ${resolveResult.reason}`);
    } else {
      console.log(`[settlement-engine] resolveChallenge on HL for ${market.market_identifier}: challengerWon=${umaChallengerWon}`);
    }
  }

  let txHash: string | null = null;
  const settle = await finalizeOnChain(market, proposedPrice);
  if (!settle.ok) {
    return {
      marketId: market.id, marketIdentifier: market.market_identifier,
      action: 'finalize', ok: false,
      settlementDate: market.settlement_date,

      reason: settle.reason || 'onchain_finalize_failed',
    };
  }
  txHash = settle.txHash || null;

  const now = new Date().toISOString();
  const finalConfig = nextMarketConfig(market, {
    stage: 'settled',
    settled_at: now,
    tx_hash: txHash,
  });

  const { error } = await supabase
    .from('markets')
    .update({
      market_status: 'SETTLED',
      settlement_value: proposedPrice,
      settlement_timestamp: now,
      settlement_disputed: false,
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

      reason: `db_finalize_failed:${error.message}`,
    };
  }

  return {
    marketId: market.id, marketIdentifier: market.market_identifier,
    action: 'finalize', ok: true,
    settlementDate: market.settlement_date,
    details: { settledPrice: proposedPrice, txHash },
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
  alternative_settlement_value,
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

  // SETTLEMENT_REQUESTED markets bypass the settlement_not_due guard because
  // their challenge window opens at T0 and expires at T0 + challengeWindow.
  // maybeFinalizeSettlement has its own window-expiry check.
  if (settlementMs > Date.now() && market.market_status !== 'SETTLEMENT_REQUESTED') {
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
 * Fire the AI price discovery bot for a market. This is best-effort — the
 * AI bot acts as a public participant proposing a settlement price in good
 * faith. If AI fails, the challenge window still opens independently via
 * the challenge_open trigger, and any user can submit a price proposal.
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

  if (!['ACTIVE', 'SETTLEMENT_REQUESTED'].includes(market.market_status)) {
    return {
      ok: true, mode: 'settlement_start',
      skipped: true, reason: `status_is_${market.market_status}`,
    };
  }

  if (shouldUseInlineSettlementAi()) {
    console.log(`[settlement-engine] using inline AI settlement (APP_URL not webhook-reachable or SETTLEMENT_AI_INLINE=1) for ${market.market_identifier}`);
    const ai = await getAIPriceDetermination(market);
    if (!ai) {
      return {
        ok: false,
        mode: 'settlement_start',
        error: 'inline_ai_price_failed',
        result: {
          marketId: market.id,
          marketIdentifier: market.market_identifier,
          action: 'ai_price_failed',
          ok: false,
          reason: 'metric_worker_returned_no_valid_price_or_timed_out',
        },
      };
    }
    const outcome = await completeSettlementFromAIResult(market.id, ai);
    return {
      ok: outcome.ok,
      mode: 'settlement_start',
      error: outcome.ok ? undefined : outcome.reason,
      result: {
        marketId: market.id,
        marketIdentifier: market.market_identifier,
        action: outcome.ok ? 'settlement_started_inline' : 'settlement_db_or_chain_failed',
        ok: outcome.ok,
        reason: outcome.reason,
        details: outcome.details,
      },
    };
  }

  const jobResult = await fireSettlementAIJob(market);
  if (!jobResult.ok) {
    console.warn(`[settlement-engine] AI webhook job failed for ${market.market_identifier}: ${jobResult.error}`);
    return {
      ok: false,
      mode: 'settlement_start',
      error: jobResult.error,
      result: {
        marketId: market.id,
        marketIdentifier: market.market_identifier,
        action: 'ai_job_failed',
        ok: false,
        details: { error: jobResult.error },
      },
    };
  }

  return {
    ok: true,
    mode: 'settlement_start',
    result: {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: 'ai_job_fired',
      ok: true,
      details: {
        jobId: jobResult.jobId,
        callbackMode: true,
        callbackUrl: `${normalizeAppUrl()}/api/settlement/ai-callback`,
      },
    },
  };
}

// ── Webhook-based AI job (fire-and-forget) ──

async function fireSettlementAIJob(
  market: MarketRow,
  retryCount: number = 0,
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const { metricAiWorkerUrl } = getConfig();
  if (!metricAiWorkerUrl) return { ok: false, error: 'metric_ai_worker_url_not_configured' };

  const urls = metricUrlsForMarket(market);
  if (urls.length === 0) return { ok: false, error: 'no_metric_urls' };

  const appUrl = normalizeAppUrl();
  if (!appUrl) return { ok: false, error: 'APP_URL_not_configured' };

  if (shouldUseInlineSettlementAi()) {
    return {
      ok: false,
      error:
        'APP_URL_is_localhost_or_unset_use_SETTLEMENT_AI_INLINE_or_public_APP_URL — webhook callbacks from the worker cannot reach this host',
    };
  }

  const callbackUrl = `${appUrl}/api/settlement/ai-callback`;
  const callbackSecret = process.env.CRON_SECRET || '';
  if (!callbackSecret) {
    console.warn(`[settlement-engine] CRON_SECRET is empty — AI worker callback auth will fail`);
  }

  const richDescription = [
    `Settlement price determination for "${market.name || market.market_identifier}".`,
    market.description ? `Market description: ${market.description}.` : '',
    `Metric source URL(s): ${urls.join(', ')}.`,
    `Find the current numeric value of this metric from the source page(s).`,
  ].filter(Boolean).join(' ');

  console.log(`[settlement-engine] firing AI job (webhook) for ${market.market_identifier}`, {
    metricAiWorkerUrl, urls, callbackUrl,
  });

  try {
    const res = await fetch(`${metricAiWorkerUrl}/api/metric-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric: market.name || market.market_identifier,
        description: richDescription,
        urls,
        related_market_id: market.id,
        related_market_identifier: market.market_identifier,
        context: 'settlement',
        callbackUrl,
        callbackSecret,
        callbackMeta: {
          marketId: market.id,
          marketIdentifier: market.market_identifier,
          marketAddress: market.market_address,
          retryCount,
        },
      }),
    });

    if (res.status !== 202) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, error: `ai_worker_returned_${res.status}: ${errBody.slice(0, 300)}` };
    }

    const json = await res.json().catch(() => ({}));
    const jobId = typeof json?.jobId === 'string' ? json.jobId : '';
    if (!jobId) return { ok: false, error: 'ai_worker_returned_no_jobId' };

    console.log(`[settlement-engine] AI job fired (webhook): ${jobId} for ${market.market_identifier}`);
    return { ok: true, jobId };
  } catch (err) {
    return { ok: false, error: `ai_job_fetch_failed: ${String(err)}` };
  }
}

/**
 * Called by the /api/settlement/ai-callback webhook when the AI worker
 * finishes processing. Commits evidence on-chain and updates Supabase
 * to SETTLEMENT_REQUESTED (from ACTIVE), or refreshes proposed price while
 * already in SETTLEMENT_REQUESTED (e.g. second AI job after window opened).
 */
export async function completeSettlementFromAIResult(
  marketId: string,
  ai: { price: number; jobId: string; waybackUrl: string | null; waybackPageUrl: string | null; screenshotUrl: string | null },
): Promise<{ ok: boolean; reason?: string; details?: Record<string, unknown> }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, reason: 'supabase_not_configured' };

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error: fetchErr } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('id', marketId)
    .maybeSingle();

  if (fetchErr || !data) return { ok: false, reason: `market_fetch_failed` };
  const market = data as MarketRow;

  const openingFromActive = market.market_status === 'ACTIVE';
  const refreshingDuringWindow = market.market_status === 'SETTLEMENT_REQUESTED';
  if (!openingFromActive && !refreshingDuringWindow) {
    return { ok: false, reason: `market_status_is_${market.market_status}` };
  }

  if (!Number.isFinite(ai.price) || ai.price <= 0) {
    return { ok: false, reason: 'zero_or_invalid_price_rejected' };
  }

  const evidenceUrl = ai.waybackPageUrl || ai.waybackUrl;
  let evidenceHash: string | null = null;
  if (evidenceUrl) {
    const commitResult = await commitEvidenceOnChain(market, evidenceUrl);
    if (commitResult.ok) {
      evidenceHash = commitResult.evidenceHash ?? null;
    } else {
      console.warn(`[settlement-engine] evidence commit warning for ${market.market_identifier}: ${commitResult.error}`);
    }
  }

  const now = new Date();
  const settlementMs = safeDateMs(market.settlement_date);
  const cwMs = challengeWindowMs(market);
  const expiresAt = settlementMs
    ? new Date(Math.max(settlementMs + cwMs, now.getTime() + 60_000))
    : new Date(now.getTime() + getConfig().defaultWindowSeconds * 1000);

  let updatedConfig: Record<string, unknown>;
  if (openingFromActive) {
    updatedConfig = nextMarketConfig(market, {
      stage: 'window_started',
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ai_job_id: ai.jobId,
    });
  } else {
    const cfg = asRecord(market.market_config);
    const scheduler = asRecord(cfg.settlement_scheduler);
    updatedConfig = {
      ...cfg,
      settlement_scheduler: {
        ...scheduler,
        ai_job_id: ai.jobId,
      },
    };
  }
  if (ai.waybackUrl) updatedConfig.settlement_wayback_url = ai.waybackUrl;
  if (ai.waybackPageUrl) updatedConfig.settlement_wayback_page_url = ai.waybackPageUrl;
  if (ai.screenshotUrl) updatedConfig.settlement_screenshot_url = ai.screenshotUrl;
  if (evidenceHash) updatedConfig.settlement_evidence_hash = evidenceHash;

  const rowUpdate: Record<string, unknown> = {
    proposed_settlement_value: ai.price,
    proposed_settlement_at: now.toISOString(),
    proposed_settlement_by: 'AI_SYSTEM',
    market_config: updatedConfig,
    updated_at: now.toISOString(),
  };
  if (openingFromActive) {
    rowUpdate.market_status = 'SETTLEMENT_REQUESTED';
  }

  let updateQuery = supabase.from('markets').update(rowUpdate).eq('id', market.id);
  updateQuery = openingFromActive
    ? updateQuery.eq('market_status', 'ACTIVE')
    : updateQuery.eq('market_status', 'SETTLEMENT_REQUESTED');

  const { data: updatedRows, error: updateErr } = await updateQuery.select('id');

  if (updateErr) {
    return { ok: false, reason: `db_update_failed: ${updateErr.message}` };
  }
  if (!updatedRows?.length) {
    return {
      ok: false,
      reason: openingFromActive
        ? 'no_row_updated_market_not_active_or_race'
        : 'no_row_updated_settlement_window_race',
    };
  }

  const syncResult = await settlementSyncLifecycleOnChain(market);
  if (!syncResult.ok) {
    console.warn(`[settlement-engine] syncLifecycle at AI callback warning for ${market.market_identifier}: ${syncResult.error}`);
  }

  console.log(
    `[settlement-engine] settlement ${openingFromActive ? 'opened' : 'price_refreshed'} via AI callback for ${market.market_identifier}`,
    { price: ai.price, jobId: ai.jobId, evidenceHash, expiresAt: expiresAt.toISOString(), lifecycleSync: syncResult },
  );

  return {
    ok: true,
    details: {
      price: ai.price,
      jobId: ai.jobId,
      evidenceHash,
      expiresAt: expiresAt.toISOString(),
      waybackUrl: ai.waybackUrl,
      waybackPageUrl: ai.waybackPageUrl,
      lifecycleSync: syncResult,
      mode: openingFromActive ? 'opened_from_active' : 'refreshed_during_settlement',
    },
  };
}

/**
 * Re-fire the settlement AI job for a market after a zero/invalid price.
 * Used by the ai-callback webhook to retry without accepting the bad price.
 */
export async function retrySettlementAIJobForMarket(
  marketId: string,
  retryCount: number,
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, error: 'supabase_not_configured' };

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .eq('id', marketId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'market_fetch_failed' };
  const market = data as MarketRow;

  if (!['ACTIVE', 'SETTLEMENT_REQUESTED'].includes(market.market_status)) {
    return { ok: false, error: `market_status_is_${market.market_status}` };
  }

  return fireSettlementAIJob(market, retryCount);
}
