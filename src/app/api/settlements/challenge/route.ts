import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRelayerConfig, relayTick, type ChallengerEvidence } from '@/lib/dispute-relayer';
import { isChallengeWindowActive } from '@/lib/settlement-window';
import { ethers } from 'ethers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      market_id,
      market_identifier,
      price,
      proposer_wallet,
      txHash,
      market_address,
      evidence_source_url: evidenceSourceRaw,
      evidence_image_url: evidenceImageRaw,
    } = body || {};

    if ((!market_id && !market_identifier) || !price || Number(price) <= 0 || !Number.isFinite(Number(price))) {
      return NextResponse.json(
        { error: 'Invalid request. Provide market_id or market_identifier and a positive price.' },
        { status: 400 }
      );
    }

    const evidenceSourceTrim =
      typeof evidenceSourceRaw === 'string' ? evidenceSourceRaw.trim() : '';
    const evidenceImageTrim =
      typeof evidenceImageRaw === 'string' ? evidenceImageRaw.trim() : '';

    const isValidHttpUrl = (s: string) => {
      try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    };

    const sourceOk = evidenceSourceTrim !== '' && isValidHttpUrl(evidenceSourceTrim);
    const imageOk = evidenceImageTrim !== '' && isValidHttpUrl(evidenceImageTrim);
    if (!sourceOk && !imageOk) {
      return NextResponse.json(
        {
          error:
            'Provide supporting evidence: a valid http(s) source URL and/or an uploaded image URL from the challenge form.',
        },
        { status: 400 },
      );
    }
    if (evidenceSourceTrim !== '' && !sourceOk) {
      return NextResponse.json({ error: 'Evidence source URL must be a valid http(s) link.' }, { status: 400 });
    }

    // 1) Load market
    let query = supabase.from('markets').select('*').limit(1);
    if (market_id) query = query.eq('id', market_id);
    else query = query.eq('market_identifier', String(market_identifier));
    const { data: market, error: fetchErr } = await query.maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: `Failed to fetch market: ${fetchErr.message}` }, { status: 500 });
    }
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    // 2) Validate active window (aligned with settlement-engine expires_at / challenge duration)
    const now = new Date();
    if (!isChallengeWindowActive(market)) {
      return NextResponse.json({ error: 'No active settlement window' }, { status: 409 });
    }

    const existingConfig = (market.market_config || {}) as Record<string, unknown>;
    const priorEvidence = (existingConfig.challenger_evidence as Record<string, unknown> | undefined) || {};
    const evidencePayload = {
      ...priorEvidence,
      ...(sourceOk ? { source_url: evidenceSourceTrim } : {}),
      ...(imageOk ? { image_url: evidenceImageTrim } : {}),
      submitted_at: now.toISOString(),
    };

    // 3) Apply challenge to Supabase (including challenger evidence in market_config)
    const resolvedMarketAddress = market_address || market.market_address || null;
    const updateData: Record<string, any> = {
      alternative_settlement_value: Number(price),
      alternative_settlement_at: now.toISOString(),
      alternative_settlement_by: proposer_wallet || null,
      settlement_disputed: true,
      market_config: { ...existingConfig, challenger_evidence: evidencePayload },
      updated_at: now.toISOString(),
    };

    let update = supabase.from('markets').update(updateData);
    if (market_id) update = update.eq('id', market_id);
    else update = update.eq('market_identifier', String(market_identifier));
    const { data: updated, error: updateErr } = await update.select().single();
    if (updateErr) {
      return NextResponse.json({ error: `Failed to submit alternative price: ${updateErr.message}` }, { status: 500 });
    }

    const configAfterChallenge = (updateData.market_config || {}) as Record<string, unknown>;

    // 4) Trigger UMA escalation if we have a market address and on-chain txHash
    let umaResult: { uma_assertion_id?: string; uma_escalation_tx?: string; relay_error?: string } = {};

    if (resolvedMarketAddress && txHash) {
      try {
        const config = getRelayerConfig();
        const proposedPrice = ethers.parseUnits(
          (market.proposed_settlement_value ?? 0).toFixed(6),
          6,
        );

        const challengerEvidence: ChallengerEvidence = {
          ...(sourceOk ? { source_url: evidenceSourceTrim } : {}),
          ...(imageOk ? { image_url: evidenceImageTrim } : {}),
        };

        const result = await relayTick(
          config,
          resolvedMarketAddress,
          proposedPrice,
          undefined,
          challengerEvidence,
        );

        if (result.action === 'escalated' && result.assertionId) {
          umaResult = {
            uma_assertion_id: result.assertionId,
            uma_escalation_tx: result.txHash,
          };

          // Persist UMA state to market_config
          const configUpdate = {
            ...configAfterChallenge,
            uma_assertion_id: result.assertionId,
            uma_escalated_at: now.toISOString(),
            uma_escalation_tx: result.txHash,
            uma_challenge_tx_hash: txHash,
          };

          const marketId = market_id || market.id;
          await supabase
            .from('markets')
            .update({ market_config: configUpdate, updated_at: now.toISOString() })
            .eq('id', marketId);
        } else if (result.action === 'error') {
          umaResult = { relay_error: result.error };
          console.error('[challenge] UMA escalation error:', result.error);
        }
      } catch (relayErr: any) {
        umaResult = { relay_error: relayErr?.message || 'Unknown relay error' };
        console.error('[challenge] UMA relay exception:', relayErr);
      }
    }

    return NextResponse.json({
      success: true,
      market: updated,
      ...umaResult,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
