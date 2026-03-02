import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

type MarketRow = {
  id: string;
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
};

type TickResult = {
  marketId: string;
  marketIdentifier: string;
  action: string;
  ok: boolean;
  settlementDate?: string | null;
  settlementWindowExpiresAt?: string | null;
  reason?: string;
  details?: Record<string, unknown>;
};

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  "";

const RPC_URL = Deno.env.get("RPC_URL") || Deno.env.get("JSON_RPC_URL") || "";
const PRIVATE_KEY = Deno.env.get("PRIVATE_KEY") || Deno.env.get("ADMIN_PRIVATE_KEY") || "";
const METRIC_AI_WORKER_URL = (Deno.env.get("METRIC_AI_WORKER_URL") || "").replace(/\/+$/, "");

const TICK_LIMIT = parsePositiveInt(Deno.env.get("SETTLEMENT_TICK_LIMIT"), 50);
const DEFAULT_WINDOW_SECONDS = parsePositiveInt(
  Deno.env.get("SETTLEMENT_WINDOW_SECONDS"),
  24 * 60 * 60,
);
const ONCHAIN_DRIFT_TOLERANCE_SECONDS = parsePositiveInt(
  Deno.env.get("SETTLEMENT_CHAIN_DRIFT_TOLERANCE_SECONDS"),
  5 * 60,
);

const REQUIRE_ONCHAIN_SETTLEMENT_CHECK = parseBool(
  Deno.env.get("REQUIRE_ONCHAIN_SETTLEMENT_CHECK"),
  true,
);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw || "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
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
    const value = typeof c === "string" ? c.trim() : "";
    if (value && !urls.includes(value)) urls.push(value);
  }
  return urls;
}

async function getAIPriceDetermination(
  market: MarketRow,
): Promise<{ price: number; jobId: string } | null> {
  if (!METRIC_AI_WORKER_URL) return null;
  const urls = metricUrlsForMarket(market);
  if (urls.length === 0) return null;

  const startRes = await fetch(`${METRIC_AI_WORKER_URL}/api/metric-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metric: market.market_identifier,
      description: `Determine settlement price for ${market.market_identifier}`,
      urls,
      related_market_id: market.id,
      related_market_identifier: market.market_identifier,
      context: "settlement_price_determination",
    }),
  });

  if (startRes.status !== 202) return null;
  const startJson = await startRes.json().catch(() => ({}));
  const jobId = typeof startJson?.jobId === "string" ? startJson.jobId : "";
  if (!jobId) return null;

  const timeoutMs = 30_000;
  const pollEveryMs = 2_000;
  const startTs = Date.now();

  while (Date.now() - startTs < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollEveryMs));
    const pollRes = await fetch(
      `${METRIC_AI_WORKER_URL}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store" },
    );
    const pollJson = await pollRes.json().catch(() => ({}));
    if (pollJson?.status === "completed" && pollJson?.result) {
      const candidate = Number(
        pollJson.result?.asset_price_suggestion ?? pollJson.result?.value,
      );
      if (Number.isFinite(candidate) && candidate > 0) {
        return { price: candidate, jobId };
      }
      return null;
    }
    if (pollJson?.status === "failed") return null;
  }
  return null;
}

