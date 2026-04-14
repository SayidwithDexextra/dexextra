import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { archiveUrl, type ArchiveResult, type ProviderResult } from '@/lib/archive';
import { getPusherServer } from '@/lib/pusher-server';
import { scheduleMarketLifecycle, proportionalDurations, ONCHAIN_SETTLE_BUFFER_SEC } from '@/lib/qstash-scheduler';
import { suggestCategories } from '@/lib/suggestCategories';

export const runtime = 'nodejs';
export const maxDuration = 60;

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_finalize',
      step, status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function checkpointFinalize(
  supabase: any,
  draftId: string,
  partialFinalize: Record<string, any>,
) {
  if (!supabase || !draftId) return;
  try {
    const { data: draft } = await supabase
      .from('market_drafts')
      .select('pipeline_state')
      .eq('id', draftId)
      .maybeSingle();
    const existing = draft?.pipeline_state || {};
    const merged = { ...(existing.finalize || {}), ...partialFinalize };
    await supabase.from('market_drafts').update({
      pipeline_state: { ...existing, finalize: merged },
    }).eq('id', draftId);
  } catch (e: any) {
    console.warn('[finalize] progressive checkpoint failed', e?.message || String(e));
  }
}

async function archiveWithTimeout(
  url: string,
  opts: {
    userAgent?: string;
  },
  timeoutMs = 8000
): Promise<ArchiveResult> {
  return await Promise.race([
    archiveUrl(url, {
      providerTimeoutMs: timeoutMs - 500,
      totalTimeoutMs: timeoutMs,
      userAgent: opts.userAgent,
    }),
    new Promise<ArchiveResult>((resolve) =>
      setTimeout(() => resolve({ success: false, archives: [], error: 'timeout' }), timeoutMs)
    ),
  ]);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const draftId = typeof body?.draftId === 'string' ? String(body.draftId) : '';
    const pipelineId = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const orderBook = typeof body?.orderBook === 'string' ? String(body.orderBook) : '';
    const marketIdBytes32 = typeof body?.marketId === 'string' ? String(body.marketId) : '';
    const transactionHash = typeof body?.transactionHash === 'string' ? String(body.transactionHash) : '';
    const blockNumber = typeof body?.blockNumber === 'number' ? body.blockNumber : null;
    const chainId = typeof body?.chainId === 'number' ? body.chainId : null;
    const gasUsed = typeof body?.gasUsed === 'number' ? body.gasUsed : null;

    const symbol = String(body?.symbol || '').trim().toUpperCase();
    const metricUrl = String(body?.metricUrl || '').trim();
    let startPrice = String(body?.startPrice || '1');
    const dataSource = String(body?.dataSource || 'User Provided');
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t: any) => String(t)) : [];
    const providedName = typeof body?.name === 'string' ? String(body.name).trim() : '';
    const providedDescription = typeof body?.description === 'string' ? String(body.description).trim() : '';
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? String(body.creatorWalletAddress).toLowerCase() : null;
    let iconImageUrl = body?.iconImageUrl ? String(body.iconImageUrl).trim() : null;
    let bannerImageUrl = body?.bannerImageUrl ? String(body.bannerImageUrl).trim() : null;
    const aiSourceLocator = body?.aiSourceLocator || null;
    const isRollover = body?.isRollover === true;
    const parentMarketId = isRollover && typeof body?.parentMarketId === 'string' ? body.parentMarketId : null;
    const parentMarketAddress = isRollover && typeof body?.parentMarketAddress === 'string' ? body.parentMarketAddress : null;

    if (isRollover && parentMarketId) {
      try {
        const earlySupabase = getSupabase();
        if (earlySupabase) {
          if (!iconImageUrl || !bannerImageUrl) {
            const { data: parentRow } = await earlySupabase.from('markets').select('icon_image_url, banner_image_url').eq('id', parentMarketId).maybeSingle();
            if (parentRow) {
              if (!iconImageUrl) iconImageUrl = parentRow.icon_image_url || null;
              if (!bannerImageUrl) bannerImageUrl = parentRow.banner_image_url || null;
            }
          }
          const { data: parentTicker } = await earlySupabase
            .from('market_tickers')
            .select('mark_price')
            .eq('market_id', parentMarketId)
            .maybeSingle();
          if (parentTicker?.mark_price && parentTicker.mark_price > 0) {
            startPrice = String(parentTicker.mark_price / 1_000_000);
          }
        }
      } catch {}
    }
    const feeRecipient = (body?.feeRecipient && ethers.isAddress(body.feeRecipient)) ? body.feeRecipient : null;
    const speedRunConfig = (body?.speedRunConfig && typeof body.speedRunConfig === 'object')
      ? {
          rolloverLeadSeconds: Number(body.speedRunConfig.rolloverLeadSeconds) || 0,
          challengeWindowSeconds: Number(body.speedRunConfig.challengeWindowSeconds) || 0,
        }
      : null;

    if (!body?.settlementDate || typeof body.settlementDate !== 'number' || body.settlementDate <= 0) {
      return NextResponse.json({ error: 'settlementDate is required' }, { status: 400 });
    }
    const settlementTs = Math.floor(body.settlementDate);

    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'Valid orderBook address is required' }, { status: 400 });
    }
    if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

    const pusher = pipelineId ? getPusherServer() : null;
    const pusherChannel = pipelineId ? `deploy-${pipelineId}` : '';
    const logS = (step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) => {
      logStep(step, status, data);
      if (pusher && pusherChannel) {
        try {
          (pusher as any)['pusher'].trigger(pusherChannel, 'progress', {
            step, status, data: data || {}, timestamp: new Date().toISOString(),
          });
        } catch {}
      }
    };

    const supabase = getSupabase();
    if (!supabase) {
      logS('save_market', 'error', { error: 'Supabase not configured' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Checkpoint: finalizing
    if (draftId) {
      try {
        await supabase.from('market_drafts').update({ pipeline_stage: 'finalizing' }).eq('id', draftId);
      } catch {}
    }

    logS('save_market', 'start');

    // Multi-archive (belt and suspenders: Internet Archive + Archive.today)
    let archivedWaybackUrl: string | null = null;
    let archivedWaybackTs: string | null = null;
    let archiveSnapshots: Array<{
      provider: 'internet_archive' | 'archive_today';
      url: string;
      timestamp?: string;
      success: boolean;
    }> = [];
    let primaryArchiveUrl: string | null = null;
    let primaryArchiveProvider: 'internet_archive' | 'archive_today' | null = null;

    try {
      const archiveRes = await archiveWithTimeout(metricUrl, {
        userAgent: `Dexextra/1.0 (+${process.env.APP_URL || 'http://localhost:3000'})`,
      }, 8000);

      if (archiveRes?.success) {
        primaryArchiveUrl = archiveRes.primaryUrl || null;
        primaryArchiveProvider = archiveRes.primaryProvider || null;
        
        // Convert to storage format
        archiveSnapshots = archiveRes.archives
          .filter((a: ProviderResult) => a.success && a.url)
          .map((a: ProviderResult) => ({
            provider: a.provider,
            url: a.url!,
            timestamp: a.timestamp,
            success: true,
          }));

        // For backward compatibility, also set wayback_url if IA succeeded
        const iaResult = archiveRes.archives.find(
          (a: ProviderResult) => a.provider === 'internet_archive' && a.success
        );
        if (iaResult?.url) {
          archivedWaybackUrl = iaResult.url;
          archivedWaybackTs = iaResult.timestamp || null;
        } else if (primaryArchiveUrl) {
          // Fallback to primary if IA failed
          archivedWaybackUrl = primaryArchiveUrl;
        }

        logS('archive_multi', 'success', {
          providers: archiveSnapshots.map((s) => s.provider),
          primaryProvider: primaryArchiveProvider,
          timeToFirstMs: archiveRes.timeToFirstSuccessMs,
        });
      } else {
        logS('archive_multi', 'error', { error: archiveRes?.error || 'All providers failed' });
      }
    } catch (e: any) {
      console.warn('[finalize] Multi-archive error', e?.message || String(e));
      logS('archive_multi', 'error', { error: e?.message || String(e) });
    }

    await checkpointFinalize(supabase, draftId, {
      wayback_url: archivedWaybackUrl,
      wayback_ts: archivedWaybackTs,
      archive_snapshots: archiveSnapshots,
      primary_archive_url: primaryArchiveUrl,
      primary_archive_provider: primaryArchiveProvider,
    });

    const derivedName = `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`;
    const networkNameRaw = String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || '');
    const safeName = (providedName || derivedName).slice(0, 100);
    const safeDescription = (providedDescription || `OrderBook market for ${symbol}`).slice(0, 280);
    const ownerAddress = process.env.ADMIN_PRIVATE_KEY
      ? new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY).address
      : null;

    let resolvedCategory: string[];
    if (Array.isArray(tags) && tags.length) {
      resolvedCategory = tags;
    } else {
      try {
        logS('ai_category_suggest', 'start');
        resolvedCategory = await suggestCategories(safeName, safeDescription, { timeoutMs: 5000 });
        logS('ai_category_suggest', 'success', { categories: resolvedCategory });
      } catch (e: any) {
        logS('ai_category_suggest', 'error', { error: e?.message || String(e) });
        resolvedCategory = ['Custom'];
      }
    }

    const insertPayload: any = {
      market_identifier: symbol,
      symbol,
      name: safeName,
      description: safeDescription,
      category: resolvedCategory,
      decimals: 6,
      minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
      tick_size: Number(process.env.DEFAULT_TICK_SIZE || 0.01),
      requires_kyc: false,
      settlement_date: new Date(settlementTs * 1000).toISOString(),
      trading_end_date: null,
      data_request_window_seconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
      auto_settle: true,
      oracle_provider: null,
      initial_order: {
        metricUrl, startPrice: String(startPrice), dataSource, tags,
        waybackUrl: archivedWaybackUrl || null,
        waybackTimestamp: archivedWaybackTs || null,
      },
      market_config: {
        wayback_snapshot: archivedWaybackUrl
          ? { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: metricUrl }
          : null,
        archive_snapshots: archiveSnapshots.length > 0 ? {
          snapshots: archiveSnapshots,
          primary_url: primaryArchiveUrl,
          primary_provider: primaryArchiveProvider,
          source_url: metricUrl,
          archived_at: new Date().toISOString(),
        } : null,
        ...(isRollover ? {
          rollover_lineage: {
            parent_market_id: parentMarketId,
            parent_market_address: parentMarketAddress,
            rolled_over_at: new Date().toISOString(),
          },
        } : {}),
        ...(speedRunConfig ? {
          speed_run: true,
          challenge_window_seconds: speedRunConfig.challengeWindowSeconds,
          rollover_lead_seconds: speedRunConfig.rolloverLeadSeconds,
        } : {}),
      },
      ai_source_locator: aiSourceLocator
        ? { url: aiSourceLocator.url || aiSourceLocator.primary_source_url || '', selectors: [], discovered_at: new Date().toISOString(), last_successful_at: null, success_count: 0, failure_count: 0, version: 1 }
        : null,
      chain_id: chainId,
      network: networkNameRaw.length > 50 ? networkNameRaw.slice(0, 50) : networkNameRaw,
      creator_wallet_address: creatorWalletAddress,
      banner_image_url: bannerImageUrl || iconImageUrl || null,
      icon_image_url: iconImageUrl,
      supporting_photo_urls: [],
      market_address: orderBook,
      market_id_bytes32: marketIdBytes32 || null,
      deployment_transaction_hash: transactionHash || null,
      deployment_block_number: blockNumber,
      deployment_gas_used: gasUsed,
      deployment_status: 'DEPLOYED',
      market_status: 'ACTIVE',
      deployed_at: new Date().toISOString(),
    };

    let savedRow: any = null;
    let savedMarketConfig: any = insertPayload.market_config || {};

    let { data: dbRow, error: saveErr } = isRollover
      ? await supabase.from('markets').insert([insertPayload]).select('id').limit(1).maybeSingle()
      : await supabase.from('markets').upsert([insertPayload], { onConflict: 'market_identifier' }).select('id').limit(1).maybeSingle();

    savedRow = dbRow;

    if (saveErr) {
      const rawMsg = String(saveErr?.message || saveErr || '');
      const isSettlementPastConstraint =
        rawMsg.includes('settlement_date_future_for_active') ||
        (rawMsg.includes('check constraint') && rawMsg.toLowerCase().includes('settlement_date') && rawMsg.toLowerCase().includes('active'));

      if (isSettlementPastConstraint) {
        const nowIso = new Date().toISOString();
        const fallbackPayload: any = {
          ...insertPayload,
          market_status: 'SETTLEMENT_REQUESTED',
          proposed_settlement_at: nowIso,
          proposed_settlement_by: 'SYSTEM_BACKFILL',
          market_config: {
            ...(insertPayload.market_config || {}),
            settlement_scheduler: {
              stage: 'window_started_backfill',
              started_at: nowIso, expires_at: nowIso,
              reason: 'save_after_settlement_date_constraint',
            },
          },
          updated_at: nowIso,
        };
        const fallback = isRollover
          ? await supabase.from('markets').insert([fallbackPayload]).select('id').limit(1).maybeSingle()
          : await supabase.from('markets').upsert([fallbackPayload], { onConflict: 'market_identifier' }).select('id').limit(1).maybeSingle();
        if (fallback.error) {
          throw new Error(`primary save failed: ${rawMsg}; fallback: ${String(fallback.error?.message || fallback.error)}`);
        }
        savedRow = fallback.data;
        saveErr = null;
      } else {
        throw saveErr;
      }
    }

    await checkpointFinalize(supabase, draftId, {
      market_uuid: savedRow?.id || null,
      market_saved: true,
      market_saved_at: new Date().toISOString(),
    });

    // Upsert ticker row — sanitize startPrice (strip currency symbols, commas, whitespace)
    const markPriceScaled = (() => {
      const cleaned = String(startPrice).trim().replace(/,/g, '').replace(/[^0-9.\-]/g, '');
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.round(n * 1_000_000);
    })();
    try {
      if (savedRow?.id) {
        await supabase.from('market_tickers').upsert(
          [{ market_id: savedRow.id, mark_price: markPriceScaled, last_update: new Date().toISOString(), is_stale: true }],
          { onConflict: 'market_id' }
        );
      }
    } catch {}

    await checkpointFinalize(supabase, draftId, { ticker_created: true });

    // Schedule QStash lifecycle triggers
    let qstashIds: Record<string, string | undefined> = {};
    if (savedRow?.id && settlementTs > Math.floor(Date.now() / 1000)) {
      try {
        const scheduledNow = Math.floor(Date.now() / 1000);
        const marketDuration = Math.max(1, settlementTs - scheduledNow);
        const proportional = proportionalDurations(marketDuration);
        const rolloverLead = speedRunConfig?.rolloverLeadSeconds ?? proportional.rolloverLead;
        const challengeWindow = speedRunConfig?.challengeWindowSeconds ?? proportional.challengeWindow;

        const scheduleIds = await scheduleMarketLifecycle(savedRow.id, settlementTs, {
          marketAddress: orderBook,
          symbol,
          ...(speedRunConfig ? {
            rolloverLeadSeconds: speedRunConfig.rolloverLeadSeconds,
            challengeWindowSeconds: speedRunConfig.challengeWindowSeconds,
          } : {}),
        });
        qstashIds = scheduleIds;
        logS('qstash_schedule', 'success', { scheduleIds });

        try {
          await supabase.from('markets').update({
            qstash_schedule_ids: scheduleIds,
            market_config: {
              ...(typeof savedMarketConfig === 'object' ? savedMarketConfig : {}),
              qstash_lifecycle: {
                schedule_ids: scheduleIds,
                rollover_trigger_at: settlementTs - rolloverLead,
                challenge_open_at: settlementTs,
                settlement_trigger_at: settlementTs,
                finalize_trigger_at: settlementTs + challengeWindow + ONCHAIN_SETTLE_BUFFER_SEC,
                scheduled_at: scheduledNow,
              },
            },
          }).eq('id', savedRow.id);
        } catch (e: any) {
          logS('qstash_lifecycle_persist', 'error', { error: e?.message || String(e) });
        }
      } catch (e: any) {
        logS('qstash_schedule', 'error', { error: e?.message || String(e) });
      }
    }

    await checkpointFinalize(supabase, draftId, {
      qstash_ids: qstashIds,
      qstash_scheduled: Object.keys(qstashIds).length > 0,
    });

    // Rollover finalization
    if (isRollover && savedRow?.id) {
      const rolloverSeriesId = typeof body?.seriesId === 'string' ? body.seriesId : null;
      const rolloverChildSeq = typeof body?.childSequence === 'number' ? body.childSequence : null;

      if (rolloverSeriesId && rolloverChildSeq != null) {
        try {
          await supabase.from('markets').update({
            series_id: rolloverSeriesId,
            series_sequence: rolloverChildSeq,
            updated_at: new Date().toISOString(),
          }).eq('id', savedRow.id);
        } catch (e: any) {
          logS('rollover_series_child', 'error', { error: e?.message || String(e) });
        }
      }

      if (parentMarketId) {
        try {
          const { data: parentRow } = await supabase.from('markets').select('market_config').eq('id', parentMarketId).maybeSingle();
          const existingCfg = (typeof parentRow?.market_config === 'object' && parentRow?.market_config) || {};
          await supabase.from('markets').update({
            market_config: {
              ...(existingCfg as any),
              rollover: {
                child_market_id: savedRow.id,
                child_address: orderBook,
                child_settlement_date: new Date(settlementTs * 1000).toISOString(),
                rolled_over_at: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          }).eq('id', parentMarketId);
        } catch (e: any) {
          logS('rollover_update_parent', 'error', { error: e?.message || String(e) });
        }
      }

      if (parentMarketAddress && orderBook) {
        try {
          const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
          const pk = process.env.ADMIN_PRIVATE_KEY;
          if (rpcUrl && pk) {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const wallet = new ethers.Wallet(pk, provider);
            const lifecycleAbi = ['function linkRolloverChildByAddress(address,uint256) external'];
            const parentContract = new ethers.Contract(parentMarketAddress, lifecycleAbi, wallet);
            const linkTx = await parentContract.linkRolloverChildByAddress(orderBook, settlementTs);
            const linkRc = await linkTx.wait();
            logS('rollover_link_onchain', 'success', { tx: linkRc?.hash || linkTx.hash });
          }
        } catch (e: any) {
          logS('rollover_link_onchain', 'error', { error: e?.message || String(e) });
        }
      }
    }

    logS('save_market', 'success');

    // Mark draft completed
    if (draftId) {
      try {
        const { data: draft } = await supabase
          .from('market_drafts')
          .select('pipeline_state')
          .eq('id', draftId)
          .maybeSingle();
        const existing = draft?.pipeline_state || {};
        await supabase.from('market_drafts').update({
          pipeline_stage: 'finalized',
          status: 'completed',
          market_id: savedRow?.id || null,
          pipeline_state: {
            ...existing,
            finalize: {
              market_uuid: savedRow?.id || null,
              qstash_ids: qstashIds,
              wayback_url: archivedWaybackUrl,
              completed_at: new Date().toISOString(),
            },
          },
        }).eq('id', draftId);
      } catch (e: any) {
        console.warn('[finalize] draft checkpoint failed', e?.message || String(e));
      }
    }

    return NextResponse.json({
      ok: true,
      symbol,
      orderBook,
      marketId: savedRow?.id || marketIdBytes32,
      transactionHash,
      feeRecipient: feeRecipient || creatorWalletAddress || ownerAddress,
      waybackUrl: archivedWaybackUrl,
      draftId,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({
      error: 'Finalize failed',
      details: e?.message || String(e),
      orderBook: (await req.json().catch(() => ({})) as any)?.orderBook,
    }, { status: 500 });
  }
}
