import { NextRequest, NextResponse } from 'next/server';
import { completeSettlementFromAIResult } from '@/lib/settlement-engine';

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
    console.warn('[ai-callback] invalid price from AI result', { jobId, marketId, raw: result.asset_price_suggestion });
    return NextResponse.json({ ok: false, reason: 'invalid_ai_price' });
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
  return NextResponse.json(outcome);
}
