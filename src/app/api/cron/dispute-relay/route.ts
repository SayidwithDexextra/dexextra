import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRelayerConfig, relayTick, type RelayTickResult, type ChallengerEvidence, type EscalationMeta } from '@/lib/dispute-relayer';

export const runtime = 'nodejs';
export const maxDuration = 60;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * POST /api/cron/dispute-relay
 *
 * Cron-triggered relay tick that:
 *   1. Scans Supabase for markets with active settlement disputes
 *   2. Escalates new challenges to UMA via DisputeRelay on Sepolia
 *   3. Checks pending UMA disputes for DVM resolution
 *   4. Relays resolved disputes back to HyperLiquid
 *
 * Can also be triggered manually with a specific market:
 *   POST /api/cron/dispute-relay { "marketAddress": "0x...", "proposedPrice": 2500000000 }
 */
export async function POST(request: Request) {
  try {
    const config = getRelayerConfig();
    const supabase = getSupabase();
    const body = await request.json().catch(() => ({}));

    // Single-market mode (manual trigger)
    if (body.marketAddress) {
      const result = await relayTick(
        config,
        body.marketAddress,
        BigInt(body.proposedPrice || 0),
        body.pendingAssertionId || undefined,
      );

      if (supabase && (result.action === 'escalated' || result.action === 'uma_resolved')) {
        await persistRelayResult(supabase, result);
      }

      return NextResponse.json({ ok: true, result });
    }

    // Batch mode: scan Supabase for disputed markets
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: 'Supabase not configured' },
        { status: 500 },
      );
    }

    // Find markets that have been challenged but not yet relayed to UMA
    const { data: disputedMarkets, error: fetchErr } = await supabase
      .from('markets')
      .select('id, symbol, market_address, proposed_settlement_value, alternative_settlement_value, settlement_disputed, market_config')
      .eq('settlement_disputed', true)
      .not('market_address', 'is', null);

    if (fetchErr) {
      return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
    }

    const results: RelayTickResult[] = [];

    for (const market of disputedMarkets || []) {
      const marketConfig = (market.market_config as Record<string, any>) || {};
      const pendingAssertionId = marketConfig.uma_assertion_id || undefined;
      const proposedPrice = BigInt(market.proposed_settlement_value || 0);

      const chalEvidence = marketConfig.challenger_evidence as ChallengerEvidence | undefined;

      const settlementDate = marketConfig.expires_at || marketConfig.settlement_requested_at;
      const meta: EscalationMeta = {
        marketName: market.symbol || `Market ${market.market_address.slice(0, 10)}…`,
        settlementDate: settlementDate
          ? new Date(settlementDate as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      };

      const result = await relayTick(
        config,
        market.market_address,
        proposedPrice,
        pendingAssertionId,
        chalEvidence,
        meta,
      );

      results.push(result);

      if (result.action === 'escalated' && result.assertionId) {
        await supabase
          .from('markets')
          .update({
            market_config: {
              ...marketConfig,
              uma_assertion_id: result.assertionId,
              uma_escalated_at: new Date().toISOString(),
              uma_escalation_tx: result.txHash,
            },
          })
          .eq('id', market.id);
      }

      if (result.action === 'uma_resolved') {
        const altPrice = market.alternative_settlement_value as number | null;

        const updatePayload: Record<string, unknown> = {
          market_config: {
            ...marketConfig,
            uma_resolved: true,
            uma_challenger_won: result.challengerWon,
            uma_winning_price: altPrice,
            uma_resolved_at: new Date().toISOString(),
          },
          // Keep settlement_disputed=true — the settlement engine will clear
          // it and call resolveChallenge() on HL once the challenge window expires.
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from('markets')
          .update(updatePayload)
          .eq('id', market.id);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: disputedMarkets?.length || 0,
      results,
    });
  } catch (err: any) {
    console.error('[dispute-relay] Error:', err?.message || err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

async function persistRelayResult(supabase: any, result: RelayTickResult) {
  if (!result.marketAddress) return;

  try {
    if (result.action === 'escalated') {
      console.log(`[dispute-relay] Escalated ${result.marketAddress} → ${result.assertionId}`);
    } else if (result.action === 'uma_resolved') {
      const { data: mkt } = await supabase
        .from('markets')
        .select('id, alternative_settlement_value, market_config')
        .eq('market_address', result.marketAddress)
        .maybeSingle();

      const altPrice = mkt?.alternative_settlement_value as number | null;
      const existingConfig = (mkt?.market_config as Record<string, unknown>) || {};

      await supabase
        .from('markets')
        .update({
          market_config: {
            ...existingConfig,
            uma_resolved: true,
            uma_challenger_won: result.challengerWon,
            uma_winning_price: altPrice,
            uma_resolved_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('market_address', result.marketAddress);

      console.log(
        `[dispute-relay] UMA verdict recorded for ${result.marketAddress}: challengerWon=${result.challengerWon} (on-chain resolution deferred to challenge window expiry)`,
      );
    }
  } catch (err: any) {
    console.error(`[dispute-relay] persistRelayResult error: ${err?.message}`);
  }
}
