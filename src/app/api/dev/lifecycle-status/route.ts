import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@upstash/qstash';

export const runtime = 'nodejs';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getQStashClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  return new Client({ token });
}

type PhaseStatus = 'upcoming' | 'active' | 'complete';

interface QStashMessageInfo {
  messageId: string;
  status: 'pending' | 'delivered' | 'not_found' | 'error';
  notBefore?: number;
}

interface Phase {
  name: string;
  status: PhaseStatus;
  startsAt: number | null;
  endsAt: number | null;
  qstash: QStashMessageInfo | null;
}

async function getMessageStatus(client: Client, messageId: string): Promise<QStashMessageInfo> {
  try {
    const msg = await (client.messages as any).get(messageId);
    return {
      messageId,
      status: 'pending',
      notBefore: msg?.notBefore ? Math.floor(msg.notBefore / 1000) : undefined,
    };
  } catch (e: any) {
    const status = e?.status || e?.response?.status;
    if (status === 404 || String(e?.message || '').includes('not found')) {
      return { messageId, status: 'delivered' };
    }
    return { messageId, status: 'error' };
  }
}

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === 'true';
  if (!isDev) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }

  const url = new URL(req.url);
  const marketId = url.searchParams.get('marketId');
  if (!marketId) {
    return NextResponse.json({ error: 'marketId query param required' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { data: market, error } = await supabase
    .from('markets')
    .select('id, market_status, settlement_date, market_config, settlement_window_expires_at')
    .eq('id', marketId)
    .maybeSingle();

  if (error || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const cfg = (typeof market.market_config === 'object' && market.market_config) || {} as any;
  const lifecycle = cfg.qstash_lifecycle || null;
  const nowSec = Math.floor(Date.now() / 1000);

  let rolloverTriggerAt: number | null = null;
  let settlementTriggerAt: number | null = null;
  let finalizeTriggerAt: number | null = null;
  let scheduleIds: { rollover?: string; settlement?: string; finalize?: string } = {};

  if (lifecycle) {
    rolloverTriggerAt = lifecycle.rollover_trigger_at ?? null;
    settlementTriggerAt = lifecycle.settlement_trigger_at ?? null;
    finalizeTriggerAt = lifecycle.finalize_trigger_at ?? null;
    scheduleIds = lifecycle.schedule_ids || {};
  } else if (market.settlement_date) {
    const stlUnix = Math.floor(new Date(market.settlement_date).getTime() / 1000);
    const duration = Math.max(1, stlUnix - (lifecycle?.scheduled_at ?? nowSec));
    const rolloverLead = Math.max(300, Math.floor(duration / 12));
    const challengeDuration = Math.max(60, Math.floor(duration / 365));
    rolloverTriggerAt = stlUnix - rolloverLead;
    settlementTriggerAt = stlUnix;
    finalizeTriggerAt = stlUnix + challengeDuration;
  }

  // Created-at timestamp: use scheduled_at from lifecycle, or approximate from rollover - market duration
  const createdAt = lifecycle?.scheduled_at ?? null;

  // Query QStash for live message status
  const qstashClient = getQStashClient();
  const qstashResults: Record<string, QStashMessageInfo | null> = {
    rollover: null,
    settlement: null,
    finalize: null,
  };

  if (qstashClient) {
    const lookups = Object.entries(scheduleIds)
      .filter(([, id]) => typeof id === 'string' && id.length > 0)
      .map(async ([key, id]) => {
        qstashResults[key] = await getMessageStatus(qstashClient, id as string);
      });
    await Promise.allSettled(lookups);
  }

  // Determine phase statuses
  const marketStatus: string = market.market_status || 'ACTIVE';

  function phaseStatus(startsAt: number | null, endsAt: number | null): PhaseStatus {
    if (startsAt === null) return 'upcoming';
    if (nowSec < startsAt) return 'upcoming';
    if (endsAt !== null && nowSec >= endsAt) return 'complete';
    return 'active';
  }

  const tradingEnd = rolloverTriggerAt;
  const rolloverEnd = settlementTriggerAt;
  const challengeEnd = finalizeTriggerAt;

  // Override statuses based on actual market_status from DB
  let tradingStatus = phaseStatus(createdAt, tradingEnd);
  let rolloverStatus = phaseStatus(rolloverTriggerAt, rolloverEnd);
  let challengeStatus = phaseStatus(settlementTriggerAt, challengeEnd);
  let settledStatus: PhaseStatus = 'upcoming';

  if (marketStatus === 'SETTLED') {
    tradingStatus = 'complete';
    rolloverStatus = 'complete';
    challengeStatus = 'complete';
    settledStatus = 'complete';
  } else if (marketStatus === 'SETTLEMENT_REQUESTED') {
    tradingStatus = 'complete';
    rolloverStatus = 'complete';
    challengeStatus = 'active';
  }

  const phases: Phase[] = [
    {
      name: 'trading',
      status: tradingStatus,
      startsAt: createdAt,
      endsAt: tradingEnd,
      qstash: null,
    },
    {
      name: 'rollover',
      status: rolloverStatus,
      startsAt: rolloverTriggerAt,
      endsAt: rolloverEnd,
      qstash: qstashResults.rollover,
    },
    {
      name: 'challenge',
      status: challengeStatus,
      startsAt: settlementTriggerAt,
      endsAt: challengeEnd,
      qstash: qstashResults.settlement,
    },
    {
      name: 'settled',
      status: settledStatus,
      startsAt: finalizeTriggerAt,
      endsAt: null,
      qstash: qstashResults.finalize,
    },
  ];

  return NextResponse.json({
    phases,
    marketStatus,
    speedRun: Boolean(cfg.speed_run),
    now: nowSec,
  });
}
