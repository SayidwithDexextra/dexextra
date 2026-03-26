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
import {
  shortAddr, shortTx, laneLog, phaseHeader,
  laneOverview, phaseSummary, stepLog as vStepLog,
} from '@/lib/console-logger';

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
// Helpers
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
      const nonce = next;
      next += 1;
      const fee = await getTxOverrides(signer.provider!);
      return { ...fee, nonce } as any;
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

function normalizePk(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

// ---------------------------------------------------------------------------
// Main deployer
// ---------------------------------------------------------------------------

/**
 * Deploy and fully configure a new market on-chain using the legacy
 * (non-gasless) `createFuturesMarketDiamond` factory path.
 *
 * Post-factory configuration is split into two parallel lanes when a
 * secondary signer (ROLE_GRANTER_PRIVATE_KEY or RELAYER_PRIVATE_KEY) is
 * available with DEFAULT_ADMIN_ROLE on CoreVault:
 *
 *   Lane A (diamond owner / ADMIN_PRIVATE_KEY):
 *     ensure selectors, setAllowedOrderbook, setSessionRegistry, fees, speed-run
 *
 *   Lane B (vault admin / secondary signer):
 *     grantRole(ORDERBOOK), grantRole(SETTLEMENT)
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

  // ── Provider / primary signer (diamond owner) ──
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const nonceMgr = await createNonceManager(wallet);
  const ownerAddress = await wallet.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || '').slice(0, 50);

  // ── Secondary signer for vault/registry ops (parallel lane) ──
  const secondaryPk =
    process.env.ROLE_GRANTER_PRIVATE_KEY ||
    process.env.RELAYER_PRIVATE_KEY;
  const normalizedSecondaryPk = secondaryPk ? normalizePk(secondaryPk) : null;
  const normalizedPrimaryPk = normalizePk(pk);
  const useParallelSigners =
    normalizedSecondaryPk &&
    /^0x[a-fA-F0-9]{64}$/.test(normalizedSecondaryPk) &&
    normalizedSecondaryPk.toLowerCase() !== normalizedPrimaryPk.toLowerCase();

  let vaultWallet: ethers.Wallet;
  let vaultNonceMgr: Awaited<ReturnType<typeof createNonceManager>>;
  if (useParallelSigners) {
    vaultWallet = new ethers.Wallet(normalizedSecondaryPk, provider);
    vaultNonceMgr = await createNonceManager(vaultWallet);
    log('parallel_signers', 'success', {
      diamondOwner: ownerAddress,
      vaultAdmin: await vaultWallet.getAddress(),
    });
  } else {
    vaultWallet = wallet;
    vaultNonceMgr = nonceMgr;
  }

  log('wallet_ready', 'success', { ownerAddress, chainId, parallel: !!useParallelSigners });

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

  // ── Deploy via factory ──
  phaseHeader('DEPLOY MARKET', symbol);

  vStepLog('Static call (preflight)', 'start');
  log('factory_static_call', 'start');
  try {
    await factory.getFunction('createFuturesMarketDiamond').staticCall(
      symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
      ownerAddress, cutArg, initFacet, '0x',
    );
    vStepLog('Static call (preflight)', 'success');
    log('factory_static_call', 'success');
  } catch (e: any) {
    const decoded = (() => { try { return factoryIface.parseError(e?.data || e?.error?.data || ''); } catch { return null; } })();
    const msg = e?.shortMessage || e?.reason || e?.message || 'static call failed';
    vStepLog('Static call (preflight)', 'error', decoded?.name || msg);
    log('factory_static_call', 'error', { error: msg, customError: decoded?.name });
    throw new Error(`Factory static call failed: ${msg}`);
  }

  vStepLog('Factory tx', 'start', `signer=${shortAddr(ownerAddress)}`);
  log('factory_send_tx', 'start');
  const overrides = await nonceMgr.nextOverrides();
  const tx = await factory.getFunction('createFuturesMarketDiamond')(
    symbol, metricUrl, settlementTs, startPrice6, dataSource, tags,
    ownerAddress, cutArg, initFacet, '0x', overrides as any,
  );
  vStepLog('Factory tx', 'success', `sent ${shortTx(tx.hash)}`);
  log('factory_send_tx', 'success', { hash: tx.hash });

  vStepLog('Confirm factory tx', 'start');
  log('factory_confirm', 'start');
  const receipt = await tx.wait();
  vStepLog('Confirm factory tx', 'success', `block ${receipt?.blockNumber}`);
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

  // =========================================================================
  // POST-FACTORY PARALLEL CONFIGURATION
  //
  // Two independent lanes run concurrently after the factory deploy:
  //   Lane A (diamond owner): selectors, session registry, fees, speed-run
  //   Lane B (vault admin):   allowOrderbook, grantRole x2
  // =========================================================================

  log('parallel_configure', 'start', { orderBook, parallel: !!useParallelSigners });

  const vaultAddr = await vaultWallet.getAddress();
  phaseHeader('CONFIGURE', shortAddr(orderBook!));
  laneOverview(
    !!useParallelSigners,
    { signer: shortAddr(ownerAddress), tasks: 'Selectors, Registry Allow + Attach, Fees, Speed-run' },
    useParallelSigners
      ? { signer: shortAddr(vaultAddr), tasks: 'CoreVault Role Grants' }
      : undefined,
  );

  const parallelStart = Date.now();

  // ── Resync nonces for both signers after factory tx ──
  await nonceMgr.resync();
  if (useParallelSigners) await vaultNonceMgr.resync();

  const registryAddress =
    process.env.SESSION_REGISTRY_ADDRESS ||
    (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || '';
  const hasRegistry = registryAddress && ethers.isAddress(registryAddress);

  // ── Phase 1: Parallel reads ──
  const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
  const loupe = new ethers.Contract(orderBook, LoupeABI, provider);
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

  const regAbi = [
    'function allowedOrderbook(address) view returns (bool)',
    'function setAllowedOrderbook(address,bool) external',
  ];

  const [selectorResults, registryAllowed, currentRegistry, tradingParams] = await Promise.all([
    Promise.all(requiredSelectors.map(async (sel) => {
      try {
        const addr: string = await loupe.facetAddress(sel);
        return (!addr || addr.toLowerCase() === ethers.ZeroAddress) ? sel : null;
      } catch { return sel; }
    })),
    hasRegistry
      ? new ethers.Contract(registryAddress, regAbi, provider).allowedOrderbook(orderBook).catch(() => false)
      : Promise.resolve(true),
    hasRegistry
      ? new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, provider).sessionRegistry().catch(() => ethers.ZeroAddress)
      : Promise.resolve(registryAddress),
    new ethers.Contract(orderBook, [
      'function getTradingParameters() view returns (uint256,uint256,address)',
    ], provider).getTradingParameters().catch(() => [0n, 0n, ethers.ZeroAddress]),
  ]);

  const missingSelectors = selectorResults.filter((s): s is string => s !== null);
  const needRegistryAllow = hasRegistry && !registryAllowed;
  const needRegistryAttach = hasRegistry && (!currentRegistry || String(currentRegistry).toLowerCase() !== String(registryAddress).toLowerCase());

  log('parallel_reads', 'success', {
    missingSelectors: missingSelectors.length,
    needRegistryAllow,
    needRegistryAttach,
  });

  // ── Phase 2: Parallel writes across two signers ──

  // Lane A: diamond owner operations
  //
  // All config transactions are sent with pre-allocated nonces without
  // waiting for intermediate confirmations.  On chains with slow block
  // times (e.g. Hyperliquid ~60s big blocks) this collapses 4-5
  // sequential blocks into 1-2, cutting ~4 min down to ~1-2 min.
  const laneA = async () => {
    laneLog('A', 'Starting lane', 'start', `signer=${shortAddr(ownerAddress)}`);

    type PendingTx = {
      label: string;
      logKey: string;
      tx: ethers.TransactionResponse;
      successDetail?: string;
      extra?: Record<string, any>;
    };
    const pending: PendingTx[] = [];

    // 1. Ensure selectors
    if (missingSelectors.length > 0) {
      try {
        laneLog('A', 'Ensure selectors', 'start', `${missingSelectors.length} missing`);
        log('ensure_selectors', 'start', { missingCount: missingSelectors.length });
        const CutABI = ['function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)'];
        const diamondCut = new ethers.Contract(orderBook!, CutABI, wallet);
        const patchCut = [{ facetAddress: placementFacet, action: 0, functionSelectors: missingSelectors }];
        const ov = await nonceMgr.nextOverrides();
        const txCut = await diamondCut.diamondCut(patchCut as any, ethers.ZeroAddress, '0x', ov as any);
        laneLog('A', 'Ensure selectors', 'start', `tx sent ${shortTx(txCut.hash)}`);
        pending.push({ label: 'Ensure selectors', logKey: 'ensure_selectors', tx: txCut, extra: { patched: missingSelectors.length } });
      } catch (e: any) {
        laneLog('A', 'Ensure selectors', 'error', e?.shortMessage || e?.message || String(e));
        log('ensure_selectors', 'error', { error: e?.message || String(e) });
      }
    } else {
      laneLog('A', 'Ensure selectors', 'success', 'all present');
      log('ensure_selectors', 'success', { message: 'All present' });
    }

    // 2. Allow orderbook on registry (requires diamond owner / ADMIN_PRIVATE_KEY)
    if (needRegistryAllow) {
      try {
        laneLog('A', 'Allow orderbook on registry', 'start');
        const registry = new ethers.Contract(registryAddress, regAbi, wallet);
        const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
        const txAllow = await registry.setAllowedOrderbook(orderBook!, true, ov as any);
        laneLog('A', 'Allow orderbook on registry', 'start', `tx sent ${shortTx(txAllow.hash)}`);
        pending.push({ label: 'Allow orderbook on registry', logKey: 'session_registry_allow', tx: txAllow });
      } catch (e: any) {
        laneLog('A', 'Allow orderbook on registry', 'error', e?.shortMessage || e?.message || String(e));
        log('session_registry_allow', 'error', { error: e?.message || String(e) });
      }
    }

    // 3. Attach session registry (diamond owner only)
    if (needRegistryAttach) {
      try {
        laneLog('A', 'Attach session registry', 'start', shortAddr(registryAddress));
        const meta = new ethers.Contract(orderBook!, (MetaTradeFacetArtifact as any).abi, wallet);
        const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
        const txSet = await meta.setSessionRegistry(registryAddress, ov);
        laneLog('A', 'Attach session registry', 'start', `tx sent ${shortTx(txSet.hash)}`);
        pending.push({ label: 'Attach session registry', logKey: 'session_registry_attach', tx: txSet });
      } catch (e: any) {
        laneLog('A', 'Attach session registry', 'error', e?.shortMessage || e?.message || String(e));
        log('session_registry_attach', 'error', { error: e?.message || String(e) });
      }
    }

    // 4. Configure fees (fire both with pre-allocated nonces, no intermediate waits)
    const defaultProtocolRecipient =
      process.env.PROTOCOL_FEE_RECIPIENT ||
      (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
    const protocolFeeRecipient =
      isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient
        : defaultProtocolRecipient;
    const creatorAddr =
      isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient
        : (creatorWalletAddress || ownerAddress);

    if (protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
      try {
        laneLog('A', 'Configure fee structure', 'start');
        const obFee = new ethers.Contract(orderBook!, ['function updateFeeStructure(uint256,uint256,address,uint256) external'], wallet);
        const feeTx = await obFee.updateFeeStructure(7, 3, protocolFeeRecipient, 8000, await nonceMgr.nextOverrides());
        laneLog('A', 'Configure fee structure', 'start', `tx sent ${shortTx(feeTx.hash)}`);
        pending.push({ label: 'Configure fee structure', logKey: 'configure_fees', tx: feeTx });
      } catch (e: any) {
        laneLog('A', 'Configure fee structure', 'error', e?.message || String(e));
        log('configure_fees', 'error', { error: e?.message || String(e) });
      }
    }

    try {
      laneLog('A', 'Set fee recipient', 'start', shortAddr(creatorAddr));
      const obTrade = new ethers.Contract(orderBook!, [
        'function updateTradingParameters(uint256,uint256,address) external',
      ], wallet);
      const [marginBps, tradingFee] = tradingParams;
      const recipientTx = await obTrade.updateTradingParameters(marginBps, tradingFee, creatorAddr, await nonceMgr.nextOverrides());
      laneLog('A', 'Set fee recipient', 'start', `tx sent ${shortTx(recipientTx.hash)}`);
      pending.push({ label: 'Set fee recipient', logKey: 'set_fee_recipient', tx: recipientTx, successDetail: `mined -> ${shortAddr(creatorAddr)}`, extra: { feeRecipient: creatorAddr } });
    } catch (e: any) {
      laneLog('A', 'Set fee recipient', 'error', e?.message || String(e));
      log('set_fee_recipient', 'error', { error: e?.message || String(e) });
    }

    // 5. Initialize lifecycle controller
    try {
      const isDevMode = !!speedRunConfig;
      laneLog('A', 'Initialize lifecycle', 'start', `settlement=${settlementTs} devMode=${isDevMode}`);
      log('initialize_lifecycle', 'start', { settlementTs, isDevMode });
      const lcContract = new ethers.Contract(orderBook!, [
        'function initializeLifecycleWithMode(uint256 settlementTimestamp, address parent, bool devMode) external',
      ], wallet);
      const ov = await nonceMgr.nextOverrides();
      const txInit = await lcContract.initializeLifecycleWithMode(settlementTs, ethers.ZeroAddress, isDevMode, ov);
      laneLog('A', 'Initialize lifecycle', 'start', `tx sent ${shortTx(txInit.hash)}`);
      pending.push({ label: 'Initialize lifecycle', logKey: 'initialize_lifecycle', tx: txInit });
    } catch (e: any) {
      laneLog('A', 'Initialize lifecycle', 'error', e?.shortMessage || e?.message || String(e));
      log('initialize_lifecycle', 'error', { error: e?.message || String(e) });
    }

    // 6. Speed-run lifecycle overrides
    if (speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeDurationSeconds > 0) {
      try {
        laneLog('A', 'Speed-run overrides', 'start', `rollover=${speedRunConfig.rolloverLeadSeconds}s challenge=${speedRunConfig.challengeDurationSeconds}s`);
        const lifecycleContract = new ethers.Contract(orderBook!, [
          'function enableTestingMode(bool enabled) external',
          'function setLeadTimes(uint256 rolloverLeadSeconds, uint256 challengeLeadSeconds) external',
        ], wallet);
        const ov1 = await nonceMgr.nextOverrides();
        const ov2 = await nonceMgr.nextOverrides();
        const txEnable = await lifecycleContract.enableTestingMode(true, ov1);
        laneLog('A', 'Speed-run enable', 'start', `tx sent ${shortTx(txEnable.hash)}`);
        pending.push({ label: 'Speed-run enable', logKey: 'speed_run_enable', tx: txEnable });
        const txLead = await lifecycleContract.setLeadTimes(
          speedRunConfig.rolloverLeadSeconds, speedRunConfig.challengeDurationSeconds, ov2,
        );
        laneLog('A', 'Speed-run lead times', 'start', `tx sent ${shortTx(txLead.hash)}`);
        pending.push({ label: 'Speed-run lead times', logKey: 'speed_run_lead', tx: txLead });
      } catch (e: any) {
        laneLog('A', 'Speed-run overrides', 'error', e?.shortMessage || e?.message || String(e));
        log('speed_run', 'error', { error: e?.message || String(e) });
      }
    }

    // Wait for ALL transactions to mine in parallel
    if (pending.length > 0) {
      laneLog('A', 'Awaiting confirmations', 'start', `${pending.length} pending txs`);
      await Promise.allSettled(
        pending.map(({ label, logKey, tx, successDetail, extra }) =>
          tx.wait()
            .then((receipt: any) => {
              laneLog('A', label, 'success', successDetail || 'mined');
              log(logKey, 'success', { tx: receipt?.hash || tx.hash, ...(extra || {}) });
            })
            .catch((e: any) => {
              laneLog('A', label, 'error', e?.message || String(e));
              log(logKey, 'error', { error: e?.message || String(e) });
            })
        ),
      );
    }

    laneLog('A', 'Lane complete', 'success');
  };

  // Lane B: vault admin operations (CoreVault role grants only)
  const laneB = async () => {
    laneLog('B', 'Starting lane', 'start', `signer=${shortAddr(vaultAddr)}`);
    const txWaits: Promise<any>[] = [];

    // 1. Grant CoreVault roles (pre-allocate nonces, fire in parallel)
    laneLog('B', 'Grant CoreVault roles', 'start', shortAddr(coreVaultAddress));
    log('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, vaultWallet);
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

    const ov1 = await vaultNonceMgr.nextOverrides();
    const ov2 = await vaultNonceMgr.nextOverrides();
    const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook!, ov1);
    laneLog('B', 'ORDERBOOK_ROLE', 'start', `tx sent ${shortTx(tx1.hash)}`);
    const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook!, ov2);
    laneLog('B', 'SETTLEMENT_ROLE', 'start', `tx sent ${shortTx(tx2.hash)}`);
    txWaits.push(
      tx1.wait().then((r: any) => laneLog('B', 'ORDERBOOK_ROLE', 'success', `mined block ${r?.blockNumber}`)),
      tx2.wait().then((r: any) => laneLog('B', 'SETTLEMENT_ROLE', 'success', `mined block ${r?.blockNumber}`)),
    );

    await Promise.all(txWaits);
    laneLog('B', 'Lane complete', 'success');
    log('grant_roles', 'success');
  };

  // Run both lanes in parallel
  const [laneAResult, laneBResult] = await Promise.allSettled([laneA(), laneB()]);

  phaseSummary(laneAResult, laneBResult, Date.now() - parallelStart);

  if (laneBResult.status === 'rejected') {
    log('grant_roles', 'error', { error: extractError(laneBResult.reason) });
    throw new Error(`Admin role grant failed: ${extractError(laneBResult.reason)}`);
  }
  if (laneAResult.status === 'rejected') {
    log('lane_a', 'error', { error: extractError(laneAResult.reason) });
  }

  log('parallel_configure', 'success', { orderBook });

  // Fire-and-forget: configure challenge bond (non-blocking, not essential for trading)
  const CHALLENGE_BOND_USDC = 50_000_000; // 50 USDC (6 decimals)
  const CHALLENGE_SLASH_RECIPIENT = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
  (async () => {
    try {
      const freshNonce = await wallet.getNonce('pending');
      const bondContract = new ethers.Contract(orderBook!, [
        'function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external',
      ], wallet);
      const tx = await bondContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, CHALLENGE_SLASH_RECIPIENT, { nonce: freshNonce });
      await tx.wait();
      log('challenge_bond_config', 'success', { bondUsdc: 50, slashRecipient: CHALLENGE_SLASH_RECIPIENT, tx: tx.hash });
    } catch (e: any) {
      log('challenge_bond_config', 'error', { error: e?.message || String(e) });
    }
  })();

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
