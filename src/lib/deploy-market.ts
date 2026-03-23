import { ethers } from 'ethers';
import path from 'path';
import { readFileSync } from 'node:fs';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  CoreVaultABI,
  MarketLifecycleFacetABI,
} from '@/lib/contracts';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployMarketParams {
  symbol: string;
  metricUrl: string;
  settlementTs: number;
  startPrice6: bigint;
  dataSource: string;
  tags: string[];
  creatorWalletAddress?: string | null;
  feeRecipient?: string | null;
  isRollover?: boolean;
  speedRunConfig?: {
    rolloverLeadSeconds: number;
    challengeDurationSeconds: number;
    settlementWindowSeconds: number;
  } | null;
}

export interface DeployMarketResult {
  ok: true;
  orderBook: string;
  marketIdBytes32: string;
  transactionHash: string;
  blockNumber: number | null;
  gasUsed: number | null;
  chainId: number;
  network: string;
  ownerAddress: string;
}

type LogFn = (step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) => void;

// ---------------------------------------------------------------------------
// Helpers (extracted from /api/markets/create)
// ---------------------------------------------------------------------------

function selectorsFromAbi(abi: any[]): string[] {
  try {
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag) => frag?.type === 'function')
      .map((frag) => ethers.id((frag as any).format('sighash')).slice(0, 10));
  } catch {
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
      `${contractName}.json`,
    );
    const raw = readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(raw);
    if (artifact && Array.isArray((artifact as any).abi)) return (artifact as any).abi;
  } catch {}
  return fallbackAbi;
}

async function getTxOverrides(provider: ethers.Provider) {
  try {
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('0.1', 'gwei');
    const minMax = ethers.parseUnits('1', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('0.5', 'gwei');
    const bumped = (base * 12n) / 10n;
    const minLegacy = ethers.parseUnits('1', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('1', 'gwei') } as const;
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
    },
    async resync() {
      next = await signer.provider!.getTransactionCount(address, 'pending');
      return next;
    },
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

function defaultLog(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_deploy',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {}),
    }));
  } catch {}
}

// ---------------------------------------------------------------------------
// Main deployer
// ---------------------------------------------------------------------------

/**
 * Deploy and fully configure a new market on-chain using the legacy
 * (non-gasless) `createFuturesMarketDiamond` factory path.
 *
 * Performs: factory deploy, ensure selectors, session registry,
 * CoreVault role grants, fee configuration, and optional speed-run overrides.
 *
 * Returns deployment artifacts needed by /api/markets/save.
 */
