import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { archivePage } from '@/lib/archivePage';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  CoreVaultABI,
} from '@/lib/contracts';

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_create',
      step,
      status,
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

function selectorsFromAbi(abi: any[]): string[] {
  try {
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

async function getTxOverrides(provider: ethers.Provider) {
  try {
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('2', 'gwei');
    const minMax = ethers.parseUnits('20', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('10', 'gwei');
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits('20', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('20', 'gwei') } as const;
  }
}

async function createNonceManager(signer: ethers.Wallet) {
  const address = await signer.getAddress();
  let next = await signer.provider!.getTransactionCount(address, 'pending');
  return {
    async nextOverrides() {
      const fee = await getTxOverrides(signer.provider!);
      const ov: any = { ...fee, nonce: next };
      next += 1;
      return ov;
    }
  } as const;
}

function extractError(e: any) {
  try {
    return (
      e?.shortMessage ||
      e?.reason ||
      e?.error?.message ||
      (typeof e?.data === 'string' ? e.data : undefined) ||
      (typeof e?.info?.error?.data === 'string' ? e.info.error.data : undefined) ||
      e?.message ||
      String(e)
    );
  } catch {
    return String(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawSymbol = String(body?.symbol || '').trim();
    const symbol = rawSymbol.toUpperCase();
    const metricUrl = String(body?.metricUrl || '').trim();
    const startPrice = String(body?.startPrice || '1');
    const dataSource = String(body?.dataSource || 'User Provided');
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t: any) => String(t)) : [];
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? body.creatorWalletAddress : null;
    const iconImageUrl = body?.iconImageUrl ? String(body.iconImageUrl).trim() : null;
    const aiSourceLocator = body?.aiSourceLocator || null;
    const settlementTs = typeof body?.settlementDate === 'number' && body.settlementDate > 0
      ? Math.floor(body.settlementDate)
      : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    logStep('validate_input', 'start');
    if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    if (!metricUrl) return NextResponse.json({ error: 'Metric URL is required' }, { status: 400 });
    logStep('validate_input', 'success');

    // Env configuration
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY || process.env.ROLE_ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
    const initFacet = process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;
    const adminFacet = process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
    const pricingFacet = process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
    const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
    const execFacet = process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
    const liqFacet = process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
    const viewFacet = process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
    const settleFacet = process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
    const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'Deployer private key not configured' }, { status: 400 });
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) return NextResponse.json({ error: 'Factory address not configured' }, { status: 400 });
    if (!initFacet || !ethers.isAddress(initFacet)) return NextResponse.json({ error: 'Init facet address not configured' }, { status: 400 });
    if (!adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet) {
      return NextResponse.json({ error: 'One or more facet addresses are missing' }, { status: 400 });
    }
    if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    // Provider and signer
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const nonceMgr = await createNonceManager(wallet);
    const ownerAddress = await wallet.getAddress();
    logStep('wallet_ready', 'success', { ownerAddress });

    // Load ABIs (prefer compiled artifacts to prevent selector drift)
    const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
    const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
    const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
    const execAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
    const liqAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
    const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
    const settleAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);

    const cut = [
      { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(adminAbi) },
      { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(pricingAbi) },
      { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(placementAbi) },
      { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(execAbi) },
      { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(liqAbi) },
      { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(viewAbi) },
      { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(settleAbi) },
    ];
  try {
    const cutSummary = cut.map((c) => ({ facetAddress: c.facetAddress, selectorCount: (c.functionSelectors || []).length }));
    logStep('facet_cut_built', 'success', { cutSummary, cut });
  } catch {}
    const emptyFacets = cut.filter(c => !c.functionSelectors?.length).map(c => c.facetAddress);
    if (emptyFacets.length) {
      return NextResponse.json({ error: 'Facet selectors could not be built', emptyFacets }, { status: 500 });
    }
    const cutArg = cut.map((c) => [c.facetAddress, 0, c.functionSelectors]);

    // Resolve factory
    const factoryArtifact = await import('@/lib/abis/FuturesMarketFactory.json');
    const factoryAbi = (factoryArtifact as any)?.default?.abi || (factoryArtifact as any)?.abi || (factoryArtifact as any)?.default || (factoryArtifact as any);
    const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);

    // Params
    const startPrice6 = ethers.parseUnits(startPrice, 6);
    const feeRecipient = (body?.feeRecipient && ethers.isAddress(body.feeRecipient)) ? body.feeRecipient : (creatorWalletAddress || ownerAddress);

    // Preflight bytecode checks
    try {
      const [factoryCode, initCode, ...facetCodes] = await Promise.all([
        provider.getCode(factoryAddress),
        provider.getCode(initFacet),
        ...cutArg.map((c: any) => provider.getCode(c?.[0]))
      ]);
      const noFactory = !factoryCode || factoryCode === '0x' || factoryCode === '0x0';
      const noInit = !initCode || initCode === '0x' || initCode === '0x0';
      const badFacets = facetCodes.reduce((acc: number[], code: string, idx: number) => { if (!code || code === '0x' || code === '0x0') acc.push(idx); return acc; }, []);
      if (noFactory || noInit || badFacets.length) {
        return NextResponse.json({ error: 'One or more contract addresses have no bytecode', details: { noFactory, noInit, badFacets } }, { status: 400 });
      }
    } catch {}

    // Static call for revert reasons
    logStep('factory_static_call', 'start');
    try {
      await factory.getFunction('createFuturesMarketDiamond').staticCall(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        ownerAddress,
        cutArg,
        initFacet,
        '0x'
      );
      logStep('factory_static_call', 'success');
    } catch (e: any) {
      const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed (no reason)';
      const hint = 'Possible causes: public creation disabled; creation fee required without sufficient CoreVault balance for the Deployer; invalid facet/addresses; or network mismatch.';
      const msg = `${raw}`;
      logStep('factory_static_call', 'error', { error: msg, code: e?.code, hint });
      return NextResponse.json({ error: msg, hint }, { status: 400 });
    }

    // Send tx
    logStep('factory_send_tx', 'start');
    const overrides = await nonceMgr.nextOverrides();
    logStep('factory_send_tx_prep', 'success', { nonce: (overrides as any)?.nonce, ...('maxFeePerGas' in overrides ? { maxFeePerGas: (overrides as any).maxFeePerGas?.toString?.() } : {}), ...('maxPriorityFeePerGas' in overrides ? { maxPriorityFeePerGas: (overrides as any).maxPriorityFeePerGas?.toString?.() } : {}), ...('gasPrice' in overrides ? { gasPrice: (overrides as any).gasPrice?.toString?.() } : {}) });
    const tx = await factory.getFunction('createFuturesMarketDiamond')(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      ownerAddress,
      cutArg,
      initFacet,
      '0x',
      overrides as any
    );
    logStep('factory_send_tx_sent', 'success', { hash: tx.hash, nonce: (tx as any)?.nonce });

    // Confirm
    logStep('factory_confirm', 'start');
    const receipt = await tx.wait();
    logStep('factory_confirm_mined', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });

    // Parse event
    const iface = new ethers.Interface(factoryAbi);
    let orderBook: string | null = null;
    let marketId: string | null = null;
    for (const log of (receipt as any).logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'FuturesMarketCreated') {
          orderBook = parsed.args?.orderBook as string;
          marketId = parsed.args?.marketId as string;
          break;
        }
      } catch {}
    }
    if (!orderBook || !marketId) return NextResponse.json({ error: 'Could not parse created market' }, { status: 500 });

  // Ensure required placement selectors exist on the Diamond (defensive)
  try {
    logStep('ensure_selectors', 'start', { orderBook });
    const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
    const CutABI = [
      'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
    ];
    const loupe = new ethers.Contract(orderBook, LoupeABI, wallet);
    const diamondCut = new ethers.Contract(orderBook, CutABI, wallet);
    const placementSigs = [
      'placeLimitOrder(uint256,uint256,bool)',
      'placeMarginLimitOrder(uint256,uint256,bool)',
      'placeMarketOrder(uint256,bool)',
      'placeMarginMarketOrder(uint256,bool)',
      'placeMarketOrderWithSlippage(uint256,bool,uint256)',
      'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)',
      'cancelOrder(uint256)',
    ];
    const requiredSelectors = placementSigs.map((sig) => ethers.id(sig).slice(0, 10));
    const missing: string[] = [];
    for (const sel of requiredSelectors) {
      try {
        const addr: string = await loupe.facetAddress(sel);
        if (!addr || addr.toLowerCase() === '0x0000000000000000000000000000000000000000') {
          missing.push(sel);
        }
      } catch {
        missing.push(sel);
      }
    }
    if (missing.length > 0) {
      logStep('ensure_selectors_missing', 'start', { missingCount: missing.length });
      const cut = [{ facetAddress: placementFacet, action: 0, functionSelectors: missing }];
      const ov = await nonceMgr.nextOverrides();
      const txCut = await diamondCut.diamondCut(cut as any, ethers.ZeroAddress, '0x', ov as any);
      logStep('ensure_selectors_diamondCut_sent', 'success', { tx: txCut.hash });
      await txCut.wait();
      logStep('ensure_selectors_diamondCut_mined', 'success');
    } else {
      logStep('ensure_selectors', 'success', { message: 'All placement selectors present' });
    }
  } catch (e: any) {
    logStep('ensure_selectors', 'error', { error: e?.message || String(e) });
  }

    // Grant roles on CoreVault
    logStep('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
    try {
      const ov1 = await nonceMgr.nextOverrides();
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
      logStep('grant_ORDERBOOK_ROLE_sent', 'success', { tx: tx1.hash, nonce: (tx1 as any)?.nonce });
      const r1 = await tx1.wait();
      logStep('grant_ORDERBOOK_ROLE_mined', 'success', { tx: r1?.hash || tx1.hash, blockNumber: r1?.blockNumber });
      const ov2 = await nonceMgr.nextOverrides();
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
      logStep('grant_SETTLEMENT_ROLE_sent', 'success', { tx: tx2.hash, nonce: (tx2 as any)?.nonce });
      const r2 = await tx2.wait();
      logStep('grant_SETTLEMENT_ROLE_mined', 'success', { tx: r2?.hash || tx2.hash, blockNumber: r2?.blockNumber });
      logStep('grant_roles', 'success');
    } catch (e: any) {
      logStep('grant_roles', 'error', { error: extractError(e) });
      return NextResponse.json({ error: 'Admin role grant failed', details: extractError(e) }, { status: 500 });
    }

    // Configure trading parameters
    logStep('configure_market', 'start');
    try {
      const obAdmin = new ethers.Contract(orderBook, OBAdminFacetABI as any, wallet);
      const ovA = await nonceMgr.nextOverrides();
      const txA = await obAdmin.updateTradingParameters(10000, 0, feeRecipient, ovA);
      logStep('ob_updateTradingParameters_sent', 'success', { tx: txA.hash, nonce: (txA as any)?.nonce });
      const rcA = await txA.wait();
      logStep('ob_updateTradingParameters_mined', 'success', { tx: rcA?.hash || txA.hash, blockNumber: rcA?.blockNumber });
      const ovB = await nonceMgr.nextOverrides();
      const txB = await obAdmin.disableLeverage(ovB);
      logStep('ob_disableLeverage_sent', 'success', { tx: txB.hash, nonce: (txB as any)?.nonce });
      const rcB = await txB.wait();
      logStep('ob_disableLeverage_mined', 'success', { tx: rcB?.hash || txB.hash, blockNumber: rcB?.blockNumber });
      logStep('configure_market', 'success', { feeRecipient });
    } catch (e: any) {
      // Non-fatal; continue
      logStep('configure_market', 'error', { error: extractError(e) });
    }

    // Save to Supabase
    let archivedWaybackUrl: string | null = null;
    let archivedWaybackTs: string | null = null;
    logStep('save_market', 'start');
    try {
      const supabase = getSupabase();
      // Attempt to archive the metric URL via SavePageNow (server-side, authenticated if keys exist)
      if (supabase) {
        const network = await provider.getNetwork();
        try {
          const access = process.env.WAYBACK_API_ACCESS_KEY as string | undefined;
          const secret = process.env.WAYBACK_API_SECRET as string | undefined;
          const authHeader = access && secret ? `LOW ${access}:${secret}` : undefined;
          const archiveRes = await archivePage(metricUrl, {
            captureOutlinks: false,
            captureScreenshot: true,
            skipIfRecentlyArchived: true,
            headers: {
              ...(authHeader ? { Authorization: authHeader } : {}),
              'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'http://localhost:3000'})`,
            },
          });
          if (archiveRes?.success && archiveRes.waybackUrl) {
            archivedWaybackUrl = String(archiveRes.waybackUrl);
            archivedWaybackTs = archiveRes.timestamp ? String(archiveRes.timestamp) : null;
          } else {
            try { console.warn('[markets/create] Wayback archive failed', archiveRes?.error); } catch {}
          }
        } catch (e: any) {
          try { console.warn('[markets/create] Wayback archive error', e?.message || String(e)); } catch {}
        }
        const insertPayload: any = {
          market_identifier: symbol,
          symbol,
          name: `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`,
          description: `OrderBook market for ${symbol}`,
          category: Array.isArray(tags) && tags.length ? tags[0] : 'CUSTOM',
          decimals: 6,
          minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
          tick_size: Number(process.env.DEFAULT_TICK_SIZE || 0.01),
          requires_kyc: false,
          settlement_date: settlementTs ? new Date(settlementTs * 1000).toISOString() : null,
          trading_end_date: null,
          data_request_window_seconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
          auto_settle: true,
          oracle_provider: null,
          initial_order: { metricUrl, startPrice: String(startPrice), dataSource, tags, waybackUrl: archivedWaybackUrl || null, waybackTimestamp: archivedWaybackTs || null },
          market_config: {
            ...(aiSourceLocator ? { ai_source_locator: aiSourceLocator } : {}),
            wayback_snapshot: archivedWaybackUrl ? { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: metricUrl } : null,
          },
          chain_id: Number(network.chainId),
          network: String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || ''),
          creator_wallet_address: creatorWalletAddress,
          banner_image_url: null,
          icon_image_url: iconImageUrl,
          supporting_photo_urls: [],
          market_address: orderBook,
          market_id_bytes32: marketId,
          deployment_transaction_hash: receipt?.hash || tx.hash,
          deployment_block_number: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
          deployment_gas_used: (receipt as any)?.gasUsed ? Number((receipt as any).gasUsed) : null,
          deployment_status: 'DEPLOYED',
          market_status: 'ACTIVE',
          deployed_at: new Date().toISOString(),
        };
        await supabase.from('markets').insert(insertPayload).select('id').single();
      }
      logStep('save_market', 'success');
    } catch (e: any) {
      // Non-fatal; continue
      logStep('save_market', 'error', { error: e?.message || String(e) });
    }

    // Respond
    return NextResponse.json({
      ok: true,
      symbol,
      orderBook,
      marketId,
      transactionHash: receipt?.hash || tx.hash,
      feeRecipient,
      waybackUrl: archivedWaybackUrl,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Failed to create market' }, { status: 500 });
  }
}


