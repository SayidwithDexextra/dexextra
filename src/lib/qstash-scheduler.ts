import { Client } from '@upstash/qstash';

// ── Proportional lifecycle constants ──
// Must stay aligned with MarketLifecycleFacet.sol:
//   _rolloverLead:     duration / 12       (1/12 of lifecycle, ~30.4 days for 1 year)
//   _challengeDuration: duration / 365     (1/365 of lifecycle, 24 h for 1 year)
const ROLLOVER_DIVISOR = 12;  // matches Solidity: duration / 12
const CHALLENGE_DIVISOR = 365; // matches Solidity: duration / DAYS_PER_YEAR (365)

// ── Observed on-chain execution times ──
// Each lifecycle step takes wall-clock time to complete. Triggers must
// fire early enough that the step finishes before its logical deadline.
const ROLLOVER_EXECUTION_SEC = 150;      // ~2.5 min: deploy child, sync lifecycle, link lineage
const AI_PRICE_DISCOVERY_SEC = 90;       // ~1 min (p95 ~90s): AI worker finds yield price
const ONCHAIN_SETTLEMENT_SEC = 60;       // ~1 min: settleMarket tx confirmation

// Minimum lead times incorporate execution overhead so the step completes
// before T0 even on ultra-short markets.
const MIN_ROLLOVER_LEAD_SEC = 5 * 60 + ROLLOVER_EXECUTION_SEC;  // 7.5 min floor
const MIN_CHALLENGE_DURATION_SEC = 60 + AI_PRICE_DISCOVERY_SEC;  // 2.5 min floor

// settlement_finalize must arrive AFTER the challenge window expires AND
// leave room for the on-chain settleMarket tx. Buffer = AI round-trip
// headroom (120s) + on-chain settlement execution (~60s).
const AI_SETTLE_BUFFER_SEC = 120 + ONCHAIN_SETTLEMENT_SEC;  // 180s total

// QStash pay-as-you-go plan supports up to 1 year delay.
// Leave a 1-day buffer to avoid edge-case rejections.
const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60 - 86400; // ~364 days

type ScheduleIds = {
  rollover?: string;
  settlement?: string;
  finalize?: string;
  deferred?: string[];
};

/**
 * Derive rollover lead and challenge duration proportionally using the
 * same integer-division formulas as MarketLifecycleFacet.sol, then add
 * the observed on-chain execution time so each step *completes* before
 * its logical deadline rather than merely *starting* before it.
 *
 * Effective trigger offsets from T0:
 *   rollover      fires at  T0 - (duration/12  + ROLLOVER_EXECUTION_SEC)
 *   settlement    fires at  T0 - (duration/365 + AI_PRICE_DISCOVERY_SEC)
 *
 * Examples (trigger lead before T0):
 *   1 year  → rollover ~30.4 d + 2.5 m, challenge 24 h  + 1.5 m
 *   1 month → rollover 2.5 d  + 2.5 m,  challenge ~2 h  + 1.5 m
 *   1 week  → rollover 14 h   + 2.5 m,  challenge ~28 m + 1.5 m
 *   24 h    → rollover 2 h    + 2.5 m,  challenge ~4 m  + 1.5 m
 *   1 h     → rollover 7.5 min (clamped), challenge 2.5 min (clamped)
 */
function proportionalDurations(marketDurationSec: number) {
  return {
    rolloverLead: Math.max(
      MIN_ROLLOVER_LEAD_SEC,
      Math.floor(marketDurationSec / ROLLOVER_DIVISOR) + ROLLOVER_EXECUTION_SEC,
    ),
    challengeDuration: Math.max(
      MIN_CHALLENGE_DURATION_SEC,
      Math.floor(marketDurationSec / CHALLENGE_DIVISOR) + AI_PRICE_DISCOVERY_SEC,
    ),
  };
}

function getClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  return new Client({ token });
}

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Publish a single QStash message. If the target time exceeds the plan's
 * maxDelay, schedule a "reschedule" message that will re-invoke
 * scheduleMarketLifecycle closer to the target time.
 */
