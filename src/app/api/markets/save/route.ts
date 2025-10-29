import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
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
    } = body || {};

    let effectiveIdentifier = String(marketIdentifier || symbol || '').toUpperCase();
    if (!effectiveIdentifier) return NextResponse.json({ error: 'Missing market identifier' }, { status: 400 });

    const { data: existing, error: findErr } = await supabase
      .from('markets')
      .select('id, network, market_identifier')
      .eq('market_identifier', effectiveIdentifier)
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;

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

    if (!marketIdUuid) {
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
        initial_order: initialOrder || null,
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
    } else {
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
      };
      const { error: updErr } = await supabase.from('markets').update(updatePayload).eq('id', marketIdUuid);
      if (updErr) throw updErr;
    }

    // ensure ticker row with initial mark price from startPrice (1e6 precision)
    try {
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
    } catch {}

    return NextResponse.json({ ok: true, id: marketIdUuid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save market' }, { status: 500 });
  }
}


