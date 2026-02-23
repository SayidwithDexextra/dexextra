import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbiItem,
} from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";

// ─────── Env / Config ───────

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY");
const RPC_URL = Deno.env.get("HUB_RPC_URL") || "";
const CORE_VAULT = Deno.env.get("CORE_VAULT_ADDRESS") || "";

const BATCH_SIZE = (() => {
  const n = parseInt(Deno.env.get("LIQ_RETRY_BATCH_SIZE") || "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

const MAX_ATTEMPTS = (() => {
  const n = parseInt(
    Deno.env.get("LIQUIDATION_MAX_RETRY_ATTEMPTS") || "5",
    10
  );
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

const LIQ_QUEUE_CHAIN_ID = 999;

// ─────── ABI ───────

const CORE_VAULT_ABI = [
  parseAbiItem("function liquidateDirect(bytes32 marketId, address trader)"),
  parseAbiItem(
    "function getLiquidationPrice(address user, bytes32 marketId) view returns (uint256 liquidationPrice, bool hasPosition)"
  ),
];

// ─────── Relayer Pool (shared pattern with webhook) ───────

type RelayerAccount = {
  id: string;
  pool: "small" | "big";
  address: `0x${string}`;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
};

function normalizePrivateKey(pk: string): `0x${string}` | null {
  const raw = String(pk || "").trim();
  if (!raw) return null;
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return null;
  return v as `0x${string}`;
}

function parseJsonKeys(envName: string): string[] {
  const raw = Deno.env.get(envName) || "";
  if (!raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((x: any) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function loadRelayerPool(pool: "small" | "big"): RelayerAccount[] {
  const jsonEnv =
    pool === "big"
      ? "LIQUIDATOR_PRIVATE_KEYS_BIG_JSON"
      : "LIQUIDATOR_PRIVATE_KEYS_JSON";
  let rawKeys = parseJsonKeys(jsonEnv);

  if (rawKeys.length === 0 && pool === "small") {
    const fallback =
      Deno.env.get("LIQUIDATOR_PRIVATE_KEY") ||
      Deno.env.get("PRIVATE_KEY") ||
      "";
    if (fallback.trim()) rawKeys = [fallback.trim()];
  }

  const bigExcludeSet = new Set<string>();
  if (pool === "small") {
    for (const k of parseJsonKeys("LIQUIDATOR_PRIVATE_KEYS_BIG_JSON")) {
      const norm = normalizePrivateKey(k);
      if (norm) bigExcludeSet.add(norm.toLowerCase());
    }
  }

  const out: RelayerAccount[] = [];
  let idx = 0;
  for (const rawPk of rawKeys) {
    const pk = normalizePrivateKey(rawPk);
    if (!pk) continue;
    if (pool === "small" && bigExcludeSet.has(pk.toLowerCase())) continue;
    const acct = privateKeyToAccount(pk);
    out.push({
      id: `retry_${pool}:${idx}`,
      pool,
      address: acct.address,
      privateKey: pk,
      account: acct,
    });
    idx++;
  }
  return out;
}

let _smallPool: RelayerAccount[] | null = null;
let _bigPool: RelayerAccount[] | null = null;
function getSmallPool(): RelayerAccount[] {
  if (!_smallPool) _smallPool = loadRelayerPool("small");
  return _smallPool;
}
function getBigPool(): RelayerAccount[] {
  if (!_bigPool) _bigPool = loadRelayerPool("big");
  return _bigPool;
}

let _rrSmall = 0;
let _rrBig = 0;
function pickRoundRobin(pool: "small" | "big"): RelayerAccount | null {
  const keys = pool === "big" ? getBigPool() : getSmallPool();
  if (keys.length === 0) return null;
  if (pool === "big") {
    const k = keys[_rrBig % keys.length];
    _rrBig++;
    return k;
  }
  const k = keys[_rrSmall % keys.length];
  _rrSmall++;
  return k;
}

// ─────── Gas helpers ───────

const SMALL_BLOCK_GAS_LIMIT = (() => {
  const raw = Deno.env.get("HYPEREVM_SMALL_BLOCK_GAS_LIMIT") || "";
  if (!raw.trim()) return 2_000_000n;
  try {
    return BigInt(raw.trim());
  } catch {
    return 2_000_000n;
  }
})();

const GAS_ESTIMATE_BUFFER_BPS = (() => {
  const raw = Deno.env.get("LIQUIDATION_GAS_ESTIMATE_BUFFER_BPS") || "";
  if (!raw.trim()) return 13000n;
  try {
    const v = BigInt(raw.trim());
    return v >= 10000n && v <= 30000n ? v : 13000n;
  } catch {
    return 13000n;
  }
})();

function isBlockGasLimitError(err: any): boolean {
  const msg = String(
    err?.shortMessage || err?.reason || err?.message || err || ""
  ).toLowerCase();
  return (
    msg.includes("exceeds block gas limit") ||
    msg.includes("block gas limit") ||
    msg.includes("transaction gas limit exceeds") ||
    msg.includes("gas limit too high") ||
    msg.includes("intrinsic gas too low")
  );
}

// ─────── Nonce ───────

async function allocateNonce(
  supabase: any,
  relayer: RelayerAccount,
  publicClient: any,
  label: string
): Promise<bigint> {
  const observedPending = await publicClient.getTransactionCount({
    address: relayer.address,
    blockTag: "pending",
  });
  const observed = BigInt(observedPending);

  const mode = (Deno.env.get("LIQUIDATION_NONCE_ALLOCATOR") || "")
    .trim()
    .toLowerCase();
  if (mode === "disabled" || mode === "off" || !supabase) return observed;

  try {
    const { data, error } = await supabase.rpc("allocate_relayer_nonce", {
      p_relayer_address: relayer.address.toLowerCase(),
      p_chain_id: String(LIQ_QUEUE_CHAIN_ID),
      p_observed_pending_nonce: observed.toString(),
      p_label: label,
    });
    if (error) throw error;
    return BigInt(data as any);
  } catch {
    return observed;
  }
}

// ─────── Logging ───────

function logStep(traceId: string, step: string, data: Record<string, any>) {
  console.log(
    JSON.stringify({ traceId, step, ts: new Date().toISOString(), ...data })
  );
}

// ─────── Core: process a single job ───────

async function processJob(
  job: {
    id: number;
    address: string;
    market_id: string;
    chain_id: number;
    attempts: number;
  },
  publicClient: any,
  supabase: any,
  traceId: string
): Promise<{ id: number; outcome: string; tx?: string }> {
  const marketHex = job.market_id as `0x${string}`;
  const walletHex = job.address.toLowerCase() as `0x${string}`;

  // Pre-check: is position still liquidatable?
  try {
    const [liqPrice, hasPos] = (await publicClient.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getLiquidationPrice",
      args: [walletHex, marketHex],
    })) as [bigint, boolean];

    if (!hasPos || liqPrice === 0n) {
      await supabase.rpc("complete_liq_job", {
        p_id: job.id,
        p_tx_hash: null,
      });
      return { id: job.id, outcome: "no_position" };
    }
  } catch (e: any) {
    logStep(traceId, "retry_pre_check_error", {
      jobId: job.id,
      reason: e?.message || String(e),
    });
  }

  // Simulation
  const simRelayer =
    pickRoundRobin("small") || pickRoundRobin("big");
  if (!simRelayer) {
    const r = await supabase.rpc("fail_or_requeue_liq_job", {
      p_id: job.id,
      p_error: "no_relayer_available",
      p_max_attempts: MAX_ATTEMPTS,
    });
    return { id: job.id, outcome: r.data || "requeued" };
  }

  try {
    await publicClient.simulateContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "liquidateDirect",
      args: [marketHex, walletHex],
      account: simRelayer.address,
    });
  } catch (simErr: any) {
    const msg = simErr?.shortMessage || simErr?.message || String(simErr);
    if (
      msg.includes("not liquidatable") ||
      msg.includes("no position") ||
      msg.includes("insufficient")
    ) {
      await supabase.rpc("complete_liq_job", {
        p_id: job.id,
        p_tx_hash: null,
      });
      return { id: job.id, outcome: "sim_not_liquidatable" };
    }
    const r = await supabase.rpc("fail_or_requeue_liq_job", {
      p_id: job.id,
      p_error: `sim_fail:${msg.slice(0, 300)}`,
      p_max_attempts: MAX_ATTEMPTS,
    });
    return { id: job.id, outcome: r.data || "requeued" };
  }

  // Gas estimation to determine pool
  let routedPool: "small" | "big" = "small";
  try {
    const calldata = encodeFunctionData({
      abi: CORE_VAULT_ABI,
      functionName: "liquidateDirect",
      args: [marketHex, walletHex],
    });
    const est = await publicClient.estimateGas({
      to: CORE_VAULT as `0x${string}`,
      data: calldata,
      account: simRelayer.address,
    });
    const buffered = (BigInt(est) * GAS_ESTIMATE_BUFFER_BPS) / 10000n;
    if (buffered > SMALL_BLOCK_GAS_LIMIT) routedPool = "big";
  } catch {
    routedPool = "small";
  }

  const relayer = pickRoundRobin(routedPool) || pickRoundRobin("big") || pickRoundRobin("small");
  if (!relayer) {
    const r = await supabase.rpc("fail_or_requeue_liq_job", {
      p_id: job.id,
      p_error: `no_relayer:${routedPool}`,
      p_max_attempts: MAX_ATTEMPTS,
    });
    return { id: job.id, outcome: r.data || "requeued" };
  }

  const label = `retry:${marketHex.slice(0, 10)}:${walletHex.slice(0, 10)}:a${job.attempts}`;

  try {
    const nonce = await allocateNonce(supabase, relayer, publicClient, label);
    const walletClient = createWalletClient({
      account: relayer.account,
      transport: http(RPC_URL),
    });
    const tx = await walletClient.writeContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "liquidateDirect" as const,
      args: [marketHex, walletHex],
      nonce: Number(nonce),
    });

    try {
      const nonceMode = (Deno.env.get("LIQUIDATION_NONCE_ALLOCATOR") || "")
        .trim()
        .toLowerCase();
      if (nonceMode !== "disabled" && nonceMode !== "off") {
        await supabase.rpc("mark_relayer_tx_broadcasted", {
          p_relayer_address: relayer.address.toLowerCase(),
          p_chain_id: String(LIQ_QUEUE_CHAIN_ID),
          p_nonce: nonce.toString(),
          p_tx_hash: tx,
        });
      }
    } catch {
      /* best-effort */
    }

    await supabase.rpc("complete_liq_job", { p_id: job.id, p_tx_hash: tx });
    return { id: job.id, outcome: "liquidated", tx };
  } catch (sendErr: any) {
    const errMsg =
      sendErr?.shortMessage || sendErr?.message || String(sendErr);

    // Retry with big pool on block gas limit errors
    if (
      routedPool !== "big" &&
      getBigPool().length > 0 &&
      isBlockGasLimitError(sendErr)
    ) {
      const bigRelayer = pickRoundRobin("big");
      if (bigRelayer) {
        try {
          const nonce2 = await allocateNonce(
            supabase,
            bigRelayer,
            publicClient,
            `${label}:big_retry`
          );
          const walletClient2 = createWalletClient({
            account: bigRelayer.account,
            transport: http(RPC_URL),
          });
          const tx2 = await walletClient2.writeContract({
            address: CORE_VAULT as `0x${string}`,
            abi: CORE_VAULT_ABI,
            functionName: "liquidateDirect" as const,
            args: [marketHex, walletHex],
            nonce: Number(nonce2),
          });
          await supabase.rpc("complete_liq_job", {
            p_id: job.id,
            p_tx_hash: tx2,
          });
          return { id: job.id, outcome: "liquidated_big_fallback", tx: tx2 };
        } catch (bigErr: any) {
          const bigMsg =
            bigErr?.shortMessage || bigErr?.message || String(bigErr);
          const r = await supabase.rpc("fail_or_requeue_liq_job", {
            p_id: job.id,
            p_error: `big_send_fail:${bigMsg.slice(0, 300)}`,
            p_max_attempts: MAX_ATTEMPTS,
          });
          return { id: job.id, outcome: r.data || "requeued" };
        }
      }
    }

    const r = await supabase.rpc("fail_or_requeue_liq_job", {
      p_id: job.id,
      p_error: `send_fail:${errMsg.slice(0, 300)}`,
      p_max_attempts: MAX_ATTEMPTS,
    });
    return { id: job.id, outcome: r.data || "requeued" };
  }
}

// ─────── Serve ───────

Deno.serve(async (req) => {
  const traceId = `retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(
      JSON.stringify({ error: "missing SUPABASE_URL/KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!CORE_VAULT || !RPC_URL) {
    return new Response(
      JSON.stringify({ error: "missing CORE_VAULT/RPC_URL" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const publicClient = createPublicClient({ transport: http(RPC_URL) });

  const smallCount = getSmallPool().length;
  const bigCount = getBigPool().length;
  if (smallCount === 0 && bigCount === 0) {
    return new Response(
      JSON.stringify({ error: "no relayer keys configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  logStep(traceId, "retry_worker_start", {
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    relayers: { small: smallCount, big: bigCount },
  });

  // Dequeue jobs
  const { data: jobs, error: deqErr } = await supabase.rpc(
    "dequeue_liq_jobs",
    { p_limit: BATCH_SIZE }
  );

  if (deqErr) {
    logStep(traceId, "dequeue_error", { error: deqErr.message });
    return new Response(
      JSON.stringify({ error: deqErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!jobs || jobs.length === 0) {
    logStep(traceId, "no_pending_jobs", {});
    return new Response(
      JSON.stringify({ processed: 0, message: "queue empty" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  logStep(traceId, "jobs_dequeued", { count: jobs.length });

  const results = [];
  for (const job of jobs) {
    try {
      const r = await processJob(job, publicClient, supabase, traceId);
      results.push(r);
      logStep(traceId, "job_result", r);
    } catch (e: any) {
      logStep(traceId, "job_unhandled_error", {
        jobId: job.id,
        reason: e?.message || String(e),
      });
      try {
        await supabase.rpc("fail_or_requeue_liq_job", {
          p_id: job.id,
          p_error: `unhandled:${(e?.message || String(e)).slice(0, 300)}`,
          p_max_attempts: MAX_ATTEMPTS,
        });
      } catch {
        /* safety net */
      }
      results.push({ id: job.id, outcome: "unhandled_error" });
    }
  }

  logStep(traceId, "retry_worker_done", {
    total: results.length,
    liquidated: results.filter(
      (r) =>
        r.outcome === "liquidated" || r.outcome === "liquidated_big_fallback"
    ).length,
    requeued: results.filter((r) => r.outcome === "requeued").length,
    failed: results.filter((r) => r.outcome === "permanently_failed").length,
    skipped: results.filter(
      (r) =>
        r.outcome === "no_position" || r.outcome === "sim_not_liquidatable"
    ).length,
  });

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
