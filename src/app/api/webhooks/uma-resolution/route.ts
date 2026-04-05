import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/webhooks/uma-resolution
 *
 * Universal webhook endpoint for UMA dispute resolution notifications.
 * Works with both sandbox (SandboxOOv3) and production (real UMA OOv3) environments.
 *
 * Event Sources (all trigger the same flow):
 *   1. DisputeRelay.DisputeResolved - Your relay contract (recommended)
 *   2. SandboxOOv3.AssertionResolved - Test environment
 *   3. UMA OOv3.AssertionSettled - Production UMA (via callback to DisputeRelay)
 *   4. Direct API call with assertion details
 *
 * The DisputeRelay contract is the callback recipient for both sandbox and
 * production UMA. When OOv3 resolves an assertion, it calls:
 *   DisputeRelay.assertionResolvedCallback(assertionId, assertedTruthfully)
 * which emits DisputeResolved that this webhook catches.
 *
 * Setup options:
 *   A. Alchemy/QuickNode webhook watching DisputeRelay for DisputeResolved
 *   B. Alchemy/QuickNode webhook watching OOv3 for AssertionSettled
 *   C. Your own indexer calling this endpoint
 *
 * When a dispute is resolved, this endpoint:
 *   1. Updates Supabase with uma_resolved=true
 *   2. Immediately triggers settlement finalization (bypasses window check)
 *   3. Notifies connected clients via Supabase realtime
 *
 * Request body (direct):
 *   {
 *     "assertionId": "0x...",
 *     "hlMarket": "0x...",
 *     "challengerWon": boolean,
 *     "winningPrice": "123456" (6 decimals),
 *     "txHash": "0x..." (optional),
 *     "blockNumber": 12345 (optional)
 *   }
 *
 * Request body (Alchemy webhook):
 *   {
 *     "event": { "data": { "block": {...}, "logs": [...] } }
 *   }
 */

// DisputeRelay.DisputeResolved(bytes32 indexed assertionId, address indexed hlMarket, bool challengerWon, uint256 winningPrice)
const DISPUTE_RESOLVED_TOPIC = ethers.id('DisputeResolved(bytes32,address,bool,uint256)');

// SandboxOOv3.AssertionResolved(bytes32 indexed assertionId, bool assertedTruthfully)
// Real OOv3 emits similar event - the callback to DisputeRelay is what matters
const ASSERTION_RESOLVED_TOPIC = ethers.id('AssertionResolved(bytes32,bool)');

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface DisputeResolution {
  assertionId: string;
  hlMarket: string;
  challengerWon: boolean;
  winningPrice: bigint;
  txHash?: string;
  blockNumber?: number;
}

function parseAlchemyWebhook(body: any): DisputeResolution[] {
  const resolutions: DisputeResolution[] = [];
  
  try {
    const logs = body?.event?.data?.block?.logs || body?.event?.data?.logs || [];
    
    for (const log of logs) {
      const topic0 = log.topics?.[0];
      
      // Parse DisputeRelay.DisputeResolved event (primary)
      if (topic0 === DISPUTE_RESOLVED_TOPIC) {
        const assertionId = log.topics[1];
        const hlMarket = '0x' + log.topics[2].slice(26);
        
        const iface = new ethers.Interface([
          'event DisputeResolved(bytes32 indexed assertionId, address indexed hlMarket, bool challengerWon, uint256 winningPrice)',
        ]);
        
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (!parsed) continue;
        
        resolutions.push({
          assertionId,
          hlMarket: ethers.getAddress(hlMarket),
          challengerWon: parsed.args.challengerWon,
          winningPrice: parsed.args.winningPrice,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber ? Number(log.blockNumber) : undefined,
        });
        continue;
      }
      
      // Parse SandboxOOv3/OOv3 AssertionResolved event (fallback)
      // This is less useful since it doesn't contain hlMarket, but we can
      // look up the market by assertionId
      if (topic0 === ASSERTION_RESOLVED_TOPIC) {
        const assertionId = log.topics[1];
        
        const iface = new ethers.Interface([
          'event AssertionResolved(bytes32 indexed assertionId, bool assertedTruthfully)',
        ]);
        
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (!parsed) continue;
        
        // assertedTruthfully=true means proposer wins, so challengerWon = !assertedTruthfully
        resolutions.push({
          assertionId,
          hlMarket: '', // Will be looked up by assertionId
          challengerWon: !parsed.args.assertedTruthfully,
          winningPrice: 0n, // Will be determined from DB
          txHash: log.transactionHash,
          blockNumber: log.blockNumber ? Number(log.blockNumber) : undefined,
        });
        continue;
      }
    }
  } catch (err) {
    console.error('[uma-resolution] Failed to parse Alchemy webhook:', err);
  }
  
  return resolutions;
}