export async function deployMarket(
  params: DeployMarketParams,
  log: LogFn = defaultLog,
): Promise<DeployMarketResult> {
  const {
    symbol,
    metricUrl,
    settlementTs,
    startPrice6,
    dataSource,
    tags,
    creatorWalletAddress,
    feeRecipient: feeRecipientInput,
    isRollover = false,
    speedRunConfig = null,
  } = params;

  // ── Env configuration ──
  const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
  const pk = process.env.ADMIN_PRIVATE_KEY;
  const factoryAddress =
    process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
    (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
  let initFacet: string =
    process.env.ORDER_BOOK_INIT_FACET ||
    (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET ||
    '';
  const adminFacet = process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
  const pricingFacet = process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
  const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
  const execFacet = process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
  const liqFacet = process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
  const viewFacet = process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
  const settleFacet = process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
  const vaultFacet =
    process.env.ORDERBOOK_VALUT_FACET ||
    process.env.ORDERBOOK_VAULT_FACET ||
    (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET ||
    (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET;
  const lifecycleFacet = process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
  const metaTradeFacet = process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET;
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;

  if (!rpcUrl) throw new Error('RPC_URL not configured');
  if (!pk) throw new Error('ADMIN_PRIVATE_KEY not configured');
  if (!factoryAddress || !ethers.isAddress(factoryAddress)) throw new Error('Factory address not configured');
  if (!initFacet || !ethers.isAddress(initFacet)) throw new Error('Init facet address not configured');
  if (!adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet || !vaultFacet || !lifecycleFacet || !metaTradeFacet) {
    throw new Error('One or more facet addresses are missing');
  }
  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) throw new Error('CoreVault address not configured');

  // ── Provider / signer ──
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const nonceMgr = await createNonceManager(wallet);
  const ownerAddress = await wallet.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || '').slice(0, 50);

  log('wallet_ready', 'success', { ownerAddress, chainId });

  // ── Load ABIs & build cut ──
  const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
  const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
  const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
  const execAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
  const liqAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
  const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
  const settleAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);
  const vaultAbi = loadFacetAbi('OrderBookVaultAdminFacet', (OrderBookVaultAdminFacetArtifact as any)?.abi || []);
  const lifecycleAbi = loadFacetAbi('MarketLifecycleFacet', (MarketLifecycleFacetArtifact as any)?.abi || (MarketLifecycleFacetABI as any[]));
  const metaFacetAbi = (MetaTradeFacetArtifact as any)?.abi || [];

  let cut = [
    { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(adminAbi) },
    { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(pricingAbi) },
    { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(placementAbi) },
    { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(execAbi) },
    { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(liqAbi) },
    { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(viewAbi) },
    { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(settleAbi) },
    { facetAddress: vaultFacet, action: 0, functionSelectors: selectorsFromAbi(vaultAbi) },
    { facetAddress: lifecycleFacet, action: 0, functionSelectors: selectorsFromAbi(lifecycleAbi) },
    { facetAddress: metaTradeFacet, action: 0, functionSelectors: selectorsFromAbi(metaFacetAbi) },
  ];

  // Override cut/initFacet from /api/orderbook/cut to avoid drift
  try {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const resp = await fetch(`${baseUrl}/api/orderbook/cut`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`cut API ${resp.status}`);
    const data = await resp.json();
    const apiCut = Array.isArray(data?.cut) ? data.cut : [];
    const apiInit = data?.initFacet || null;
    if (!apiCut.length || !apiInit || !ethers.isAddress(apiInit)) {
      throw new Error('cut API returned invalid cut/initFacet');
    }
    cut = apiCut.map((c: any) => ({
      facetAddress: c?.facetAddress,
      action: c?.action ?? 0,
      functionSelectors: Array.isArray(c?.functionSelectors) ? c.functionSelectors : [],
    }));
    initFacet = apiInit;
  } catch (e: any) {
    console.warn('[deploy-market] cut override failed, using fallback', e?.message || String(e));
  }

  const emptyFacets = cut.filter((c) => !c.functionSelectors?.length).map((c) => c.facetAddress);
  if (emptyFacets.length) throw new Error(`Facet selectors could not be built: ${emptyFacets.join(', ')}`);

  const cutArg = cut.map((c) => [c.facetAddress, 0, c.functionSelectors]);
  log('facet_cut_built', 'success', { facetCount: cut.length });

  // ── Preflight bytecode checks ──
  try {
    const [factoryCode, initCode, ...facetCodes] = await Promise.all([
      provider.getCode(factoryAddress),
      provider.getCode(initFacet),
      ...cutArg.map((c: any) => provider.getCode(c?.[0])),
    ]);
    const noFactory = !factoryCode || factoryCode === '0x' || factoryCode === '0x0';
    const noInit = !initCode || initCode === '0x' || initCode === '0x0';
    const badFacets = facetCodes.reduce<number[]>((acc, code, idx) => {
      if (!code || code === '0x' || code === '0x0') acc.push(idx);
      return acc;
    }, []);
    if (noFactory || noInit || badFacets.length) {
      throw new Error(`Contract bytecode missing: factory=${noFactory}, init=${noInit}, badFacets=${badFacets}`);
    }
  } catch (e: any) {
    if (e?.message?.startsWith('Contract bytecode')) throw e;
    log('preflight_bytecode', 'error', { error: e?.message });
  }

  // ── Resolve factory ABI ──
  const factoryArtifact = await import('@/lib/abis/FuturesMarketFactory.json');
  const baseFactoryAbi =
    (factoryArtifact as any)?.default?.abi ||
    (factoryArtifact as any)?.abi ||
    (factoryArtifact as any)?.default ||
    (factoryArtifact as any);
  const factoryAbi = Array.isArray(baseFactoryAbi) ? baseFactoryAbi : [];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
  const factoryIface = new ethers.Interface(factoryAbi);
  const feeRecipient = (feeRecipientInput && ethers.isAddress(feeRecipientInput))
    ? feeRecipientInput
    : (creatorWalletAddress || ownerAddress);

  // ── Deploy via factory (legacy direct path) ──
  log('factory_static_call', 'start');
  try {
    await factory.getFunction('createFuturesMarketDiamond').staticCall(
      symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
      ownerAddress, cutArg, initFacet, '0x',
    );
    log('factory_static_call', 'success');
  } catch (e: any) {
    const decoded = (() => { try { return factoryIface.parseError(e?.data || e?.error?.data || ''); } catch { return null; } })();
    const msg = e?.shortMessage || e?.reason || e?.message || 'static call failed';
    log('factory_static_call', 'error', { error: msg, customError: decoded?.name });
    throw new Error(`Factory static call failed: ${msg}`);
  }

  log('factory_send_tx', 'start');
  const overrides = await nonceMgr.nextOverrides();
  const tx = await factory.getFunction('createFuturesMarketDiamond')(
    symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
    ownerAddress, cutArg, initFacet, '0x', overrides as any,
  );
  log('factory_send_tx', 'success', { hash: tx.hash });

  log('factory_confirm', 'start');
  const receipt = await tx.wait();
  log('factory_confirm', 'success', { hash: receipt?.hash || tx.hash, block: receipt?.blockNumber });

  // ── Parse FuturesMarketCreated event ──
  const iface = new ethers.Interface(factoryAbi);
  let orderBook: string | null = null;
  let marketIdBytes32: string | null = null;
  for (const rlog of (receipt as any)?.logs || []) {
    try {
      const parsed = iface.parseLog(rlog);
      if (parsed?.name === 'FuturesMarketCreated') {
        orderBook = parsed.args?.orderBook as string;
        marketIdBytes32 = parsed.args?.marketId as string;
        break;
      }
    } catch {}
  }
  if (!orderBook || !marketIdBytes32) throw new Error('Could not parse FuturesMarketCreated event');

  // ── Ensure required placement selectors ──
  try {
    log('ensure_selectors', 'start', { orderBook });
    const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
    const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
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
    const selectorResults = await Promise.all(
      requiredSelectors.map(async (sel) => {
        try {
          const addr: string = await loupe.facetAddress(sel);
          return (!addr || addr.toLowerCase() === ethers.ZeroAddress) ? sel : null;
        } catch { return sel; }
      }),
    );
    const missing = selectorResults.filter((s): s is string => s !== null);
    if (missing.length > 0) {
      log('ensure_selectors', 'start', { missingCount: missing.length });
      const patchCut = [{ facetAddress: placementFacet, action: 0, functionSelectors: missing }];
      const ov = await nonceMgr.nextOverrides();
      const txCut = await diamondCut.diamondCut(patchCut as any, ethers.ZeroAddress, '0x', ov as any);
      await txCut.wait();
      log('ensure_selectors', 'success', { patched: missing.length });
    } else {
      log('ensure_selectors', 'success', { message: 'All present' });
    }
  } catch (e: any) {
    log('ensure_selectors', 'error', { error: e?.message || String(e) });
  }

  // ── Session registry ──
  try { await nonceMgr.resync(); } catch {}
  try {
    const registryAddress =
      process.env.SESSION_REGISTRY_ADDRESS ||
      (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || '';
    if (registryAddress && ethers.isAddress(registryAddress)) {
      // Allow orderbook in registry
      try {
        const regAbi = [
          'function allowedOrderbook(address) view returns (bool)',
          'function setAllowedOrderbook(address,bool) external',
        ];
        const registry = new ethers.Contract(registryAddress, regAbi, wallet);
        const allowed: boolean = await registry.allowedOrderbook(orderBook);
        if (!allowed) {
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txAllow = await registry.setAllowedOrderbook(orderBook, true, ov as any);
          await txAllow.wait();
          log('session_registry_allow', 'success', { tx: txAllow.hash });
        }
      } catch (e: any) {
        log('session_registry_allow', 'error', { error: e?.message || String(e) });
      }

      // Attach session registry on MetaTradeFacet
      try {
        const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
        const current = await meta.sessionRegistry();
        if (!current || String(current).toLowerCase() !== String(registryAddress).toLowerCase()) {
          const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
          const txSet = await meta.setSessionRegistry(registryAddress, ov);
          await txSet.wait();
          log('session_registry_attach', 'success', { tx: txSet.hash });
        }
      } catch (e: any) {
        log('session_registry_attach', 'error', { error: e?.message || String(e) });
      }
    }
  } catch (e: any) {
    log('session_registry', 'error', { error: e?.message || String(e) });
  }

  // ── Grant CoreVault roles ──
  log('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
  const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  try {
    const ov1 = await nonceMgr.nextOverrides();
    const ov2 = await nonceMgr.nextOverrides();
    const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
    const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
    await Promise.all([tx1.wait(), tx2.wait()]);
    log('grant_roles', 'success');
  } catch (e: any) {
    log('grant_roles', 'error', { error: extractError(e) });
    throw new Error(`Admin role grant failed: ${extractError(e)}`);
  }

  // ── Configure fees ──
  {
    const defaultProtocolRecipient =
      process.env.PROTOCOL_FEE_RECIPIENT ||
      (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
    const protocolFeeRecipient =
      isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient
        : defaultProtocolRecipient;
    const takerFeeBps = 7;
    const makerFeeBps = 3;
    const protocolShareBps = 8000;
    const creatorAddr =
      isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient
        : (creatorWalletAddress || ownerAddress);

    const feeTxPromises: Promise<any>[] = [];

    if (protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
      log('configure_fees', 'start');
      feeTxPromises.push(
        (async () => {
          const obFee = new ethers.Contract(
            orderBook,
            ['function updateFeeStructure(uint256,uint256,address,uint256) external'],
            wallet,
          );
          const feeTx = await obFee.updateFeeStructure(
            takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolShareBps,
            await nonceMgr.nextOverrides(),
          );
          await feeTx.wait();
          log('configure_fees', 'success', { tx: feeTx.hash });
        })().catch((e: any) => log('configure_fees', 'error', { error: e?.message || String(e) })),
      );
    }

    log('set_fee_recipient', 'start', { creator: creatorAddr });
    feeTxPromises.push(
      (async () => {
        const obTrade = new ethers.Contract(
          orderBook,
          [
            'function updateTradingParameters(uint256,uint256,address) external',
            'function getTradingParameters() view returns (uint256,uint256,address)',
          ],
          wallet,
        );
        const [marginBps, tradingFee] = await obTrade.getTradingParameters();
        const recipientTx = await obTrade.updateTradingParameters(
          marginBps, tradingFee, creatorAddr,
          await nonceMgr.nextOverrides(),
        );
        await recipientTx.wait();
        log('set_fee_recipient', 'success', { tx: recipientTx.hash, feeRecipient: creatorAddr });
      })().catch((e: any) => log('set_fee_recipient', 'error', { error: e?.message || String(e) })),
    );

    await Promise.all(feeTxPromises);
  }

  // ── Speed-run lifecycle overrides ──
  if (speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeDurationSeconds > 0) {
    try {
      log('speed_run', 'start', { speedRunConfig });
      const lifecycleContract = new ethers.Contract(
        orderBook,
        [
          'function enableTestingMode(bool enabled) external',
          'function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external',
        ],
        wallet,
      );
      const ov1 = await nonceMgr.nextOverrides();
      const txEnable = await lifecycleContract.enableTestingMode(true, ov1);
      await txEnable.wait();

      const ov2 = await nonceMgr.nextOverrides();
      const txLead = await lifecycleContract.setLeadTimes(
        speedRunConfig.rolloverLeadSeconds,
        speedRunConfig.challengeDurationSeconds,
        ov2,
      );
      await txLead.wait();
      log('speed_run', 'success');
    } catch (e: any) {
      log('speed_run', 'error', { error: e?.message || String(e) });
    }
  }

  return {
    ok: true,
    orderBook,
    marketIdBytes32,
    transactionHash: receipt?.hash || tx.hash,
    blockNumber: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
    gasUsed: (receipt as any)?.gasUsed ? Number((receipt as any).gasUsed) : null,
    chainId,
    network: networkName,
    ownerAddress,
  };
}
