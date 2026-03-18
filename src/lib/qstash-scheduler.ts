import { Client } from '@upstash/qstash';

const DEFAULT_ROLLOVER_LEAD_SECONDS = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_CHALLENGE_DURATION_SECONDS = 24 * 60 * 60; // 24 hours

type ScheduleIds = {
  rollover?: string;
  settlement?: string;
  finalize?: string;
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
 * Schedule the three lifecycle triggers for a market:
 *   1. Rollover window start  (T0 - rolloverLead)
 *   2. Settlement start       (T0)
 *   3. Settlement finalize    (T0 + challengeDuration)
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

  const rolloverTriggerAt = settlementDateUnix - rolloverLead;
  if (rolloverTriggerAt > nowSec) {
    try {
      const res = await client.publishJSON({
        url: destination,
        body: {
          action: 'rollover',
          market_id: marketId,
          market_address: opts?.marketAddress || null,
          symbol: opts?.symbol || null,
          settlement_date_unix: settlementDateUnix,
        },
        notBefore: rolloverTriggerAt,
        retries: 3,
      });
      ids.rollover = res.messageId;
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule rollover trigger:', e?.message || e);
    }
  }

  if (settlementDateUnix > nowSec) {
    try {
      const res = await client.publishJSON({
        url: destination,
        body: {
          action: 'settlement_start',
          market_id: marketId,
          market_address: opts?.marketAddress || null,
          symbol: opts?.symbol || null,
          settlement_date_unix: settlementDateUnix,
        },
        notBefore: settlementDateUnix,
        retries: 3,
      });
      ids.settlement = res.messageId;
    } catch (e: any) {
      console.error('[qstash-scheduler] Failed to schedule settlement trigger:', e?.message || e);
    }
  }

  const finalizeTriggerAt = settlementDateUnix + challengeDuration;
  if (finalizeTriggerAt > nowSec) {
    try {
      const res = await client.publishJSON({
        url: destination,
        body: {
          action: 'settlement_finalize',
          market_id: marketId,
          market_address: opts?.marketAddress || null,
          symbol: opts?.symbol || null,
          settlement_date_unix: settlementDateUnix,
        },
        notBefore: finalizeTriggerAt,
        retries: 3,
      });
      ids.finalize = res.messageId;
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

  const toCancel = Object.values(scheduleIds).filter(Boolean) as string[];
  await Promise.allSettled(
    toCancel.map(async (id) => {
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
