// Withdrawal saga reconciliation worker.
//
// Picks up rows in `withdrawal_jobs` that are stuck in any non-terminal state
// (outbox_failed, hub_sent, spoke_pending, spoke_failed) and drives them to
// completion. This is the safety net that ensures every credit debited from
// CoreVault eventually lands in the user's spoke wallet, even if the original
// API request crashed, ran out of gas, or the spoke RPC was temporarily down.
//
// Triggered every minute by pg_cron via net.http_post — see migration.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6";

// ─────── Env ───────

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  "";

const HUB_RPC =
  Deno.env.get("HUB_RPC_URL") ||
  Deno.env.get("ALCHEMY_HYPERLIQUID_HTTP") ||
  Deno.env.get("RPC_URL_HUB") ||
  Deno.env.get("RPC_URL_HYPEREVM") ||
  Deno.env.get("RPC_URL") ||
  "";

const ARBITRUM_RPC =
  Deno.env.get("ALCHEMY_ARBITRUM_HTTP") ||
  Deno.env.get("RPC_URL_ARBITRUM") ||
  Deno.env.get("ARBITRUM_RPC_URL") ||
  "";

const HUB_DOMAIN = Number(Deno.env.get("BRIDGE_DOMAIN_HUB") || "999");

const HUB_OUTBOX_ADDR =
  Deno.env.get("HUB_OUTBOX_ADDRESS") ||
  "0x4c32ff22b927a134a3286d5E33212debF951AcF5";

const SPOKE_INBOX_ARBITRUM =
  Deno.env.get("SPOKE_INBOX_ADDRESS_ARBITRUM") ||
  "0x8FDFAF6146318DD893E89E5ac2e3FD73554c02b6";

