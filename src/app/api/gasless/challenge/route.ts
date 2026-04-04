import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import { getRelayerConfig, relayTick, type ChallengerEvidence, type EscalationMeta } from '@/lib/dispute-relayer';
import { isChallengeWindowActive } from '@/lib/settlement-window';
import { loadRelayerPoolFromEnv, type RelayerKey } from '@/lib/relayerKeys';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
);

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sessionId,
      trader,
      market_id,
      market_address,
      price,
      evidence_source_url: evidenceSourceRaw,
      evidence_image_url: evidenceImageRaw,
    } = body || {};

    // ── Validate inputs ──
    if (!sessionId || typeof sessionId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid or missing sessionId.' }, { status: 400 });
    }
    if (!trader || !ethers.isAddress(trader)) {
      return NextResponse.json({ error: 'Invalid or missing trader address.' }, { status: 400 });
    }
    if (!market_id) {
      return NextResponse.json({ error: 'Missing market_id.' }, { status: 400 });
    }
    if (!price || Number(price) <= 0 || !Number.isFinite(Number(price))) {
      return NextResponse.json({ error: 'Invalid price. Must be a positive number.' }, { status: 400 });
    }

    const evidenceSourceTrim = typeof evidenceSourceRaw === 'string' ? evidenceSourceRaw.trim() : '';
    const evidenceImageTrim = typeof evidenceImageRaw === 'string' ? evidenceImageRaw.trim() : '';

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
        { error: 'Provide supporting evidence: a valid http(s) source URL and/or an uploaded image URL.' },
        { status: 400 },
      );
    }

    // ── Verify session on-chain ──
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'Server misconfigured: missing RPC_URL.' }, { status: 500 });
    }
    if (!registryAddress || !ethers.isAddress(registryAddress)) {
      return NextResponse.json({ error: 'Server misconfigured: missing SESSION_REGISTRY_ADDRESS.' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const registry = new ethers.Contract(registryAddress, (GlobalSessionRegistry as any).abi, provider);

    let traderOnchain: string;
    try {
      const s = await registry.sessions(sessionId);
      traderOnchain = String(s?.trader || ethers.ZeroAddress);
      const expiryOnchain = Number(s?.expiry || 0);
      const revokedOnchain = Boolean(s?.revoked);
      const now = Math.floor(Date.now() / 1000);

      if (traderOnchain === ethers.ZeroAddress) {
        return NextResponse.json({ error: 'Session not found on-chain.' }, { status: 400 });
      }
      if (traderOnchain.toLowerCase() !== trader.toLowerCase()) {
        return NextResponse.json({ error: 'Session does not belong to this trader.' }, { status: 403 });
      }
      if (revokedOnchain) {
        return NextResponse.json({ error: 'Session has been revoked. Please create a new session.' }, { status: 400 });
      }
      if (expiryOnchain > 0 && now > expiryOnchain) {
        return NextResponse.json({ error: 'Session has expired. Please create a new session.' }, { status: 400 });
      }
    } catch (err: any) {
      console.error('[gasless/challenge] Session verification failed:', err?.message || err);
      return NextResponse.json({ error: 'Failed to verify session on-chain.' }, { status: 500 });
    }

    // ── Load market from Supabase ──
    const { data: market, error: fetchErr } = await supabase
      .from('markets')
      .select('*')
      .eq('id', market_id)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: `Failed to fetch market: ${fetchErr.message}` }, { status: 500 });
    }
    if (!market) {
      return NextResponse.json({ error: 'Market not found.' }, { status: 404 });
    }

    if (!isChallengeWindowActive(market)) {
      return NextResponse.json({ error: 'No active settlement window.' }, { status: 409 });
    }

    const resolvedMarketAddress = market_address || market.market_address;
    if (!resolvedMarketAddress || !ethers.isAddress(resolvedMarketAddress)) {
      return NextResponse.json({ error: 'Market contract address not available.' }, { status: 400 });
    }

    // ── Select relayer wallet (prefer small-block pool for fast inclusion) ──
    // Cascade: dedicated challenge pool → small-block pool → global pool (excluding big-block) → admin key
    let relayerKeys = loadRelayerPoolFromEnv({
      pool: 'challenge',
      jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON',
      allowFallbackSingleKey: false,
    });
    if (!relayerKeys.length) {
      relayerKeys = loadRelayerPoolFromEnv({
        pool: 'hub_trade_small',
        jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON',
        indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_SMALL_',
        allowFallbackSingleKey: false,
      });
    }
    if (!relayerKeys.length) {
      relayerKeys = loadRelayerPoolFromEnv({
        pool: 'global_for_challenge',
        globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
        allowFallbackSingleKey: true,
        excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'],
      });
    }

    const relayerKey = relayerKeys.length > 0
      ? relayerKeys[Math.floor(Math.random() * relayerKeys.length)]
      : undefined;

    const walletKey = relayerKey?.privateKey || process.env.ADMIN_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY || '';
    if (!walletKey) {
      return NextResponse.json({ error: 'Server misconfigured: no challenge relayer key.' }, { status: 500 });
    }

    const relayerWallet = new ethers.Wallet(walletKey, provider);
    const marketContract = new ethers.Contract(
      resolvedMarketAddress,
      MarketLifecycleFacetABI,
      relayerWallet,
    );

    // Ensure the on-chain lifecycle is progressed before challenging.
    // The DB may show the window as active before syncLifecycle has been called.
    try {
      const syncTx = await marketContract.syncLifecycle();
      await syncTx.wait();
    } catch (syncErr: any) {
      console.warn('[gasless/challenge] syncLifecycle warning (non-fatal):', syncErr?.reason || syncErr?.shortMessage || syncErr?.message);
    }

    // Pre-flight: verify the on-chain window is actually open
    try {
      const windowActive = await marketContract.isInSettlementChallengeWindow();
      if (!windowActive) {
        const lifecycleState = await marketContract.getLifecycleState();
        const stateNames = ['Unsettled', 'Rollover', 'ChallengeWindow', 'Settled'];
        const stateName = stateNames[Number(lifecycleState)] ?? `Unknown(${lifecycleState})`;
        console.error(`[gasless/challenge] On-chain window not active. lifecycleState=${stateName}`);
        return NextResponse.json(
          { error: `Challenge window is not active on-chain (state: ${stateName}). Please try again later.` },
          { status: 409 },
        );
      }

      const info = await marketContract.getActiveChallengeInfo();
      if (info.active) {
        return NextResponse.json(
          { error: 'An active challenge already exists for this market.' },
          { status: 409 },
        );
      }
    } catch (checkErr: any) {
      console.warn('[gasless/challenge] Pre-flight check warning:', checkErr?.reason || checkErr?.message);
    }

    const alternativePriceWei = ethers.parseUnits(Number(price).toFixed(6), 6);
    let txHash: string;
    try {
      const tx = await marketContract.challengeSettlementFor(trader, alternativePriceWei, {
        gasLimit: 1_500_000n,
      });
      const receipt = await tx.wait();
      txHash = receipt.hash;
    } catch (txErr: any) {
      const reason = txErr?.reason || txErr?.shortMessage || txErr?.message || 'Transaction failed';
      console.error('[gasless/challenge] On-chain tx failed:', reason);
      return NextResponse.json({ error: reason.length > 200 ? reason.slice(0, 200) : reason }, { status: 500 });
    }

    // ── Update Supabase + trigger UMA escalation (same as regular challenge route) ──
    const now = new Date();
    const existingConfig = (market.market_config || {}) as Record<string, unknown>;
    const priorEvidence = (existingConfig.challenger_evidence as Record<string, unknown> | undefined) || {};
    const evidencePayload = {
      ...priorEvidence,
      ...(sourceOk ? { source_url: evidenceSourceTrim } : {}),
      ...(imageOk ? { image_url: evidenceImageTrim } : {}),
      submitted_at: now.toISOString(),
    };

    const updateData: Record<string, any> = {
      alternative_settlement_value: Number(price),
      alternative_settlement_at: now.toISOString(),
      alternative_settlement_by: trader,
      settlement_disputed: true,
      market_config: { ...existingConfig, challenger_evidence: evidencePayload },
      updated_at: now.toISOString(),
    };

    const { data: updated, error: updateErr } = await supabase
      .from('markets')
      .update(updateData)
      .eq('id', market_id)
      .select()
      .single();

    if (updateErr) {
      console.error('[gasless/challenge] Supabase update failed:', updateErr.message);
      return NextResponse.json(
        { error: `Challenge recorded on-chain (tx: ${txHash}) but database update failed.` },
        { status: 500 },
      );
    }

    // ── Trigger UMA escalation ──
    let umaResult: { uma_assertion_id?: string; uma_escalation_tx?: string; relay_error?: string } = {};
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

      const marketConfig = (market.market_config as Record<string, any>) || {};
      const settlementDateStr = marketConfig.expires_at || marketConfig.settlement_requested_at;
      const meta: EscalationMeta = {
        marketName: market.symbol || `Market ${resolvedMarketAddress.slice(0, 10)}…`,
        settlementDate: settlementDateStr
          ? new Date(settlementDateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      };

      const result = await relayTick(
        config,
        resolvedMarketAddress,
        proposedPrice,
        undefined,
        challengerEvidence,
        meta,
      );

      if (result.action === 'escalated' && result.assertionId) {
        umaResult = {
          uma_assertion_id: result.assertionId,
          uma_escalation_tx: result.txHash,
        };

        const configUpdate = {
          ...updateData.market_config,
          uma_assertion_id: result.assertionId,
          uma_escalated_at: now.toISOString(),
          uma_escalation_tx: result.txHash,
          uma_challenge_tx_hash: txHash,
        };

        await supabase
          .from('markets')
          .update({ market_config: configUpdate, updated_at: now.toISOString() })
          .eq('id', market_id);
      } else if (result.action === 'error') {
        umaResult = { relay_error: result.error };
        console.error('[gasless/challenge] UMA escalation error:', result.error);
      }
    } catch (relayErr: any) {
      umaResult = { relay_error: relayErr?.message || 'Unknown relay error' };
      console.error('[gasless/challenge] UMA relay exception:', relayErr);
    }

    return NextResponse.json({
      success: true,
      txHash,
      market: updated,
      ...umaResult,
    });
  } catch (e: any) {
    console.error('[gasless/challenge] Unhandled error:', e?.message || e);
    return NextResponse.json(
      { error: 'Internal server error', message: e?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