async function publishOrDefer(
  client: Client,
  destination: string,
  triggerAtUnix: number,
  body: Record<string, unknown>,
  label: string,
): Promise<string | undefined> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (triggerAtUnix <= nowSec) return undefined;

  const delaySec = triggerAtUnix - nowSec;

  if (delaySec <= MAX_DELAY_SECONDS) {
    const res = await client.publishJSON({
      url: destination,
      body,
      notBefore: triggerAtUnix,
      retries: 3,
      label,
    });
    return res.messageId;
  }

  // Too far out -- schedule a "reschedule" message at now + MAX_DELAY.
  // When it fires, the cron route will call scheduleMarketLifecycle again,
  // which will either schedule the real trigger or chain another deferral.
  const deferAt = nowSec + MAX_DELAY_SECONDS;
  const res = await client.publishJSON({
    url: destination,
    body: {
      action: 'reschedule',
      market_id: body.market_id,
      market_address: body.market_address,
      symbol: body.symbol,
      settlement_date_unix: body.settlement_date_unix,
    },
    notBefore: deferAt,
    retries: 3,
    label: `${label}.deferred`,
  });
  console.log(`[qstash-scheduler] ${label} too far out (${Math.round(delaySec / 86400)}d), deferred reschedule to ${new Date(deferAt * 1000).toISOString()}`);
  return res.messageId;
}

/**
 * Schedule the three lifecycle triggers for a market:
 *   1. Rollover window start  (T0 - rolloverLead)
 *      Includes ROLLOVER_EXECUTION_SEC (~2.5 min) so the child market is
 *      fully deployed and linked before the rollover deadline.
 *   2. Settlement start       (T0 - challengeDuration)
 *      Includes AI_PRICE_DISCOVERY_SEC (~1.5 min) so the AI job completes
 *      and the challenge window opens early enough to expire right at T0.
 *   3. Settlement finalize    (T0 + AI_SETTLE_BUFFER_SEC)
 *      Fires after T0 with enough buffer for both AI latency and the
 *      on-chain settleMarket tx (~1 min) to confirm.
 *
 * T0 = settlementDateUnix (the date the market is fully settled).
 * The settlement START fires early so the challenge window expires right
 * at T0, which is the countdown users see in the market header.
 *
 * Rollover lead and challenge duration are computed **proportionally** to
 * the market's total duration, using a 1-year contract as the reference
 * baseline (30-day rollover lead, 24-hour challenge window). On-chain
 * execution overheads are added on top so triggers fire early enough for
 * each step to *complete* before its deadline. Explicit overrides via
 * opts still take precedence (but callers should include execution time).
 *
 * If any trigger is more than ~364 days out, a deferred "reschedule"
 * message is published instead, which chains forward until reachable.
 *
 * Returns the QStash message IDs so they can be stored and later cancelled.
 */
