// Withdrawal alerter — runs every 5 minutes via pg_cron.
//
// Pages on-call when:
//   - Any withdrawal_job has status='requires_manual'             (definite drop)
//   - Any withdrawal_job has been stuck in a recoverable state    (probable problem)
//     for > STUCK_THRESHOLD_MINUTES.
//
// Posts a single throttled message to a Discord webhook so we don't get
// paged every 5 minutes for the same row — uses metadata.alerted_at on the
// row itself as the throttle key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  "";

const DISCORD_WEBHOOK_URL =
  Deno.env.get("DISCORD_WITHDRAWAL_ALERT_WEBHOOK_URL") ||
  Deno.env.get("DISCORD_ALERT_WEBHOOK_URL") ||
  "";

const STUCK_MIN = (() => {
  const n = parseInt(Deno.env.get("WITHDRAW_STUCK_THRESHOLD_MINUTES") || "10", 10);
  return Number.isFinite(n) && n >= 1 ? n : 10;
})();
const RE_ALERT_MIN = (() => {
  const n = parseInt(Deno.env.get("WITHDRAW_REALERT_INTERVAL_MINUTES") || "60", 10);
  return Number.isFinite(n) && n >= 5 ? n : 60;
})();

const NON_TERMINAL = [
  "pending",
  "hub_debiting",
  "hub_debited",
  "hub_sending",
  "hub_sent",
  "spoke_pending",
  "spoke_delivering",
  "outbox_failed",
  "spoke_failed",
];

function fmtJob(j: any): string {
  const usdc = (() => {
    try {
      const wei = BigInt(j.amount_wei);
      const whole = wei / 1_000_000n;
      const frac = (wei % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
      return frac ? `${whole}.${frac}` : `${whole}`;
    } catch {
      return j.amount_human ?? "?";
    }
  })();
  const chain = j.target_chain_id === 42161 ? "arb" : j.target_chain_id === 137 ? "poly" : `chain${j.target_chain_id}`;
  const ageMin = Math.round((Date.now() - new Date(j.updated_at).getTime()) / 60000);
  const wid = j.withdraw_id ? `${String(j.withdraw_id).slice(0, 10)}…` : "no-wid";
  const err = j.last_error ? ` err="${String(j.last_error).slice(0, 100)}"` : "";
  return `• \`${j.id.slice(0, 8)}\` ${j.status} ${chain} ${usdc} USDC ${wid} ${j.user_address.slice(0, 8)}… age=${ageMin}m attempts=${j.attempts}/${j.max_attempts}${err}`;
}

async function postDiscord(content: string): Promise<boolean> {
  if (!DISCORD_WEBHOOK_URL) return false;
  try {
    const r = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

Deno.serve(async () => {
  const traceId = `walert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: "supabase_env_missing" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Hard-fail rows: anyone in requires_manual.
  const { data: hardFail } = await supabase
    .from("withdrawal_jobs")
    .select("*")
    .eq("status", "requires_manual")
    .order("updated_at", { ascending: false })
    .limit(50);

  // Stuck rows: any non-terminal that hasn't moved in >STUCK_MIN.
  const stuckCutoff = new Date(Date.now() - STUCK_MIN * 60_000).toISOString();
  const { data: stuck } = await supabase
    .from("withdrawal_jobs")
    .select("*")
    .in("status", NON_TERMINAL)
    .lt("updated_at", stuckCutoff)
    .order("updated_at", { ascending: false })
    .limit(50);

  const candidates = [...(hardFail ?? []), ...(stuck ?? [])];

  // Throttle: skip rows we already alerted on within RE_ALERT_MIN.
  const reAlertCutoff = Date.now() - RE_ALERT_MIN * 60_000;
  const toAlert = candidates.filter((j: any) => {
    const last = j?.metadata?.alerted_at ? new Date(j.metadata.alerted_at).getTime() : 0;
    return !last || last < reAlertCutoff;
  });

  console.log(JSON.stringify({
    traceId, step: "alerter_summary", ts: new Date().toISOString(),
    hardFail: hardFail?.length ?? 0,
    stuck: stuck?.length ?? 0,
    toAlert: toAlert.length,
    reAlertMin: RE_ALERT_MIN,
    stuckMin: STUCK_MIN,
  }));

  if (toAlert.length === 0) {
    return new Response(JSON.stringify({ ok: true, alerted: 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const hardCount = (hardFail ?? []).filter((j: any) =>
    toAlert.some((k: any) => k.id === j.id)
  ).length;
  const stuckCount = (stuck ?? []).filter((j: any) =>
    toAlert.some((k: any) => k.id === j.id)
  ).length;

  const lines = toAlert.slice(0, 20).map(fmtJob);
  const more = toAlert.length > 20 ? `\n… and ${toAlert.length - 20} more` : "";
  const header = hardCount > 0
    ? `🚨 **WITHDRAWAL SAGA** — ${hardCount} requires_manual + ${stuckCount} stuck`
    : `⚠️ **WITHDRAWAL SAGA** — ${stuckCount} jobs stuck > ${STUCK_MIN}m`;

  const content = [header, ...lines, more].filter(Boolean).join("\n").slice(0, 1900);
  const posted = await postDiscord(content);

  // Stamp metadata.alerted_at so we don't spam the channel.
  if (posted) {
    const now = new Date().toISOString();
    await Promise.all(
      toAlert.map((j: any) =>
        supabase
          .from("withdrawal_jobs")
          .update({
            metadata: { ...(j.metadata || {}), alerted_at: now },
          })
          .eq("id", j.id)
      )
    );
  }

  return new Response(
    JSON.stringify({ ok: true, alerted: posted ? toAlert.length : 0, posted }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