function parseDirectPayload(body: any): DisputeResolution | null {
  if (!body.assertionId || body.challengerWon === undefined) {
    return null;
  }
  
  return {
    assertionId: body.assertionId,
    hlMarket: body.hlMarket || body.marketAddress || '',
    challengerWon: Boolean(body.challengerWon),
    winningPrice: BigInt(body.winningPrice || 0),
    txHash: body.txHash,
    blockNumber: body.blockNumber,
  };
}

async function processResolution(
  supabase: ReturnType<typeof getSupabase>,
  resolution: DisputeResolution,
): Promise<{ ok: boolean; marketId?: string; symbol?: string; settled?: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const { assertionId, hlMarket, challengerWon, winningPrice, txHash } = resolution;

  // Find the market by assertion ID or market address
  let query = supabase
    .from('markets')
    .select('id, symbol, market_address, alternative_settlement_value, market_config')
    .limit(1);

  if (assertionId) {
    query = query.or(`market_config->>uma_assertion_id.eq.${assertionId}`);
  }
  if (hlMarket) {
    query = query.or(`market_address.ilike.${hlMarket}`);
  }

  const { data: markets, error: fetchErr } = await query;

  if (fetchErr) {
    console.error('[uma-resolution] Supabase fetch error:', fetchErr.message);
    return { ok: false, error: fetchErr.message };
  }

  if (!markets || markets.length === 0) {
    console.warn('[uma-resolution] No market found for assertion:', assertionId);
    return { ok: false, error: 'Market not found' };
  }

  const market = markets[0];
  const existingConfig = (market.market_config as Record<string, unknown>) || {};

  // Check if already resolved
  if (existingConfig.uma_resolved === true) {
    console.log(`[uma-resolution] Market ${market.symbol} already resolved, skipping`);
    return { ok: true, marketId: market.id, symbol: market.symbol, settled: false };
  }

  const altPrice = market.alternative_settlement_value;
  const resolvedAt = new Date().toISOString();

  const updatedConfig = {
    ...existingConfig,
    uma_resolved: true,
    uma_challenger_won: challengerWon,
    uma_winning_price: challengerWon ? altPrice : null,
    uma_resolved_at: resolvedAt,
    uma_resolution_tx: txHash || null,
  };

  // Update market with UMA resolution
  const { error: updateErr } = await supabase
    .from('markets')
    .update({
      market_config: updatedConfig,
      updated_at: resolvedAt,
    })
    .eq('id', market.id);

  if (updateErr) {
    console.error('[uma-resolution] Supabase update error:', updateErr.message);
    return { ok: false, error: updateErr.message };
  }

  console.log(`[uma-resolution] Updated ${market.symbol}: uma_resolved=true, challengerWon=${challengerWon}`);

  // Trigger immediate settlement finalization
  const settleResult = await triggerSettlement(market.id);

  return {
    ok: true,
    marketId: market.id,
    symbol: market.symbol,
    settled: settleResult.ok,
  };
}

async function triggerSettlement(marketId: string): Promise<{ ok: boolean; error?: string }> {
  const appUrl = process.env.APP_URL || process.env.VERCEL_URL;
  if (!appUrl) {
    console.warn('[uma-resolution] APP_URL not set, cannot trigger settlement');
    return { ok: false, error: 'APP_URL not configured' };
  }

  const baseUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/cron/market-lifecycle`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      headers['Authorization'] = `Bearer ${cronSecret}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'settlement_finalize',
        marketId,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[uma-resolution] Settlement trigger failed (${res.status}):`, data);
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    const result = data.result || data;
    if (result.ok) {
      console.log(`[uma-resolution] Settlement finalized for ${marketId}`);
      return { ok: true };
    } else {
      console.log(`[uma-resolution] Settlement pending for ${marketId}: ${result.reason}`);
      return { ok: false, error: result.reason };
    }
  } catch (err: any) {
    console.error('[uma-resolution] Settlement trigger error:', err?.message);
    return { ok: false, error: err?.message };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = getSupabase();

    // Verify webhook signature if configured (for Alchemy/QuickNode)
    const webhookSecret = process.env.UMA_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = request.headers.get('x-alchemy-signature') 
        || request.headers.get('x-webhook-signature');
      // Add signature verification here if needed
    }

    // Parse the payload - support both direct and Alchemy formats
    let resolutions: DisputeResolution[] = [];

    if (body.event?.data) {
      // Alchemy webhook format
      resolutions = parseAlchemyWebhook(body);
    } else {
      // Direct payload format
      const direct = parseDirectPayload(body);
      if (direct) {
        resolutions = [direct];
      }
    }

    if (resolutions.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No valid DisputeResolved events found' },
        { status: 400 },
      );
    }

    const results = [];
    for (const resolution of resolutions) {
      const result = await processResolution(supabase, resolution);
      results.push(result);
    }

    const anySuccess = results.some((r) => r.ok);
    const anySettled = results.some((r) => r.settled);

    return NextResponse.json({
      ok: anySuccess,
      processed: results.length,
      settled: anySettled,
      results,
    });
  } catch (err: any) {
    console.error('[uma-resolution] Error:', err?.message || err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

// Also support GET for health checks
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'uma-resolution-webhook' });
}
