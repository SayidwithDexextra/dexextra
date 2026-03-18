import { Client } from '@upstash/qstash';

const DEFAULT_ROLLOVER_LEAD_SECONDS = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_CHALLENGE_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

// QStash pay-as-you-go plan supports up to 1 year delay.
// Leave a 1-day buffer to avoid edge-case rejections.
const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60 - 86400; // ~364 days

type ScheduleIds = {
  rollover?: string;
  settlement?: string;
  finalize?: string;
  deferred?: string[];
};

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
  });
  console.log(`[qstash-scheduler] ${label} too far out (${Math.round(delaySec / 86400)}d), deferred reschedule to ${new Date(deferAt * 1000).toISOString()}`);
  return res.messageId;
}

/**
 * Schedule the three lifecycle triggers for a market:
 *   1. Rollover window start  (T0 - rolloverLead)
 *   2. Settlement start       (T0)
 *   3. Settlement finalize    (T0 + challengeDuration)
 *
 * If any trigger is more than ~7 days out, a deferred "reschedule" message
 * is published instead, which chains forward until the target is reachable.
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
  },
): Promise<ScheduleIds> {
  const client = getClient();
  if (!client) {
    console.warn('[qstash-scheduler] QSTASH_TOKEN not configured, skipping schedule');
    return {};
  }

  const baseUrl = getBaseUrl();
  const destination = `${baseUrl}/api/cron/market-lifecycle`;
  const rolloverLead = opts?.rolloverLeadSeconds ?? DEFAULT_ROLLOVER_LEAD_SECONDS;
  const challengeDuration = opts?.challengeDurationSeconds ?? DEFAULT_CHALLENGE_DURATION_SECONDS;
  const nowSec = Math.floor(Date.now() / 1000);

  const ids: ScheduleIds = {};
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
        'rollover',
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule rollover trigger:', e?.message || e);
    }
  }

  if (settlementDateUnix > nowSec) {
    try {
      ids.settlement = await publishOrDefer(
        client, destination, settlementDateUnix,
        { ...commonBody, action: 'settlement_start' },
        'settlement_start',
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule settlement trigger:', e?.message || e);
    }
  }

  const finalizeTriggerAt = settlementDateUnix + challengeDuration;
  if (finalizeTriggerAt > nowSec) {
    try {
      ids.finalize = await publishOrDefer(
        client, destination, finalizeTriggerAt,
        { ...commonBody, action: 'settlement_finalize' },
        'settlement_finalize',
      );
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule finalize trigger:', e?.message || e);
    }
  }

  console.log('[qstash-scheduler] Scheduled lifecycle triggers', {
    marketId,
    settlementDateUnix,
    rolloverTriggerAt: rolloverTriggerAt > nowSec ? new Date(rolloverTriggerAt * 1000).toISOString() : 'skipped (past)',
    settlementAt: settlementDateUnix > nowSec ? new Date(settlementDateUnix * 1000).toISOString() : 'skipped (past)',
    finalizeAt: finalizeTriggerAt > nowSec ? new Date(finalizeTriggerAt * 1000).toISOString() : 'skipped (past)',
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