async function verifyOnchainSettlementTime(
  market: MarketRow,
): Promise<{ ok: boolean; reason?: string; chainTs?: number }> {
  if (!REQUIRE_ONCHAIN_SETTLEMENT_CHECK) return { ok: true };
  if (!RPC_URL) return { ok: false, reason: "rpc_not_configured" };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, reason: "invalid_market_address" };
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const lifecycle = new ethers.Contract(
      market.market_address,
      ["function getSettlementTimestamp() external view returns (uint256)"],
      provider,
    );
    const chainTsBig: bigint = await lifecycle.getSettlementTimestamp();
    const chainTs = Number(chainTsBig);
    if (!Number.isFinite(chainTs) || chainTs <= 0) {
      return { ok: false, reason: "invalid_chain_timestamp" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (chainTs > nowSec) return { ok: false, reason: "chain_settlement_not_due", chainTs };

    const dbMs = safeDateMs(market.settlement_date);
    if (dbMs !== null) {
      const dbSec = Math.floor(dbMs / 1000);
      if (Math.abs(dbSec - chainTs) > ONCHAIN_DRIFT_TOLERANCE_SECONDS) {
        return { ok: false, reason: "chain_db_settlement_mismatch", chainTs };
      }
    }

    return { ok: true, chainTs };
  } catch (err) {
    return { ok: false, reason: `chain_check_failed:${String(err)}` };
  }
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

async function maybeStartSettlementWindow(
  supabase: ReturnType<typeof createClient>,
  market: MarketRow,
): Promise<TickResult> {
  if (market.market_status !== "ACTIVE") {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "start_window",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "status_not_active",
    };
  }

  if (isWindowActive(market)) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "start_window",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "window_already_active",
    };
  }

  const chainCheck = await verifyOnchainSettlementTime(market);
  if (!chainCheck.ok) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "start_window",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: chainCheck.reason || "chain_check_failed",
      details: { chainTs: chainCheck.chainTs ?? null },
    };
  }

  const ai = await getAIPriceDetermination(market);
  if (!ai) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "start_window",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "ai_price_failed",
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_WINDOW_SECONDS * 1000);

  const { error } = await supabase
    .from("markets")
    .update({
      proposed_settlement_value: ai.price,
      proposed_settlement_at: now.toISOString(),
      settlement_window_expires_at: expiresAt.toISOString(),
      proposed_settlement_by: "AI_SYSTEM",
      market_status: "SETTLEMENT_REQUESTED",
      market_config: nextMarketConfig(market, {
        stage: "window_started",
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        ai_job_id: ai.jobId,
      }),
      updated_at: now.toISOString(),
    })
    .eq("id", market.id)
    .eq("market_status", "ACTIVE");

  if (error) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "start_window",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: `db_update_failed:${error.message}`,
    };
  }

  return {
    marketId: market.id,
    marketIdentifier: market.market_identifier,
    action: "start_window",
    ok: true,
    settlementDate: market.settlement_date,
    settlementWindowExpiresAt: expiresAt.toISOString(),
    details: {
      aiPrice: ai.price,
      aiJobId: ai.jobId,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

async function finalizeOnChain(
  market: MarketRow,
  finalPrice: number,
): Promise<{ ok: boolean; txHash?: string; reason?: string }> {
  if (!RPC_URL) return { ok: false, reason: "rpc_not_configured" };
  if (!PRIVATE_KEY) return { ok: false, reason: "private_key_not_configured" };
  if (!market.market_address || !ethers.isAddress(market.market_address)) {
    return { ok: false, reason: "invalid_market_address" };
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const ob = new ethers.Contract(
      market.market_address,
      ["function settleMarket(uint256 finalPrice) external"],
      wallet,
    );
    const tx = await ob.settleMarket(ethers.parseUnits(finalPrice.toString(), 6));
    await tx.wait();
    return { ok: true, txHash: tx.hash };
  } catch (err) {
    return { ok: false, reason: `onchain_settle_failed:${String(err)}` };
  }
}

async function maybeFinalizeSettlement(
  supabase: ReturnType<typeof createClient>,
  market: MarketRow,
): Promise<TickResult> {
  if (market.market_status !== "SETTLEMENT_REQUESTED") {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "status_not_settlement_requested",
    };
  }

  if (market.settlement_disputed === true) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "settlement_disputed",
    };
  }

  const exp = safeDateMs(market.settlement_window_expires_at);
  if (exp === null || exp > Date.now()) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "window_not_expired",
    };
  }

  const ai = await getAIPriceDetermination(market);
  if (!ai) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: "ai_final_price_failed",
    };
  }

  let txHash: string | null = null;
  const settle = await finalizeOnChain(market, ai.price);
  if (!settle.ok) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: settle.reason || "onchain_finalize_failed",
    };
  }
  txHash = settle.txHash || null;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("markets")
    .update({
      market_status: "SETTLED",
      settlement_value: ai.price,
      settlement_timestamp: now,
      market_config: nextMarketConfig(market, {
        stage: "settled",
        settled_at: now,
        ai_job_id: ai.jobId,
        tx_hash: txHash,
      }),
      updated_at: now,
    })
    .eq("id", market.id)
    .eq("market_status", "SETTLEMENT_REQUESTED");

  if (error) {
    return {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "finalize",
      ok: false,
      settlementDate: market.settlement_date,
      settlementWindowExpiresAt: market.settlement_window_expires_at,
      reason: `db_finalize_failed:${error.message}`,
    };
  }

  return {
    marketId: market.id,
    marketIdentifier: market.market_identifier,
    action: "finalize",
    ok: true,
    settlementDate: market.settlement_date,
    settlementWindowExpiresAt: market.settlement_window_expires_at,
    details: {
      aiPrice: ai.price,
      aiJobId: ai.jobId,
      txHash,
    },
  };
}

