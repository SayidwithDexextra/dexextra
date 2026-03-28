import { NextRequest, NextResponse } from 'next/server';
import { completeSettlementFromAIResult, retrySettlementAIJobForMarket } from '@/lib/settlement-engine';
import { scheduleSettlementFinalize } from '@/lib/qstash-scheduler';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const secret = req.headers.get('x-callback-secret') || body.callbackSecret || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 });
  }

  const { jobId, status, result, error: jobError, meta } = body;
  const marketId = meta?.marketId as string | undefined;

  if (!marketId) {
    return NextResponse.json({ error: 'missing_meta.marketId' }, { status: 400 });
  }

  console.log('[ai-callback] received', { jobId, status, marketId, hasResult: !!result });

  if (status === 'failed' || !result) {
    console.warn('[ai-callback] AI job failed or no result', { jobId, marketId, jobError });
    return NextResponse.json({ ok: false, reason: 'ai_job_failed', jobError });
  }

  const price = Number(result.asset_price_suggestion ?? result.value);
  if (!Number.isFinite(price) || price <= 0) {
    const retryCount = Number(meta?.retryCount) || 0;
    const maxRetries = Number(process.env.SETTLEMENT_AI_MAX_RETRIES) || 3;

    if (retryCount < maxRetries) {
      console.warn(`[ai-callback] zero/invalid price, retrying (attempt ${retryCount + 1}/${maxRetries})`, { jobId, marketId, raw: result.asset_price_suggestion });
      const retryResult = await retrySettlementAIJobForMarket(marketId, retryCount + 1);
      return NextResponse.json({
        ok: retryResult.ok,
        reason: 'retrying_zero_price',
        attempt: retryCount + 1,
        retryJobId: retryResult.jobId,
        retryError: retryResult.error,
      });
    }

    console.warn('[ai-callback] invalid price from AI result, max retries exhausted', { jobId, marketId, raw: result.asset_price_suggestion, retryCount });
    return NextResponse.json({ ok: false, reason: 'invalid_ai_price_max_retries_exhausted' });
  }

  const aiData = {
    price,
    jobId: String(jobId || ''),
    waybackUrl: result.settlement_wayback_url || result.sources?.[0]?.wayback_screenshot_url || null,
    waybackPageUrl: result.settlement_wayback_page_url || result.sources?.[0]?.wayback_url || null,
    screenshotUrl: result.sources?.[0]?.screenshot_url || null,
  };

  const outcome = await completeSettlementFromAIResult(marketId, aiData);
  console.log('[ai-callback] settlement completion result', { jobId, marketId, ...outcome });

  if (outcome.ok && outcome.details?.expiresAt) {
    const expiresAtUnix = Math.floor(new Date(outcome.details.expiresAt as string).getTime() / 1000);
    try {
      const finalizeMsgId = await scheduleSettlementFinalize(marketId, expiresAtUnix, {
        marketAddress: (meta?.marketAddress as string) || undefined,
        symbol: (meta?.marketIdentifier as string) || undefined,
      });
      console.log('[ai-callback] scheduled precise finalize trigger', { marketId, expiresAt: outcome.details.expiresAt, finalizeMsgId });
    } catch (e: any) {
      console.warn('[ai-callback] failed to schedule precise finalize (safety-net cron will cover)', { marketId, error: e?.message });
    }
  }

  return NextResponse.json(outcome);
}
