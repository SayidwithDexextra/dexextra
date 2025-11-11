import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import path from 'path';
import { archivePage } from '@/lib/archivePage';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
} from '@/lib/contracts';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_save',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

function selectorsFromAbi(abi: any[]): string[] {
  try {
    // Support both string ABIs and JSON ABI fragments
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag) => frag?.type === 'function')
      .map((frag) => ethers.id((frag as any).format('sighash')).slice(0, 10));
  } catch (e: any) {
    try {
      return (abi || [])
        .filter((f: any) => f && typeof f === 'object' && f.type === 'function')
        .map((f: any) => {
          const sig = `${f.name}(${(f.inputs || []).map((i: any) => i.type).join(',')})`;
          return ethers.id(sig).slice(0, 10);
        });
    } catch {
      return [];
    }
  }
}

function loadFacetAbi(contractName: string, fallbackAbi: any[]): any[] {
  try {
    const artifactPath = path.join(
      process.cwd(),
      'Dexetrav5',
      'artifacts',
      'src',
      'diamond',
      'facets',
      `${contractName}.sol`,
      `${contractName}.json`
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const artifact = require(artifactPath);
    if (artifact && Array.isArray(artifact.abi)) return artifact.abi;
  } catch {}
  return fallbackAbi;
}

const DiamondLoupeABI = [
  'function facetAddresses() view returns (address[])',
  'function facets() view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])',
];

function getRpcUrl(): string | null {
  return (
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL ||
    null
  ) as string | null;
}

async function verifyDiamondFacets(marketAddress: string, chainId?: number) {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl || !ethers.isAddress(marketAddress)) {
    return { skipped: true, reason: 'Missing RPC_URL or invalid market address' };
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const loupe = new ethers.Contract(marketAddress, DiamondLoupeABI, provider);

  // Prefer artifact ABIs to avoid selector drift and false duplicates
  const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
  const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
  const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
  const executionAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
  const liquidationAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
  const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
  const settlementAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);

  const expected = {
    admin: new Set(selectorsFromAbi(adminAbi)),
    pricing: new Set(selectorsFromAbi(pricingAbi)),
    placement: new Set(selectorsFromAbi(placementAbi)),
    execution: new Set(selectorsFromAbi(executionAbi)),
    liquidation: new Set(selectorsFromAbi(liquidationAbi)),
    view: new Set(selectorsFromAbi(viewAbi)),
    settlement: new Set(selectorsFromAbi(settlementAbi)),
  } as const;

  // Ensure required groups have non-empty expected selectors
  if (expected.placement.size === 0 || expected.execution.size === 0) {
    logStep('verify_diamond_facets', 'error', {
      reason: 'invalid_expected_abi',
      placementSize: expected.placement.size,
      executionSize: expected.execution.size,
    });
    return { ok: false, error: 'Expected facet ABIs produced no selectors for required groups' };
  }

  try {
    logStep('verify_diamond_facets', 'start', { marketAddress });
    const [facetAddresses, facets] = await Promise.all([
      loupe.facetAddresses().catch(() => []),
      loupe.facets().catch(() => []),
    ]);
    // Log full facets array for diagnostics
    try {
      logStep('loupe_facets', 'success', {
        marketAddress,
        facetAddresses,
        facets,
        facetCount: Array.isArray(facets) ? facets.length : 0,
      });
    } catch {}

    const onchainSelectors = new Set<string>();
    for (const f of facets || []) {
      const sels: string[] = (f?.functionSelectors || []) as any;
      for (const s of sels) onchainSelectors.add(s);
    }

    const requiredGroups = {
      placement: Array.from(expected.placement),
      execution: Array.from(expected.execution),
    } as const;

    const missing: Record<string, string[]> = {};
    for (const [group, sels] of Object.entries(requiredGroups)) {
      const miss = (sels as string[]).filter((s) => !onchainSelectors.has(s));
      if (miss.length) missing[group] = miss;
    }

    const summary = {
      facetCount: Array.isArray(facetAddresses) ? facetAddresses.length : 0,
      selectorsTotal: onchainSelectors.size,
      missingGroups: Object.keys(missing),
      missingCount: Object.values(missing).reduce((a, b) => a + b.length, 0),
    };

    if (summary.missingCount > 0) {
      logStep('verify_diamond_facets', 'error', { ...summary, missing });
    } else {
      logStep('verify_diamond_facets', 'success', summary);
    }

    return { ok: summary.missingCount === 0, ...summary, missing };
  } catch (e: any) {
    logStep('verify_diamond_facets', 'error', { error: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    logStep('request_received', 'start', {
      marketIdentifier: body?.marketIdentifier,
      symbol: body?.symbol,
      networkName: body?.networkName,
      chainId: body?.chainId,
    });
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });

    const {
      marketIdentifier,
      symbol,
      name,
      description,
      category,
      decimals,
      minimumOrderSize,
      requiresKyc,
      settlementDate,
      tradingEndDate,
      dataRequestWindowSeconds,
      autoSettle,
      oracleProvider,
      initialOrder,
      chainId,
      networkName,
      creatorWalletAddress,
      bannerImageUrl,
      iconImageUrl,
      supportingPhotoUrls,
      marketAddress,
      marketIdBytes32,
      transactionHash,
      blockNumber,
      gasUsed,
      aiSourceLocator,
    } = body || {};

    // Attempt to create or resolve a Wayback snapshot for the metric URL (server-side, robust)
    let archivedWaybackUrl: string | null = null;
    let archivedWaybackTs: string | null = null;
    try {
      const metricUrl: string | null = (initialOrder && (initialOrder as any).metricUrl) ? String((initialOrder as any).metricUrl) : null;
      if (metricUrl) {
        const access = process.env.WAYBACK_API_ACCESS_KEY as string | undefined;
        const secret = process.env.WAYBACK_API_SECRET as string | undefined;
        const appUrl = (process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)) as string | undefined;
        const authHeader = access && secret ? `LOW ${access}:${secret}` : undefined;
        const res = await archivePage(metricUrl, {
          captureOutlinks: false,
          captureScreenshot: true,
          skipIfRecentlyArchived: true,
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(appUrl ? { 'User-Agent': `Dexextra/1.0 (+${appUrl})` } : { 'User-Agent': 'Dexextra/1.0' }),
          },
          debug: true,
        });
        if (res?.success && res.waybackUrl) {
          archivedWaybackUrl = String(res.waybackUrl);
          archivedWaybackTs = res.timestamp ? String(res.timestamp) : null;
          logStep('wayback_snapshot', 'success', { waybackUrl: archivedWaybackUrl, timestamp: archivedWaybackTs });
        } else {
          logStep('wayback_snapshot', 'error', { reason: res?.error || 'unknown', metricUrl });
        }
      } else {
        logStep('wayback_snapshot', 'error', { reason: 'missing_metric_url' });
      }
    } catch (e: any) {
      logStep('wayback_snapshot', 'error', { error: e?.message || String(e) });
    }

    let effectiveIdentifier = String(marketIdentifier || symbol || '').toUpperCase();
    if (!effectiveIdentifier) {
      logStep('validate_identifier', 'error', { reason: 'missing_identifier' });
      return NextResponse.json({ error: 'Missing market identifier' }, { status: 400 });
    }
    logStep('validate_identifier', 'success', { effectiveIdentifier });

    logStep('db_lookup', 'start', { effectiveIdentifier });
    const { data: existing, error: findErr } = await supabase
      .from('markets')
      .select('id, network, market_identifier')
      .eq('market_identifier', effectiveIdentifier)
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    logStep('db_lookup', 'success', { found: Boolean(existing) });

    let marketIdUuid = existing?.id || null;
    if (existing && existing.network && networkName && existing.network !== networkName) {
      const suffix = String(networkName).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
      const altIdentifier = `${effectiveIdentifier}-${suffix}`;
      const { data: alt, error: altErr } = await supabase
        .from('markets')
        .select('id')
        .eq('market_identifier', altIdentifier)
        .limit(1)
        .maybeSingle();
      if (altErr) throw altErr;
      if (alt?.id) {
        effectiveIdentifier = altIdentifier;
        marketIdUuid = alt.id;
      } else {
        effectiveIdentifier = altIdentifier;
        marketIdUuid = null;
      }
    }

    // Try to link latest metric_oracle_resolution by metric URL
    let resolutionId: string | null = null;
    try {
      const metricUrl = initialOrder?.metricUrl || null;
      if (metricUrl) {
        const { data: resRow } = await supabase
          .from('metric_oracle_resolutions')
          .select('id, created_at, source_urls')
          .contains('source_urls', [metricUrl])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolutionId = resRow?.id || null;
      }
      logStep('link_resolution', 'success', { hasResolution: Boolean(resolutionId) });
    } catch {
      logStep('link_resolution', 'error');
    }

    const marketConfig = aiSourceLocator ? { ai_source_locator: aiSourceLocator } : null;

    if (!marketIdUuid) {
      logStep('db_insert', 'start', { effectiveIdentifier });
      const insertPayload = {
        market_identifier: effectiveIdentifier,
        symbol,
        name: name || symbol,
        description: description || `OrderBook market for ${symbol}`,
        category: category || (Array.isArray(initialOrder?.tags) && initialOrder.tags[0]) || 'CUSTOM',
        decimals: 6,
        minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
        tick_size: 0.01,
        requires_kyc: Boolean(requiresKyc),
        settlement_date: settlementDate ? new Date(settlementDate * 1000).toISOString() : null,
        trading_end_date: tradingEndDate || null,
        data_request_window_seconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
        auto_settle: autoSettle ?? true,
        oracle_provider: oracleProvider || null,
        initial_order: initialOrder
          ? { ...initialOrder, waybackUrl: archivedWaybackUrl, waybackTimestamp: archivedWaybackTs }
          : (archivedWaybackUrl ? { waybackUrl: archivedWaybackUrl, waybackTimestamp: archivedWaybackTs } : null),
        market_config: {
          ...(marketConfig || {}),
          ...(archivedWaybackUrl ? { wayback_snapshot: { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: (initialOrder as any)?.metricUrl || null } } : {}),
        },
        metric_resolution_id: resolutionId,
        chain_id: chainId,
        network: networkName,
        creator_wallet_address: creatorWalletAddress || null,
        banner_image_url: bannerImageUrl || null,
        icon_image_url: iconImageUrl || null,
        supporting_photo_urls: supportingPhotoUrls || [],
        market_address: marketAddress,
        market_id_bytes32: marketIdBytes32,
        deployment_transaction_hash: transactionHash || null,
        deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
        deployment_gas_used: gasUsed ? Number(gasUsed) : null,
        deployment_status: 'DEPLOYED',
        market_status: 'ACTIVE',
        deployed_at: new Date().toISOString(),
      };
      const { data: inserted, error: insertErr } = await supabase
        .from('markets')
        .insert(insertPayload)
        .select('id')
        .single();
      if (insertErr) throw insertErr;
      marketIdUuid = inserted.id;
      logStep('db_insert', 'success', { marketId: marketIdUuid });
      // Back-link resolution -> market identifier
      try {
        if (resolutionId) {
          await supabase
            .from('metric_oracle_resolutions')
            .update({ related_market_id: effectiveIdentifier })
            .eq('id', resolutionId);
        }
        logStep('backlink_resolution', 'success', { resolutionId });
      } catch {}

    } else {
      logStep('db_update', 'start', { marketId: marketIdUuid });
      const updatePayload = {
        market_address: marketAddress,
        market_id_bytes32: marketIdBytes32,
        chain_id: chainId,
        network: networkName,
        deployment_transaction_hash: transactionHash || null,
        deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
        deployment_gas_used: gasUsed ? Number(gasUsed) : null,
        deployment_status: 'DEPLOYED',
        market_status: 'ACTIVE',
        deployed_at: new Date().toISOString(),
        market_config: {
          ...(marketConfig || {}),
          ...(archivedWaybackUrl ? { wayback_snapshot: { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: (initialOrder as any)?.metricUrl || null } } : {}),
        },
        metric_resolution_id: resolutionId,
      };
      const { error: updErr } = await supabase.from('markets').update(updatePayload).eq('id', marketIdUuid);
      if (updErr) throw updErr;
      logStep('db_update', 'success', { marketId: marketIdUuid });
    }

    // ensure ticker row with initial mark price from startPrice (1e6 precision)
    try {
      logStep('ticker_init', 'start', { marketId: marketIdUuid });
      const startPriceRaw = (initialOrder && (initialOrder as any).startPrice) ?? (body as any)?.startPrice;
      let markPriceScaled = 0;
      if (startPriceRaw != null) {
        const numeric = Number(startPriceRaw);
        if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
          markPriceScaled = Math.round(numeric * 1_000_000);
        }
      }

      await supabase.from('market_tickers').upsert(
        [
          { market_id: marketIdUuid, mark_price: markPriceScaled, last_update: new Date().toISOString(), is_stale: true },
        ],
        { onConflict: 'market_id' }
      );
      logStep('ticker_init', 'success', { marketId: marketIdUuid });
    } catch {
      logStep('ticker_init', 'error', { marketId: marketIdUuid });
    }

    // Optional: verify diamond facets to ensure limit orders are placeable
    try {
      if (marketAddress) {
        const v = await verifyDiamondFacets(marketAddress, Number(chainId) || undefined);
        // attach minimal verification summary to response logs
        logStep('verification_summary', 'success', {
          marketAddress,
          ...(typeof v === 'object' ? v : { ok: false })
        });
      } else {
        logStep('verify_diamond_facets', 'error', { reason: 'missing_marketAddress' });
      }
    } catch {}

    logStep('pipeline_complete', 'success', { marketId: marketIdUuid, effectiveIdentifier });
    return NextResponse.json({ ok: true, id: marketIdUuid });
  } catch (e: any) {
    logStep('pipeline', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Failed to save market' }, { status: 500 });
  }
}