async function runSettlementTick(
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("markets")
    .select(`
      id,
      market_identifier,
      market_address,
      market_status,
      settlement_date,
      proposed_settlement_value,
      proposed_settlement_at,
      settlement_window_expires_at,
      settlement_disputed,
      market_config,
      initial_order
    `)
    .in("market_status", ["ACTIVE", "SETTLEMENT_REQUESTED"])
    .lte("settlement_date", nowIso)
    .eq("is_active", true)
    .order("settlement_date", { ascending: true })
    .limit(TICK_LIMIT);

  if (error) {
    return json(500, { ok: false, error: `scan_failed:${error.message}` });
  }

  const markets = (data || []) as MarketRow[];
  const results: TickResult[] = [];

  for (const market of markets) {
    if (market.market_status === "ACTIVE") {
      results.push(await maybeStartSettlementWindow(supabase, market));
      continue;
    }
    if (market.market_status === "SETTLEMENT_REQUESTED") {
      results.push(await maybeFinalizeSettlement(supabase, market));
      continue;
    }
  }

  return json(200, {
    ok: true,
    mode: "tick",
    scanned: markets.length,
    results,
  });
}

async function runSingleCheck(
  supabase: ReturnType<typeof createClient>,
  marketId: string,
): Promise<Response> {
  const { data, error } = await supabase
    .from("markets")
    .select(`
      id,
      market_identifier,
      market_address,
      market_status,
      settlement_date,
      proposed_settlement_value,
      proposed_settlement_at,
      settlement_window_expires_at,
      settlement_disputed,
      market_config,
      initial_order
    `)
    .eq("id", marketId)
    .maybeSingle();

  if (error) return json(500, { ok: false, error: `market_fetch_failed:${error.message}` });
  if (!data) return json(404, { ok: false, error: "market_not_found" });

  const market = data as MarketRow;
  const settlementMs = safeDateMs(market.settlement_date);
  if (settlementMs === null) {
    return json(400, { ok: false, error: "invalid_settlement_date" });
  }

  if (settlementMs > Date.now()) {
    return json(200, {
      ok: true,
      mode: "single_check",
      skipped: true,
      reason: "settlement_not_due",
      settlesAt: market.settlement_date,
    });
  }

  let result: TickResult;
  if (market.market_status === "ACTIVE") {
    result = await maybeStartSettlementWindow(supabase, market);
  } else if (market.market_status === "SETTLEMENT_REQUESTED") {
    result = await maybeFinalizeSettlement(supabase, market);
  } else {
    result = {
      marketId: market.id,
      marketIdentifier: market.market_identifier,
      action: "single_check",
      ok: false,
      reason: "unsupported_status",
    };
  }

  return json(200, {
    ok: true,
    mode: "single_check",
    result,
  });
}

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(500, {
      ok: false,
      error: "missing_supabase_env",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    if (req.method !== "POST") {
      return json(200, {
        ok: true,
        message:
          "POST with action=run_settlement_tick (recommended) or action=check_settlement_time (compat)",
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "run_settlement_tick";

    if (action === "run_settlement_tick") {
      return await runSettlementTick(supabase);
    }

    if (action === "check_settlement_time") {
      const marketId = typeof body?.market_id === "string" ? body.market_id : "";
      if (!marketId) {
        return json(400, { ok: false, error: "market_id_required_for_check_settlement_time" });
      }
      return await runSingleCheck(supabase, marketId);
    }

    return json(400, { ok: false, error: `unsupported_action:${action}` });
  } catch (err) {
    return json(500, { ok: false, error: String(err) });
  }
});
