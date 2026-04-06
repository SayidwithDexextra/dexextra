import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import { getRelayerConfig, relayTick, type ChallengerEvidence, type EscalationMeta } from '@/lib/dispute-relayer';
import { isChallengeWindowActive } from '@/lib/settlement-window';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
);

export const runtime = 'nodejs';
export const maxDuration = 300;

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

    // ── Validate server config early ──
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

    // ── Phase 1: Run independent lookups in parallel ──
    // Session verification + market fetch + relayer pool loading are independent.
    const [sessionResult, marketResult] = await Promise.allSettled([
      registry.sessions(sessionId),
      supabase.from('markets').select('*').eq('id', market_id).maybeSingle(),
    ]);

    // Validate session
    if (sessionResult.status === 'rejected') {
      console.error('[gasless/challenge] Session verification failed:', sessionResult.reason?.message || sessionResult.reason);
      return NextResponse.json({ error: 'Failed to verify session on-chain.' }, { status: 500 });
    }
    const s = sessionResult.value;
    const traderOnchain = String(s?.trader || ethers.ZeroAddress);
    const expiryOnchain = Number(s?.expiry || 0);
    const revokedOnchain = Boolean(s?.revoked);
    const nowSec = Math.floor(Date.now() / 1000);

    if (traderOnchain === ethers.ZeroAddress) {
      return NextResponse.json({ error: 'Session not found on-chain.' }, { status: 400 });
    }
    if (traderOnchain.toLowerCase() !== trader.toLowerCase()) {
      return NextResponse.json({ error: 'Session does not belong to this trader.' }, { status: 403 });
    }
    if (revokedOnchain) {
      return NextResponse.json({ error: 'Session has been revoked. Please create a new session.' }, { status: 400 });
    }
    if (expiryOnchain > 0 && nowSec > expiryOnchain) {
      return NextResponse.json({ error: 'Session has expired. Please create a new session.' }, { status: 400 });
    }

    // Validate market
    if (marketResult.status === 'rejected') {
      return NextResponse.json({ error: `Failed to fetch market: ${marketResult.reason?.message}` }, { status: 500 });
    }
    const { data: market, error: fetchErr } = marketResult.value;
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

    // ── Phase 2: Select relayer — check operators in parallel ──
    let relayerPoolSource = 'none';
    let relayerKeys = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
    if (relayerKeys.length) {
      relayerPoolSource = 'challenge';
    } else {
      relayerKeys = loadRelayerPoolFromEnv({ pool: 'hub_trade_small', jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON', indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_SMALL_', allowFallbackSingleKey: false });
      if (relayerKeys.length) {
        relayerPoolSource = 'hub_trade_small';
      } else {
        relayerKeys = loadRelayerPoolFromEnv({ pool: 'global_for_challenge', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
        if (relayerKeys.length) relayerPoolSource = 'global';
      }
    }

    const adminKey = process.env.ADMIN_PRIVATE_KEY || '';
    const adminAddress = adminKey ? new ethers.Wallet(adminKey).address : 'none';
    console.log(`[gasless/challenge] Relayer pool: source=${relayerPoolSource} candidates=${relayerKeys.length} addresses=[${relayerKeys.map(k => k.address).join(', ')}] adminAddress=${adminAddress}`);

    const operatorCheckContract = new ethers.Contract(
      resolvedMarketAddress,
      ['function isLifecycleOperator(address) external view returns (bool)'],
      provider,
    );

    let selectedKey = '';
    if (relayerKeys.length > 0) {
      const shuffled = [...relayerKeys].sort(() => Math.random() - 0.5);
      const operatorChecks = await Promise.allSettled(
        shuffled.map(async (rk) => {
          const isOp = await operatorCheckContract.isLifecycleOperator(rk.address);
          console.log(`[gasless/challenge] Operator check: ${rk.address} isLifecycleOperator=${isOp}`);
          return { privateKey: rk.privateKey, address: rk.address, isOp };
        }),
      );
      for (const result of operatorChecks) {
        if (result.status === 'fulfilled' && result.value.isOp) {
          selectedKey = result.value.privateKey;
          break;
        }
      }
    }
    if (!selectedKey) selectedKey = adminKey;
    if (!selectedKey) {
      return NextResponse.json({ error: 'Server misconfigured: no challenge relayer or admin key.' }, { status: 500 });
    }

    const challengeWallet = new ethers.Wallet(selectedKey, provider);
    const isAdmin = selectedKey === adminKey;
    console.log(`[gasless/challenge] SELECTED: ${challengeWallet.address} (${isAdmin ? 'ADMIN FALLBACK — no pool operator found' : `operator from ${relayerPoolSource} pool`}) | market=${resolvedMarketAddress} trader=${trader}`);

    const marketContract = new ethers.Contract(
      resolvedMarketAddress,
      MarketLifecycleFacetABI,
      challengeWallet,
    );

    // ── Phase 3: syncLifecycle + advance to ChallengeWindow if needed ──
    try {
      await marketContract.syncLifecycle.staticCall();
      console.log('[gasless/challenge] syncLifecycle needed — sending TX');
      const syncTx = await marketContract.syncLifecycle();
      const syncReceipt = await syncTx.wait();
      console.log(`[gasless/challenge] syncLifecycle confirmed: ${syncReceipt.hash}`);
    } catch (syncErr: any) {
      console.warn('[gasless/challenge] syncLifecycle skipped (already synced or reverted):', syncErr?.reason || syncErr?.shortMessage || syncErr?.message);
    }

    // Check current state — if stuck in Rollover, try to advance to ChallengeWindow
    const stateNames = ['Unsettled', 'Rollover', 'ChallengeWindow', 'Settled'];
    let lifecycleState = Number(await marketContract.getLifecycleState());
    console.log(`[gasless/challenge] Post-sync lifecycle state: ${stateNames[lifecycleState] ?? `Unknown(${lifecycleState})`}`);

    if (lifecycleState === 1) {
      // Rollover — the on-chain challenge window hasn't been opened yet.
      // Check if a settlement price was proposed on-chain; if so, try to
      // explicitly start the challenge window.
      try {
        const [proposedPrice, , proposed] = await marketContract.getProposedSettlementPrice();
        console.log(`[gasless/challenge] On-chain proposal: proposed=${proposed} price=${proposedPrice}`);

        if (proposed) {
          console.log('[gasless/challenge] Settlement proposed on-chain but state is Rollover — calling startSettlementChallengeWindow');
          const startTx = await marketContract.startSettlementChallengeWindow();
          await startTx.wait();
          lifecycleState = Number(await marketContract.getLifecycleState());
          console.log(`[gasless/challenge] After startSettlementChallengeWindow: state=${stateNames[lifecycleState] ?? lifecycleState}`);
        } else {
          // No proposal on-chain — propose it from the DB value
          const dbProposedValue = market.proposed_settlement_value;
          if (dbProposedValue != null && Number(dbProposedValue) > 0) {
            const proposalPriceWei = ethers.parseUnits(Number(dbProposedValue).toFixed(6), 6);
            console.log(`[gasless/challenge] No on-chain proposal — submitting from DB: ${dbProposedValue} (${proposalPriceWei})`);
            const proposeTx = await marketContract.proposeSettlementPrice(proposalPriceWei);
            await proposeTx.wait();
            console.log('[gasless/challenge] Settlement proposed on-chain — calling startSettlementChallengeWindow');
            const startTx = await marketContract.startSettlementChallengeWindow();
            await startTx.wait();
            lifecycleState = Number(await marketContract.getLifecycleState());
            console.log(`[gasless/challenge] After proposal + startChallengeWindow: state=${stateNames[lifecycleState] ?? lifecycleState}`);
          } else {
            console.error('[gasless/challenge] State is Rollover, no on-chain proposal, and no DB proposed value');
          }
        }
      } catch (advanceErr: any) {
        console.error('[gasless/challenge] Failed to advance from Rollover to ChallengeWindow:', advanceErr?.reason || advanceErr?.shortMessage || advanceErr?.message);
      }
    }

    // Pre-flight: verify the challenge window is now open
    try {
      const [windowActive, challengeInfo] = await Promise.all([
        marketContract.isInSettlementChallengeWindow(),
        marketContract.getActiveChallengeInfo(),
      ]);

      if (!windowActive) {
        const currentState = stateNames[lifecycleState] ?? `Unknown(${lifecycleState})`;
        console.error(`[gasless/challenge] On-chain window still not active after recovery attempt. lifecycleState=${currentState}`);
        return NextResponse.json(
          { error: `Challenge window is not active on-chain (state: ${currentState}). The settlement may not have been proposed on-chain yet.` },
          { status: 409 },
        );
      }

      if (challengeInfo.active) {
        return NextResponse.json(
          { error: 'An active challenge already exists for this market.' },
          { status: 409 },
        );
      }
    } catch (checkErr: any) {
      console.warn('[gasless/challenge] Pre-flight check warning:', checkErr?.reason || checkErr?.message);
    }

    // ── Phase 4: Pre-check bond config + submit the challenge transaction ──
    const alternativePriceWei = ethers.parseUnits(Number(price).toFixed(6), 6);

    // Verify bond is configured — auto-repair if missing (deployment may have failed silently)
    try {
      const [bondAmount, slashRecipient] = await marketContract.getChallengeBondConfig();
      if (BigInt(bondAmount) === 0n || slashRecipient === ethers.ZeroAddress) {
        console.warn(`[gasless/challenge] Bond NOT configured on ${resolvedMarketAddress} — auto-repairing`);
        const CHALLENGE_BOND_USDC = 500_000_000;
        const CHALLENGE_SLASH_RECIPIENT = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
        const bondTx = await marketContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, CHALLENGE_SLASH_RECIPIENT);
        await bondTx.wait();
        const [newBond, newSlash] = await marketContract.getChallengeBondConfig();
        console.log(`[gasless/challenge] Bond auto-repaired: bond=${Number(newBond) / 1e6} USDC slash=${newSlash}`);
      } else {
        console.log(`[gasless/challenge] Bond verified: ${Number(bondAmount) / 1e6} USDC`);
      }
    } catch (bondErr: any) {
      console.error('[gasless/challenge] Bond config check/repair failed:', bondErr?.reason || bondErr?.message);
    }

    // Dry-run to surface exact revert reason before spending gas
    try {
      await marketContract.challengeSettlementFor.staticCall(trader, alternativePriceWei);
      console.log('[gasless/challenge] Static call passed — submitting TX');
    } catch (staticErr: any) {
      const staticReason = staticErr?.reason || staticErr?.shortMessage || staticErr?.message || 'Unknown';
      console.error('[gasless/challenge] Static call reverted:', staticReason, {
        wallet: challengeWallet.address,
        trader,
        price: alternativePriceWei.toString(),
        market: resolvedMarketAddress,
      });

      let diagnostics = '';
      try {
        const [bondAmount, slashRecipient] = await marketContract.getChallengeBondConfig();
        const isBondExempt = await marketContract.isProposalBondExempt(trader);
        const vaultContract = new ethers.Contract(
          process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || '',
          ['function getAvailableCollateral(address) external view returns (uint256)'],
          provider,
        );
        let collateral = 'unknown';
        try { collateral = (await vaultContract.getAvailableCollateral(trader)).toString(); } catch {}
        diagnostics = ` | bond=${bondAmount} slashRecipient=${slashRecipient} traderExempt=${isBondExempt} traderCollateral=${collateral}`;
        console.error(`[gasless/challenge] Bond diagnostics:${diagnostics}`);
      } catch {}

      return NextResponse.json({
        error: `Challenge rejected by contract: ${staticReason}${diagnostics}`,
      }, { status: 400 });
    }

    let txHash: string;
    try {
      const tx = await marketContract.challengeSettlementFor(trader, alternativePriceWei, {
        gasLimit: 1_500_000n,
      });
      const receipt = await tx.wait();
      txHash = receipt.hash;
    } catch (txErr: any) {
      let reason = txErr?.reason || txErr?.shortMessage || txErr?.message || 'Transaction failed';
      if (reason.includes('execution reverted') && txErr?.data) {
        const knownErrors: Record<string, string> = {
          '0xbfcafd37': 'NotContractOwner: admin wallet is not the diamond owner',
        };
        const selector = typeof txErr.data === 'string' ? txErr.data.slice(0, 10) : '';
        if (knownErrors[selector]) reason = knownErrors[selector];
      }
      console.error('[gasless/challenge] On-chain tx failed:', reason, { wallet: challengeWallet.address });
      return NextResponse.json({ error: reason.length > 200 ? reason.slice(0, 200) : reason }, { status: 500 });
    }

    // ── Phase 5: Supabase update + UMA escalation in parallel ──
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

    // Run the DB update and UMA escalation concurrently
    const umaEscalationPromise = (async (): Promise<{ uma_assertion_id?: string; uma_escalation_tx?: string; relay_error?: string }> => {
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
          return {
            uma_assertion_id: result.assertionId,
            uma_escalation_tx: result.txHash,
          };
        } else if (result.action === 'error') {
          console.error('[gasless/challenge] UMA escalation error:', result.error);
          return { relay_error: result.error };
        }
        return {};
      } catch (relayErr: any) {
        console.error('[gasless/challenge] UMA relay exception:', relayErr);
        return { relay_error: relayErr?.message || 'Unknown relay error' };
      }
    })();

    const [dbResult, umaResult] = await Promise.allSettled([
      supabase.from('markets').update(updateData).eq('id', market_id).select().single(),
      umaEscalationPromise,
    ]);

    // Process DB result
    if (dbResult.status === 'rejected' || dbResult.value.error) {
      const errMsg = dbResult.status === 'rejected' ? dbResult.reason?.message : dbResult.value.error?.message;
      console.error('[gasless/challenge] Supabase update failed:', errMsg);
      return NextResponse.json(
        { error: `Challenge recorded on-chain (tx: ${txHash}) but database update failed.` },
        { status: 500 },
      );
    }
    const updated = dbResult.value.data;

    // Process UMA result
    const umaData = umaResult.status === 'fulfilled' ? umaResult.value : { relay_error: umaResult.reason?.message || 'UMA escalation failed' };

    // If UMA escalated successfully, persist the assertion ID
    if (umaData.uma_assertion_id) {
      const configUpdate = {
        ...updateData.market_config,
        uma_assertion_id: umaData.uma_assertion_id,
        uma_escalated_at: now.toISOString(),
        uma_escalation_tx: umaData.uma_escalation_tx,
        uma_challenge_tx_hash: txHash,
      };
      await supabase
        .from('markets')
        .update({ market_config: configUpdate, updated_at: now.toISOString() })
        .eq('id', market_id);
    }

    return NextResponse.json({
      success: true,
      txHash,
      market: updated,
      ...umaData,
    });
  } catch (e: any) {
    console.error('[gasless/challenge] Unhandled error:', e?.message || e);
    return NextResponse.json(
      { error: 'Internal server error', message: e?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