export async function scheduleMarketLifecycle(
  marketId: string,
  settlementDateUnix: number,
  opts?: {
    rolloverLeadSeconds?: number;
    challengeDurationSeconds?: number;
    marketAddress?: string;
    symbol?: string;
    createdAtUnix?: number;
  },
): Promise<ScheduleIds> {
  const client = getClient();
  if (!client) {
    console.warn('[qstash-scheduler] QSTASH_TOKEN not configured, skipping schedule');
    return {};
  }

  const baseUrl = getBaseUrl();
  const destination = `${baseUrl}/api/cron/market-lifecycle`;
  const nowSec = Math.floor(Date.now() / 1000);
  const marketOrigin = opts?.createdAtUnix ?? nowSec;
  const marketDuration = Math.max(1, settlementDateUnix - marketOrigin);
  const proportional = proportionalDurations(marketDuration);
  const rolloverLead = opts?.rolloverLeadSeconds ?? proportional.rolloverLead;
  const challengeDuration = opts?.challengeDurationSeconds ?? proportional.challengeDuration;

  const ids: ScheduleIds = {};
  const sym = (opts?.symbol || marketId.slice(0, 8)).replace(/[^a-zA-Z0-9._-]/g, '_');
  const commonBody = {
    market_id: marketId,
    market_address: opts?.marketAddress || null,
    symbol: opts?.symbol || null,
    settlement_date_unix: settlementDateUnix,
  };

  const rolloverTriggerAt = settlementDateUnix - rolloverLead;
  if (rolloverTriggerAt > nowSec) {
    try {
      ids.rollover = await publishOrDefer(
        client, destination, rolloverTriggerAt,
        { ...commonBody, action: 'rollover' },
        `${sym}.rollover`,
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule rollover trigger:', e?.message || e);
    }
  }

  const settlementStartAt = settlementDateUnix - challengeDuration;
  if (settlementStartAt > nowSec) {
    try {
      ids.settlement = await publishOrDefer(
        client, destination, settlementStartAt,
        { ...commonBody, action: 'settlement_start' },
        `${sym}.settlement`,
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule settlement trigger:', e?.message || e);
    }
  }

  const finalizeAt = settlementDateUnix + AI_SETTLE_BUFFER_SEC;
  if (finalizeAt > nowSec) {
    try {
      ids.finalize = await publishOrDefer(
        client, destination, finalizeAt,
        { ...commonBody, action: 'settlement_finalize' },
        `${sym}.finalize`,
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule finalize trigger:', e?.message || e);
    }
  }

  console.log('[qstash-scheduler] Scheduled lifecycle triggers', {
    marketId,
    settlementDateUnix,
    marketDurationHours: Math.round(marketDuration / 3600 * 10) / 10,
    rolloverLeadHours: Math.round(rolloverLead / 3600 * 10) / 10,
    challengeDurationHours: Math.round(challengeDuration / 3600 * 10) / 10,
    executionBuffers: {
      rolloverExecSec: ROLLOVER_EXECUTION_SEC,
      aiPriceDiscoverySec: AI_PRICE_DISCOVERY_SEC,
      onchainSettlementSec: ONCHAIN_SETTLEMENT_SEC,
      totalFinalizeBufferSec: AI_SETTLE_BUFFER_SEC,
    },
    rolloverTriggerAt: rolloverTriggerAt > nowSec ? new Date(rolloverTriggerAt * 1000).toISOString() : 'skipped (past)',
    settlementStartAt: settlementStartAt > nowSec ? new Date(settlementStartAt * 1000).toISOString() : 'skipped (past)',
    finalizeAt: finalizeAt > nowSec ? new Date(finalizeAt * 1000).toISOString() : 'skipped (past)',
    ids,
  });

  return ids;
}

/**
 * Schedule (or re-schedule) a single settlement_finalize trigger at a
 * precise unix timestamp.  Used in two places:
 *
 *   1. The AI-callback webhook — once the challenge window is actually open
 *      we know the exact expiry time and schedule the finalize to match.
 *   2. The settlement_finalize handler itself — if the pre-scheduled trigger
 *      arrives before the window has expired (AI latency), it re-queues
 *      itself at the real expiry time instead of failing silently.
 *
 * Both layers together guarantee the finalize fires exactly when the
 * challenge window closes, regardless of AI processing latency.
 */
export async function scheduleSettlementFinalize(
  marketId: string,
  triggerAtUnix: number,
  opts?: {
    marketAddress?: string;
    symbol?: string;
    settlementDateUnix?: number;
  },
): Promise<string | undefined> {
  const client = getClient();
  if (!client) {
    console.warn('[qstash-scheduler] QSTASH_TOKEN not configured, skipping finalize schedule');
    return undefined;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (triggerAtUnix <= nowSec) return undefined;

  const baseUrl = getBaseUrl();
  const destination = `${baseUrl}/api/cron/market-lifecycle`;
  const sym = (opts?.symbol || marketId.slice(0, 8)).replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const msgId = await publishOrDefer(
      client,
      destination,
      triggerAtUnix,
      {
        action: 'settlement_finalize',
        market_id: marketId,
        market_address: opts?.marketAddress || null,
        symbol: opts?.symbol || null,
        settlement_date_unix: opts?.settlementDateUnix || null,
      },
      `${sym}.finalize.precise`,
    );
    console.log('[qstash-scheduler] Scheduled precise finalize trigger', {
      marketId,
      triggerAt: new Date(triggerAtUnix * 1000).toISOString(),
      msgId,
    });
    return msgId;
  } catch (e: any) {
    console.error('[qstash-scheduler] Failed to schedule precise finalize:', e?.message || e);
    return undefined;
  }
}

/**
 * Cancel all pending QStash messages for a market.
 */
export async function cancelMarketSchedule(scheduleIds: ScheduleIds): Promise<void> {
  const client = getClient();
  if (!client) return;

  const flat = [
    scheduleIds.rollover,
    scheduleIds.settlement,
    scheduleIds.finalize,
    ...(scheduleIds.deferred || []),
  ].filter(Boolean) as string[];

  await Promise.allSettled(
    flat.map(async (id) => {
      try {
        await client.messages.delete(id);
      } catch (e: any) {
        if (!String(e?.message || '').includes('not found')) {
          console.warn('[qstash-scheduler] Failed to cancel message', id, e?.message);
        }
      }
    }),
  );
}
