// Spoke-side withdrawal confirmation webhook.
//
// Subscribed to `Released(address indexed user, uint256 amount, bytes32 indexed withdrawId)`
// emitted by SecureSpokeVaultV3 on Arbitrum (Alchemy GRAPHQL custom webhook).
//
// When the user's USDC actually lands in their wallet, this fires and we
// flip the matching withdrawal_jobs row to `completed`. This makes the saga
// resilient even if our retry worker thought the spoke tx failed (e.g.
// receipt timeout) but it actually went through.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { keccak256, toHex } from "npm:viem";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  "";

// HMAC signing key from the Alchemy Arbitrum webhook config.
//   WITHDRAWAL_SPOKE_WEBHOOK_SIGNING_KEY_ARBITRUM (preferred)
//   WITHDRAWAL_SPOKE_WEBHOOK_SIGNING_KEY          (legacy / fallback)
function getSigningKeys(): string[] {
  return [
    Deno.env.get("WITHDRAWAL_SPOKE_WEBHOOK_SIGNING_KEY_ARBITRUM"),
    Deno.env.get("WITHDRAWAL_SPOKE_WEBHOOK_SIGNING_KEY"),
  ]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
}

// Released(address,uint256,bytes32)
const RELEASED_TOPIC0 = keccak256(new TextEncoder().encode("Released(address,uint256,bytes32)"));

function logStep(traceId: string, step: string, data: Record<string, any>) {
  console.log(JSON.stringify({ traceId, step, ts: new Date().toISOString(), ...data }));
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySignature(raw: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const keys = getSigningKeys();
  if (keys.length === 0) return false;
  const sigBytes = hexToBytes(signature);
  const bodyBytes = new TextEncoder().encode(raw);
  for (const k of keys) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(k),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const digest = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, bodyBytes)
      );
      if (timingSafeEqual(digest, sigBytes)) return true;
    } catch {
      // try next key
    }
  }
  return false;
}

function extractLogs(body: any): any[] {
  // Mirrors the same pattern as liquidation-direct-webhook so any Alchemy
  // webhook product (custom GraphQL, Address Activity, Mined Tx) lands here.
  const candidates = [
    body?.logs,
    body?.event?.logs,
    body?.event?.data?.logs,
    body?.event?.data?.block?.logs,
    body?.data?.block?.logs,
  ];
  for (const c of candidates) if (Array.isArray(c) && c.length > 0) return c;
  return [];
}

// Alchemy Custom GraphQL emits logs nested under `event.data.block.logs`, and
// the block-level metadata lives on the sibling `block.number`. The Transaction
// type has no `blockNumber` field, so we read it from the enclosing block.
function pickEnclosingBlockNumber(body: any): number | null {
  const v =
    body?.event?.data?.block?.number ??
    body?.data?.block?.number ??
    body?.event?.block?.number ??
    body?.block?.number ??
    null;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (v.startsWith("0x")) return parseInt(v, 16);
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickTopic(log: any, idx: number): string | null {
  const topics = log?.topics || log?.topic_list;
  if (!Array.isArray(topics)) return null;
  const t = topics[idx];
  return typeof t === "string" ? t : null;
}

function pickWithdrawId(log: any): string | null {
  // Released(address indexed user, uint256 amount, bytes32 indexed withdrawId)
  // → topic0 = sig hash, topic1 = user, topic2 = withdrawId
  return pickTopic(log, 2);
}

function pickContractAddress(log: any): string | null {
  return (log?.account?.address || log?.address || "").toLowerCase() || null;
}

function pickTxHash(log: any): string | null {
  return (
    log?.transaction?.hash ||
    log?.transactionHash ||
    log?.transaction_hash ||
    null
  );
}

function pickBlockNumber(log: any): number | null {
  const v =
    log?.transaction?.blockNumber ??
    log?.transaction?.block?.number ??
    log?.blockNumber ??
    null;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (v.startsWith("0x")) return parseInt(v, 16);
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

Deno.serve(async (req) => {
  const traceId = `wsl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(
      JSON.stringify({
        ok: true,
        signingKeyCount: getSigningKeys().length,
        supabase: !!SUPABASE_URL && !!SUPABASE_KEY,
        releasedTopic0: RELEASED_TOPIC0,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { "content-type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: "supabase_env_missing" }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-alchemy-signature");
  const verified = await verifySignature(raw, signature);
  if (!verified) {
    logStep(traceId, "sig_reject", { hasSig: !!signature, keyCount: getSigningKeys().length });
    return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_json" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const logs = extractLogs(body);
  const enclosingBlockNumber = pickEnclosingBlockNumber(body);
  logStep(traceId, "received", { logs: logs.length, blockNumber: enclosingBlockNumber });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const allowedSpokeVaults = new Set(
    [
      Deno.env.get("SPOKE_VAULT_ADDRESS_ARBITRUM"),
      Deno.env.get("SPOKE_ARBITRUM_VAULT_ADDRESS"),
      Deno.env.get("SPOKE_VAULT_ADDRESS"),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase())
  );

  const handled: any[] = [];

  for (const log of logs) {
    const topic0 = pickTopic(log, 0);
    if (!topic0 || topic0.toLowerCase() !== RELEASED_TOPIC0.toLowerCase()) continue;

    const addr = pickContractAddress(log);
    if (allowedSpokeVaults.size > 0 && addr && !allowedSpokeVaults.has(addr)) {
      logStep(traceId, "skip_unknown_vault", { addr });
      continue;
    }

    const withdrawId = pickWithdrawId(log);
    if (!withdrawId) continue;

    const txHash = pickTxHash(log);
    // Per-log blockNumber if present, else fall back to the parent block.number
    // we captured from the enclosing GraphQL response.
    const blockNumber = pickBlockNumber(log) ?? enclosingBlockNumber;

    const { data: job, error: lookupErr } = await supabase
      .from("withdrawal_jobs")
      .select("id, status")
      .eq("withdraw_id", withdrawId.toLowerCase())
      .maybeSingle();

    // try non-lowercase match too in case the on-chain field uses checksummed bytes32
    let jobRow = job;
    if (!jobRow && !lookupErr) {
      const { data: job2 } = await supabase
        .from("withdrawal_jobs")
        .select("id, status")
        .eq("withdraw_id", withdrawId)
        .maybeSingle();
      jobRow = job2 ?? null;
    }

    if (!jobRow) {
      logStep(traceId, "no_matching_job", { withdrawId });
      handled.push({ withdrawId, outcome: "no_match" });
      continue;
    }

    if (jobRow.status === "completed") {
      handled.push({ withdrawId, outcome: "already_completed" });
      continue;
    }

    const { error: completeErr } = await supabase.rpc("complete_withdrawal_job", {
      p_id: jobRow.id,
      p_spoke_deliver_tx: txHash,
      p_spoke_deliver_block: blockNumber == null ? null : String(blockNumber),
    });
    if (completeErr) {
      logStep(traceId, "complete_failed", { withdrawId, error: completeErr.message });
      handled.push({ withdrawId, outcome: "complete_failed" });
    } else {
      logStep(traceId, "completed", { withdrawId, txHash });
      handled.push({ withdrawId, outcome: "completed" });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: handled.length, handled }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
