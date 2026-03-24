import { Client } from '@upstash/qstash';

// ── Proportional lifecycle constants ──
// Must stay aligned with MarketLifecycleFacet.sol:
//   _rolloverLead:     duration / 12       (1/12 of lifecycle, ~30.4 days for 1 year)
//   _challengeDuration: duration / 365     (1/365 of lifecycle, 24 h for 1 year)
const ROLLOVER_DIVISOR = 12;  // matches Solidity: duration / 12
const CHALLENGE_DIVISOR = 365; // matches Solidity: duration / DAYS_PER_YEAR (365)

const MIN_ROLLOVER_LEAD_SEC = 5 * 60;   // 5 minutes — floor for ultra-short markets
const MIN_CHALLENGE_DURATION_SEC = 60;   // 1 minute — matches Solidity MIN_CHALLENGE_DURATION

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
 * same integer-division formulas as MarketLifecycleFacet.sol.
 *
 * Examples:
 *   1 year  → rollover ~30.4 d, challenge 24 h
 *   1 month → rollover 2.5 d,   challenge ~2 h
 *   1 week  → rollover 14 h,    challenge ~28 min
 *   24 h    → rollover 2 h,     challenge ~4 min
 *   1 h     → rollover 5 min,   challenge 1 min (clamped)
 */
function proportionalDurations(marketDurationSec: number) {
  return {
    rolloverLead: Math.max(
      MIN_ROLLOVER_LEAD_SEC,
      Math.floor(marketDurationSec / ROLLOVER_DIVISOR),
    ),
    challengeDuration: Math.max(
      MIN_CHALLENGE_DURATION_SEC,
      Math.floor(marketDurationSec / CHALLENGE_DIVISOR),
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
    label: `${label}:deferred`,
  });
  console.log(`[qstash-scheduler] ${label} too far out (${Math.round(delaySec / 86400)}d), deferred reschedule to ${new Date(deferAt * 1000).toISOString()}`);
  return res.messageId;
}

/**
 * Schedule the three lifecycle triggers for a market:
 *   1. Rollover window start  (T0 - rolloverLead)
 *   2. Settlement start       (T0 - challengeDuration)  — propose price, open challenge window
 *   3. Settlement finalize    (T0)                       — finalize on-chain if undisputed
 *
 * T0 = settlementDateUnix (the date the market is fully settled).
 * The settlement START fires early so the challenge window expires right
 * at T0, which is the countdown users see in the market header.
 *
 * Rollover lead and challenge duration are computed **proportionally** to
 * the market's total duration, using a 1-year contract as the reference
 * baseline (30-day rollover lead, 24-hour challenge window). Explicit
 * overrides via opts still take precedence.
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
  const sym = opts?.symbol || marketId.slice(0, 8);
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
        `${sym}:rollover`,
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
        `${sym}:settlement`,
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule settlement trigger:', e?.message || e);
    }
  }

  if (settlementDateUnix > nowSec) {
    try {
      ids.finalize = await publishOrDefer(
        client, destination, settlementDateUnix,
        { ...commonBody, action: 'settlement_finalize' },
        `${sym}:finalize`,
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
    rolloverTriggerAt: rolloverTriggerAt > nowSec ? new Date(rolloverTriggerAt * 1000).toISOString() : 'skipped (past)',
    settlementStartAt: settlementStartAt > nowSec ? new Date(settlementStartAt * 1000).toISOString() : 'skipped (past)',
    finalizeAt: settlementDateUnix > nowSec ? new Date(settlementDateUnix * 1000).toISOString() : 'skipped (past)',
    ids,
  });

  return ids;
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