const ARBITRUM_USDC =
  Deno.env.get("SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS") ||
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const BATCH_SIZE = (() => {
  const n = parseInt(Deno.env.get("WITHDRAW_RETRY_BATCH_SIZE") || "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

function getDepositWithdrawalKey(): string {
  const raw = (
    Deno.env.get("DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY") ||
    Deno.env.get("RELAYER_PRIVATE_KEY") ||
    ""
  ).trim();
  if (!raw) return "";
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[a-fA-F0-9]{64}$/.test(v) ? v : "";
}

// ─────── ABIs ───────

const HUB_OUTBOX_ABI = [
  "function sendWithdraw(uint64 dstDomain, address user, address token, uint256 amount, bytes32 withdrawId) external",
  "event WithdrawSent(uint64 indexed dstDomain, address indexed user, address token, uint256 amount, bytes32 indexed withdrawId, bytes payload)",
] as const;

const SPOKE_INBOX_ABI = [
  "function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes payload) external",
] as const;

const SPOKE_VAULT_VIEW_ABI = [
  "function processedWithdrawIds(bytes32) view returns (bool)",
] as const;

// ─────── Helpers ───────

function logStep(traceId: string, step: string, data: Record<string, any>) {
  console.log(JSON.stringify({ traceId, step, ts: new Date().toISOString(), ...data }));
}

function shortErr(e: any): string {
  return String(e?.reason || e?.shortMessage || e?.message || e || "").slice(0, 800);
}

function toBytes32Address(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + "0".repeat(24) + hex;
}

type SpokeCfg = {
  name: "arbitrum";
  chainId: number;
  rpc: string;
  usdc: string;
  inbox: string;
  remoteAppEnv: string | undefined;
};

function getSpokeCfg(targetChainId: number): SpokeCfg | null {
  // Arbitrum is the only supported spoke chain. Any other chainId is rejected
  // by the worker and routed to requires_manual.
  if (targetChainId === 42161) {
    return {
      name: "arbitrum",
      chainId: 42161,
      rpc: ARBITRUM_RPC,
      usdc: ARBITRUM_USDC,
      inbox: SPOKE_INBOX_ARBITRUM,
      remoteAppEnv: Deno.env.get("BRIDGE_REMOTE_APP_HUB_FOR_ARBITRUM"),
    };
  }
  return null;
}

function getHubRemoteApp(_spokeName: string): string {
  return (
    Deno.env.get("BRIDGE_REMOTE_APP_HUB_FOR_ARBITRUM") ||
    Deno.env.get("BRIDGE_REMOTE_APP_HUB") ||
    toBytes32Address(HUB_OUTBOX_ADDR)
  );
}

// Look back ~24h on hub for an existing WithdrawSent log so we can skip
// re-sending step 2 if the original tx actually landed but we crashed before
// recording it. We bound the lookback to keep RPC cost predictable.
async function findExistingWithdrawSent(
  hubProvider: ethers.JsonRpcProvider,
  withdrawId: string
): Promise<{ blockNumber: number; txHash: string } | null> {
  try {
    const outbox = new ethers.Contract(HUB_OUTBOX_ADDR, HUB_OUTBOX_ABI, hubProvider);
    const latest = await hubProvider.getBlockNumber();
    // HyperEVM has 1s blocks → 24h ≈ 86,400 blocks. Keep below the typical
    // log-range cap (some providers cap at 10k). Walk in 9k-block windows.
    const totalLookback = 90_000;
    const window = 9_000;
    let cursor = latest;
    const earliest = Math.max(0, latest - totalLookback);
    while (cursor > earliest) {
      const from = Math.max(earliest, cursor - window + 1);
      const filter = outbox.filters.WithdrawSent(undefined, undefined, withdrawId);
      const logs = await outbox.queryFilter(filter, from, cursor);
      if (logs.length > 0) {
        const log = logs[0];
        return { blockNumber: log.blockNumber, txHash: log.transactionHash };
      }
      cursor = from - 1;
    }
  } catch {
    // Soft-fail: if we can't query logs, fall through and try sending.
    // Worst case = duplicate WithdrawSent which is idempotent on the spoke
    // because of processedWithdrawIds[withdrawId].
  }
  return null;
}

// Reconstruct the SpokeVault address from the inbox contract. Many inbox
// implementations store this as a public immutable; we don't have an ABI for
// it across all V3 versions, so we instead probe processedWithdrawIds
// directly on a known SecureSpokeVault pattern. Caller passes spokeVaultAddr
// when known via env.
async function isWithdrawAlreadyProcessedOnSpoke(
  spokeProvider: ethers.JsonRpcProvider,
  spokeVaultAddr: string,
  withdrawId: string
): Promise<boolean> {
  if (!ethers.isAddress(spokeVaultAddr)) return false;
  try {
    const vault = new ethers.Contract(spokeVaultAddr, SPOKE_VAULT_VIEW_ABI, spokeProvider);
    return Boolean(await vault.processedWithdrawIds(withdrawId));
  } catch {
    return false;
  }
}

function getSpokeVaultAddr(_spokeName: "arbitrum"): string {
  return (
    Deno.env.get("SPOKE_VAULT_ADDRESS_ARBITRUM") ||
    Deno.env.get("SPOKE_ARBITRUM_VAULT_ADDRESS") ||
    Deno.env.get("SPOKE_VAULT_ADDRESS") ||
    ""
  );
}

// ─────── Job processing ───────

type Job = {
  id: string;
  user_address: string;
  target_chain_id: number;
  amount_wei: string;
  spoke_token: string | null;
  status: string;
  withdraw_id: string | null;
  hub_send_tx: string | null;
  spoke_deliver_tx: string | null;
  attempts: number;
  max_attempts: number;
  metadata: Record<string, any>;
};

async function processStepHubSend(
  job: Job,
  hubProvider: ethers.JsonRpcProvider,
  hubWallet: ethers.Wallet,
  supabase: any,
  traceId: string
): Promise<string> {
  if (!job.withdraw_id) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: "missing withdraw_id at hub_sending",
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }

  // If the original step-2 tx actually landed before we crashed, skip resend.
  const existing = await findExistingWithdrawSent(hubProvider, job.withdraw_id);
  if (existing) {
    logStep(traceId, "step2_already_emitted_onchain", { jobId: job.id, ...existing });
    await supabase.rpc("mark_withdrawal_step", {
      p_id: job.id,
      p_to_status: "hub_sent",
      p_patch: {
        hub_send_tx: existing.txHash,
        hub_send_block: String(existing.blockNumber),
      },
    });
    return "advanced_to_hub_sent";
  }

  const cfg = getSpokeCfg(job.target_chain_id);
  if (!cfg) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: `unsupported chain ${job.target_chain_id}`,
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }

  const token = job.spoke_token || cfg.usdc;
  if (!ethers.isAddress(token)) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: `spoke_token missing/invalid: ${token}`,
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }

  try {
    const outbox = new ethers.Contract(HUB_OUTBOX_ADDR, HUB_OUTBOX_ABI, hubWallet);
    await outbox.sendWithdraw.staticCall(
      job.target_chain_id,
      job.user_address,
      token,
      BigInt(job.amount_wei),
      job.withdraw_id
    );
    const tx = await outbox.sendWithdraw(
      job.target_chain_id,
      job.user_address,
      token,
      BigInt(job.amount_wei),
      job.withdraw_id
    );
    const rc = await tx.wait();
    await supabase.rpc("mark_withdrawal_step", {
      p_id: job.id,
      p_to_status: "hub_sent",
      p_patch: {
        hub_send_tx: tx.hash,
        hub_send_block: String(rc?.blockNumber ?? 0),
      },
    });
    logStep(traceId, "step2_resent", { jobId: job.id, txHash: tx.hash });
    return "hub_sent";
  } catch (err: any) {
    const out = await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: shortErr(err),
      p_requeue_to: "outbox_failed",
      p_backoff_seconds: 60,
    });
    return (out.data as string) || "requeued";
  }
}

async function processStepSpokeDeliver(
  job: Job,
  supabase: any,
  traceId: string
): Promise<string> {
  if (!job.withdraw_id) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: "missing withdraw_id at spoke_delivering",
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }

  const cfg = getSpokeCfg(job.target_chain_id);
  if (!cfg || !cfg.rpc) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: `spoke RPC not configured for chain ${job.target_chain_id}`,
      p_requeue_to: "spoke_pending",
      p_backoff_seconds: 120,
    });
    return "requeued";
  }
  if (!ethers.isAddress(cfg.inbox)) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: `spoke inbox not configured for ${cfg.name}`,
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }
  const token = job.spoke_token || cfg.usdc;
  if (!ethers.isAddress(token)) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: `spoke_token missing/invalid: ${token}`,
      p_requeue_to: "requires_manual",
      p_backoff_seconds: 0,
    });
    return "requires_manual";
  }

  const spokeProvider = new ethers.JsonRpcProvider(cfg.rpc);

  // Has the spoke already delivered? (Idempotency check via the vault.)
  const vaultAddr = getSpokeVaultAddr(cfg.name);
  if (vaultAddr) {
    const already = await isWithdrawAlreadyProcessedOnSpoke(
      spokeProvider,
      vaultAddr,
      job.withdraw_id
    );
    if (already) {
      logStep(traceId, "step3_already_delivered_onchain", { jobId: job.id });
      await supabase.rpc("complete_withdrawal_job", {
        p_id: job.id,
        p_spoke_deliver_tx: null,
        p_spoke_deliver_block: null,
      });
      return "completed_via_idempotency";
    }
  }

  const pk = getDepositWithdrawalKey();
  if (!pk) {
    await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: "DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY missing",
      p_requeue_to: "spoke_pending",
      p_backoff_seconds: 60,
    });
    return "requeued";
  }

  const wallet = new ethers.Wallet(pk, spokeProvider);
  const inbox = new ethers.Contract(cfg.inbox, SPOKE_INBOX_ABI, wallet);

  const TYPE_WITHDRAW = 2;
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "address", "uint256", "bytes32"],
    [TYPE_WITHDRAW, job.user_address, token, BigInt(job.amount_wei), job.withdraw_id]
  );
  const remoteApp = getHubRemoteApp(cfg.name);

  try {
    await inbox.receiveMessage.staticCall(HUB_DOMAIN, remoteApp, payload);

    const fee = await spokeProvider.getFeeData().catch(() => ({} as any));
    const maxPriorityFeePerGas =
      cfg.name === "arbitrum"
        ? ethers.parseUnits("0.05", "gwei")
        : (fee?.maxPriorityFeePerGas ?? ethers.parseUnits("35", "gwei"));
    const base = (fee?.maxFeePerGas ?? fee?.gasPrice ?? maxPriorityFeePerGas * 2n) as bigint;
    const maxFeePerGas =
      cfg.name === "arbitrum"
        ? base + maxPriorityFeePerGas
        : base + maxPriorityFeePerGas * 2n;

    let gasLimit = cfg.name === "arbitrum" ? 150000n : 300000n;
    try {
      const est = await inbox.receiveMessage.estimateGas(HUB_DOMAIN, remoteApp, payload);
      gasLimit = (est * 130n) / 100n;
    } catch {}

    const tx = await inbox.receiveMessage(HUB_DOMAIN, remoteApp, payload, {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    const rc = await tx.wait();

    await supabase.rpc("complete_withdrawal_job", {
      p_id: job.id,
      p_spoke_deliver_tx: tx.hash,
      p_spoke_deliver_block: String(rc?.blockNumber ?? 0),
    });
    logStep(traceId, "step3_delivered", { jobId: job.id, txHash: tx.hash });
    return "completed";
  } catch (err: any) {
    const msg = shortErr(err);
    // If the spoke says it was already processed, we can complete idempotently.
    if (
      msg.toLowerCase().includes("already processed") ||
      msg.toLowerCase().includes("already executed") ||
      msg.toLowerCase().includes("duplicate")
    ) {
      await supabase.rpc("complete_withdrawal_job", {
        p_id: job.id,
        p_spoke_deliver_tx: null,
        p_spoke_deliver_block: null,
      });
      return "completed_via_revert_signal";
    }
    const out = await supabase.rpc("fail_or_requeue_withdrawal_job", {
      p_id: job.id,
      p_error: msg,
      p_requeue_to: "spoke_failed",
      p_backoff_seconds: 60,
    });
    return (out.data as string) || "requeued";
  }
}

// ─────── Serve ───────

Deno.serve(async () => {
  const traceId = `wsaga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: "missing SUPABASE env" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const pk = getDepositWithdrawalKey();
  if (!pk) {
    return new Response(JSON.stringify({ error: "missing DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!HUB_RPC) {
    return new Response(JSON.stringify({ error: "missing HUB_RPC_URL" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const hubProvider = new ethers.JsonRpcProvider(HUB_RPC);
  const hubWallet = new ethers.Wallet(pk, hubProvider);

  logStep(traceId, "worker_start", { batch: BATCH_SIZE, hub: hubWallet.address });

  const { data: jobs, error: claimErr } = await supabase.rpc("claim_withdrawal_jobs", {
    p_limit: BATCH_SIZE,
  });
  if (claimErr) {
    logStep(traceId, "claim_error", { error: claimErr.message });
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: "queue empty" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  logStep(traceId, "jobs_claimed", { count: jobs.length });

  const results: any[] = [];
  for (const raw of jobs as Job[]) {
    try {
      let outcome: string;
      // After claim, a row that was `outbox_failed` is now `hub_sending`.
      // A row that was hub_sent / spoke_pending / spoke_failed is now `spoke_delivering`.
      if (raw.status === "hub_sending") {
        outcome = await processStepHubSend(raw, hubProvider, hubWallet, supabase, traceId);
        if (outcome === "hub_sent" || outcome === "advanced_to_hub_sent") {
          // Try to deliver to the spoke right now while we have the slot.
          const after = await supabase
            .from("withdrawal_jobs")
            .select("*")
            .eq("id", raw.id)
            .maybeSingle();
          if (after.data) {
            // Manually advance to spoke_delivering so processStepSpokeDeliver
            // sees the canonical state. (Worker already holds the lock via
            // earliest_run_at = now()+90s).
            await supabase
              .from("withdrawal_jobs")
              .update({ status: "spoke_delivering" })
              .eq("id", raw.id)
              .eq("status", "hub_sent");
            outcome = await processStepSpokeDeliver({ ...after.data, status: "spoke_delivering" } as any, supabase, traceId);
          }
        }
      } else if (raw.status === "spoke_delivering") {
        outcome = await processStepSpokeDeliver(raw, supabase, traceId);
      } else {
        // Defensive: claim should never give us anything else.
        outcome = "skipped_unexpected_status";
        logStep(traceId, "skip_unexpected", { jobId: raw.id, status: raw.status });
      }
      results.push({ id: raw.id, outcome });
      logStep(traceId, "job_result", { id: raw.id, outcome });
    } catch (e: any) {
      logStep(traceId, "job_unhandled_error", { id: raw.id, reason: shortErr(e) });
      try {
        await supabase.rpc("fail_or_requeue_withdrawal_job", {
          p_id: raw.id,
          p_error: `unhandled:${shortErr(e)}`,
          p_requeue_to: raw.status === "hub_sending" ? "outbox_failed" : "spoke_failed",
          p_backoff_seconds: 90,
        });
      } catch {}
      results.push({ id: raw.id, outcome: "unhandled" });
    }
  }

  logStep(traceId, "worker_done", {
    total: results.length,
    completed: results.filter((r) =>
      ["completed", "completed_via_idempotency", "completed_via_revert_signal"].includes(r.outcome)
    ).length,
    requires_manual: results.filter((r) => r.outcome === "requires_manual").length,
  });

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
