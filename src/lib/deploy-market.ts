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
  resolveFactoryVault,
  FeeRegistryABI,
} from '@/lib/contracts';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';
import {
  shortAddr, shortTx, laneLog, phaseHeader,
  laneOverview, phaseSummary, stepLog as vStepLog,
} from '@/lib/console-logger';
import { generateMarketNaming, isShortFormat, cleanSymbol } from '@/lib/market-naming';

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
    challengeWindowSeconds: number;
    /** Explicit lifecycle duration in seconds (for rollover child markets) */
    lifecycleDurationSeconds?: number;
  } | null;
  /** Set to false to disable short naming transformation */
  useShortNaming?: boolean;
  /** Use V2 factory (DiamondRegistry with FacetRegistry) for auto-upgradeable markets. Default: true */
  useV2?: boolean;
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
  /** Clean short market identifier (e.g., "XPD-1D") */
  marketIdentifier: string;
  /** Display name (e.g., "Palladium Daily") */
  displayName: string | null;
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
    symbol: rawSymbol,
    metricUrl,
    settlementTs,
    startPrice6,
    dataSource,
    tags,
    creatorWalletAddress,
    feeRecipient: feeRecipientInput,
    isRollover = false,
    speedRunConfig = null,
    useShortNaming = true,
    useV2 = true,
  } = params;

  // Generate clean, short market naming from raw input
  const naming = useShortNaming && !isShortFormat(rawSymbol)
    ? generateMarketNaming(rawSymbol)
    : null;
  const symbol = naming?.symbol || cleanSymbol(rawSymbol) || rawSymbol.toUpperCase();
  const marketIdentifier = naming?.identifier || symbol;
  const derivedDisplayName = naming?.displayName || null;

  if (naming) {
    log('naming_transform', 'success', {
      raw: rawSymbol,
      identifier: marketIdentifier,
      symbol,
      displayName: derivedDisplayName,
      assetTicker: naming.assetTicker,
      periodSuffix: naming.periodSuffix,
    });
  }

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
  // Add V2 function signature if not present in artifact
  const v2FunctionAbi = [
    'function createFuturesMarketV2(string marketSymbol, string metricUrl, uint256 settlementDate, uint256 startPrice, string dataSource, string[] tags, address diamondOwner) returns (address orderBook, bytes32 marketId)',
    'function facetRegistry() view returns (address)',
    'function initFacetAddress() view returns (address)',
  ];
  const factoryAbi = Array.isArray(baseFactoryAbi) ? [...baseFactoryAbi, ...v2FunctionAbi] : v2FunctionAbi;
  const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
  const factoryIface = new ethers.Interface(factoryAbi);
  const feeRecipient = (feeRecipientInput && ethers.isAddress(feeRecipientInput))
    ? feeRecipientInput
    : (creatorWalletAddress || ownerAddress);

  // ── Preflight: Verify V2 factory configuration ──
  if (useV2) {
    try {
      const [registryAddr, initAddr] = await Promise.all([
        factory.facetRegistry().catch(() => ethers.ZeroAddress),
        factory.initFacetAddress().catch(() => ethers.ZeroAddress),
      ]);
      
      if (!registryAddr || registryAddr === ethers.ZeroAddress) {
        throw new Error('Factory facetRegistry is not configured. Call factory.setFacetRegistry(address) first.');
      }
      if (!initAddr || initAddr === ethers.ZeroAddress) {
        throw new Error('Factory initFacetAddress is not configured. Call factory.setInitFacet(address) first.');
      }
      
      log('factory_v2_config', 'success', { 
        facetRegistry: registryAddr, 
        initFacet: initAddr 
      });
    } catch (e: any) {
      if (e?.message?.includes('not configured')) throw e;
      log('factory_v2_config', 'error', { error: e?.message || String(e) });
      throw new Error(`V2 factory preflight failed: ${e?.message || 'Could not verify facetRegistry/initFacetAddress'}`);
    }
  }

  // ── Deploy via factory ──
  phaseHeader('DEPLOY MARKET', symbol);

  // V2 uses createFuturesMarketV2 (DiamondRegistry) - no facet cuts needed
  // V1 uses createFuturesMarketDiamond with explicit facet cuts
  const factoryMethod = useV2 ? 'createFuturesMarketV2' : 'createFuturesMarketDiamond';
  const factoryArgsV2 = [symbol, metricUrl, settlementTs, startPrice6, dataSource, tags, ownerAddress];
  const factoryArgsV1 = [...factoryArgsV2, cutArg, initFacet, '0x'];
  const factoryArgs = useV2 ? factoryArgsV2 : factoryArgsV1;

  log('deploy_mode', 'success', { v2: useV2, method: factoryMethod });

  vStepLog('Static call (preflight)', 'start', useV2 ? 'V2 (DiamondRegistry)' : 'V1 (direct Diamond)');
  log('factory_static_call', 'start', { v2: useV2 });
  try {
    await factory.getFunction(factoryMethod).staticCall(...factoryArgs);
    vStepLog('Static call (preflight)', 'success');
    log('factory_static_call', 'success');
  } catch (e: any) {
    const decoded = (() => { try { return factoryIface.parseError(e?.data || e?.error?.data || ''); } catch { return null; } })();
    const msg = e?.shortMessage || e?.reason || e?.message || 'static call failed';
    vStepLog('Static call (preflight)', 'error', decoded?.name || msg);
    log('factory_static_call', 'error', { error: msg, customError: decoded?.name, v2: useV2 });
    
    // If V2 fails, provide a helpful hint
    if (useV2 && (msg.includes('InvalidInput') || msg.includes('facetRegistry'))) {
      throw new Error(`V2 factory static call failed: ${msg}. Ensure facetRegistry and initFacetAddress are configured on the factory contract.`);
    }
    throw new Error(`Factory static call failed: ${msg}`);
  }

  vStepLog('Factory tx', 'start', `signer=${shortAddr(ownerAddress)} mode=${useV2 ? 'V2' : 'V1'}`);
  log('factory_send_tx', 'start', { v2: useV2 });
  const overrides = await nonceMgr.nextOverrides();
  const fallbackGasLimit = BigInt(useV2 ? (process.env.FACTORY_GAS_LIMIT_V2 || '4000000') : (process.env.FACTORY_GAS_LIMIT || '8000000'));
  let gasLimit: bigint;
  try {
    const estimated = await factory.getFunction(factoryMethod).estimateGas(...factoryArgs);
    gasLimit = (estimated * 130n) / 100n;
    log('factory_estimate_gas', 'success', { estimated: String(estimated), gasLimit: String(gasLimit), v2: useV2 });
  } catch {
    gasLimit = fallbackGasLimit;
    log('factory_estimate_gas', 'error', { fallback: String(gasLimit), v2: useV2 });
  }

  const balance = await provider.getBalance(ownerAddress);
  const gasPrice = overrides.maxFeePerGas ?? overrides.gasPrice ?? 0n;
  const requiredBalance = gasLimit * BigInt(gasPrice);
  if (balance < requiredBalance) {
    const balEth = ethers.formatEther(balance);
    const reqEth = ethers.formatEther(requiredBalance);
    log('factory_send_tx', 'error', { error: 'insufficient_funds', balance: balEth, required: reqEth, wallet: ownerAddress });
    throw new Error(`Relayer wallet has insufficient native token for gas. Balance: ${balEth}, required: ~${reqEth}. Fund wallet ${ownerAddress}.`);
  }

  let tx: ethers.TransactionResponse;
  try {
    tx = await factory.getFunction(factoryMethod)(
      ...factoryArgs,
      { ...overrides, gasLimit } as any,
    );
  } catch (e: any) {
    const decoded = (() => { try { return factoryIface.parseError(e?.data || e?.error?.data || ''); } catch { return null; } })();
    const msg = e?.shortMessage || e?.reason || e?.message || 'send tx failed';
    vStepLog('Factory tx', 'error', decoded?.name || msg);
    log('factory_send_tx', 'error', { error: msg, customError: decoded?.name, v2: useV2 });
    throw new Error(`Factory send tx failed: ${msg}`);
  }
  vStepLog('Factory tx', 'success', `sent ${shortTx(tx.hash)} (${useV2 ? 'V2' : 'V1'})`);
  log('factory_send_tx', 'success', { hash: tx.hash, v2: useV2 });

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

  // Resolve the CoreVault the factory actually uses on-chain
  const { effectiveVault: effectiveCoreVaultAddress, mismatch: vaultMismatch } =
    await resolveFactoryVault(provider, coreVaultAddress, factoryAddress);
  if (vaultMismatch) {
    log('vault_mismatch', 'start', {
      envCoreVault: coreVaultAddress,
      factoryVault: effectiveCoreVaultAddress,
      action: 'using factory vault for role grants',
    });
  }

  const vaultAddr = await vaultWallet.getAddress();
  phaseHeader('CONFIGURE', shortAddr(orderBook!));
  laneOverview(
    !!useParallelSigners,
    { signer: shortAddr(ownerAddress), tasks: 'Registry Allow + Attach, Fees, Speed-run' },
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
  const regAbi = [
    'function allowedOrderbook(address) view returns (bool)',
    'function setAllowedOrderbook(address,bool) external',
  ];

  const [registryAllowed, currentRegistry, tradingParams] = await Promise.all([
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

  const needRegistryAllow = hasRegistry && !registryAllowed;
  const needRegistryAttach = hasRegistry && (!currentRegistry || String(currentRegistry).toLowerCase() !== String(registryAddress).toLowerCase());

  log('parallel_reads', 'success', {
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

    // 1. Allow orderbook on registry (requires diamond owner / ADMIN_PRIVATE_KEY)
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

    // 2. Attach session registry (diamond owner only)
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

    // 3. Configure fees from FeeRegistry (centralized) or fallback to env/defaults
    const feeRegistryAddress = process.env.FEE_REGISTRY_ADDRESS || (process.env as any).NEXT_PUBLIC_FEE_REGISTRY_ADDRESS || '';
    let takerFeeBps = 7;
    let makerFeeBps = 3;
    let protocolFeeRecipient = process.env.PROTOCOL_FEE_RECIPIENT || (process.env as any).NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '';
    let protocolFeeShareBps = 8000;

    // Read from FeeRegistry if configured
    if (feeRegistryAddress && ethers.isAddress(feeRegistryAddress)) {
      try {
        laneLog('A', 'Read fee registry', 'start', shortAddr(feeRegistryAddress));
        log('read_fee_registry', 'start', { feeRegistry: feeRegistryAddress });
        const feeRegistry = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, provider);
        const [regTakerBps, regMakerBps, regProtocolRecipient, regProtocolShareBps] = await feeRegistry.getFeeStructure();
        takerFeeBps = Number(regTakerBps);
        makerFeeBps = Number(regMakerBps);
        protocolFeeRecipient = regProtocolRecipient;
        protocolFeeShareBps = Number(regProtocolShareBps);
        laneLog('A', 'Read fee registry', 'success', `taker=${takerFeeBps} maker=${makerFeeBps} share=${protocolFeeShareBps}`);
        log('read_fee_registry', 'success', { takerFeeBps, makerFeeBps, protocolFeeRecipient: shortAddr(protocolFeeRecipient), protocolFeeShareBps });
      } catch (e: any) {
        laneLog('A', 'Read fee registry', 'error', `${e?.message || String(e)} — using defaults`);
        log('read_fee_registry', 'error', { error: e?.message || String(e), fallback: 'using defaults' });
      }
    }

    // For rollovers, use the existing feeRecipient if provided
    if (isRollover && feeRecipient && ethers.isAddress(feeRecipient)) {
      protocolFeeRecipient = feeRecipient;
    }
    const creatorAddr =
      isRollover && feeRecipient && ethers.isAddress(feeRecipient)
        ? feeRecipient
        : (creatorWalletAddress || ownerAddress);

    if (protocolFeeRecipient && ethers.isAddress(protocolFeeRecipient)) {
      try {
        laneLog('A', 'Configure fee structure', 'start', `taker=${takerFeeBps} maker=${makerFeeBps} share=${protocolFeeShareBps}`);
        const obFee = new ethers.Contract(orderBook!, ['function updateFeeStructure(uint256,uint256,address,uint256) external'], wallet);
        const feeTx = await obFee.updateFeeStructure(takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps, await nonceMgr.nextOverrides());
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

    // 4. Initialize lifecycle controller with explicit timing
    try {
      const hasExplicitTiming = speedRunConfig && speedRunConfig.rolloverLeadSeconds > 0 && speedRunConfig.challengeWindowSeconds > 0;
      const rolloverLead = hasExplicitTiming ? speedRunConfig.rolloverLeadSeconds : 0;
      const challengeWindow = hasExplicitTiming ? speedRunConfig.challengeWindowSeconds : 0;
      const lifecycleDuration = speedRunConfig?.lifecycleDurationSeconds ?? 0;
      
      // Use initializeLifecycleWithDuration for rollover markets (to preserve parent's duration)
      // Fall back to initializeLifecycleWithTiming for genesis markets
      const useWithDuration = lifecycleDuration > 0;
      
      laneLog('A', 'Initialize lifecycle', 'start', `settlement=${settlementTs} rollover=${rolloverLead}s challenge=${challengeWindow}s duration=${lifecycleDuration}s (${useWithDuration ? 'withDuration' : 'withTiming'})`);
      log('initialize_lifecycle', 'start', { settlementTs, rolloverLead, challengeWindow, lifecycleDuration, useWithDuration });
      
      if (useWithDuration) {
        const lcContract = new ethers.Contract(orderBook!, [
          'function initializeLifecycleWithDuration(uint256 settlementTimestamp, address parent, bool devMode, uint256 rolloverLeadSeconds, uint256 challengeWindowSeconds, uint256 lifecycleDurationSeconds) external',
        ], wallet);
        const ov = await nonceMgr.nextOverrides();
        const txInit = await lcContract.initializeLifecycleWithDuration(
          settlementTs, ethers.ZeroAddress, false,
          rolloverLead, challengeWindow, lifecycleDuration, ov,
        );
        laneLog('A', 'Initialize lifecycle', 'start', `tx sent ${shortTx(txInit.hash)}`);
        pending.push({ label: 'Initialize lifecycle', logKey: 'initialize_lifecycle', tx: txInit });
      } else {
        const lcContract = new ethers.Contract(orderBook!, [
          'function initializeLifecycleWithTiming(uint256 settlementTimestamp, address parent, bool devMode, uint256 rolloverLeadSeconds, uint256 challengeWindowSeconds) external',
        ], wallet);
        const ov = await nonceMgr.nextOverrides();
        const txInit = await lcContract.initializeLifecycleWithTiming(
          settlementTs, ethers.ZeroAddress, false,
          rolloverLead, challengeWindow, ov,
        );
        laneLog('A', 'Initialize lifecycle', 'start', `tx sent ${shortTx(txInit.hash)}`);
        pending.push({ label: 'Initialize lifecycle', logKey: 'initialize_lifecycle', tx: txInit });
      }
    } catch (e: any) {
      laneLog('A', 'Initialize lifecycle', 'error', e?.shortMessage || e?.message || String(e));
      log('initialize_lifecycle', 'error', { error: e?.message || String(e) });
    }

    // 5. Configure challenge bond
    const CHALLENGE_BOND_USDC = 500_000_000; // 500 USDC (6 decimals)
    const CHALLENGE_SLASH_RECIPIENT = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
    try {
      laneLog('A', 'Challenge bond config', 'start', `bond=${CHALLENGE_BOND_USDC / 1e6} USDC slash=${shortAddr(CHALLENGE_SLASH_RECIPIENT)}`);
      const bondContract = new ethers.Contract(orderBook!, [
        'function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external',
      ], wallet);
      const bondTx = await bondContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, CHALLENGE_SLASH_RECIPIENT, await nonceMgr.nextOverrides());
      laneLog('A', 'Challenge bond config', 'start', `tx sent ${shortTx(bondTx.hash)}`);
      log('challenge_bond_config', 'start', { tx: bondTx.hash, bondUsdc: 500, slashRecipient: CHALLENGE_SLASH_RECIPIENT, market: orderBook });
      pending.push({ label: 'Challenge bond config', logKey: 'challenge_bond_config', tx: bondTx, extra: { bondUsdc: 500, slashRecipient: CHALLENGE_SLASH_RECIPIENT, market: orderBook } });
    } catch (e: any) {
      laneLog('A', 'Challenge bond config', 'error', e?.shortMessage || e?.message || String(e));
      log('challenge_bond_config', 'error', { error: e?.message || String(e), market: orderBook });
    }

    // 6. Register lifecycle operators + grant bond exemptions (relayers need both to submit gasless challenges)
    try {
      let relayerPoolSource = 'none';
      let relayerKeys = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
      if (relayerKeys.length) {
        relayerPoolSource = 'challenge';
      } else {
        relayerKeys = loadRelayerPoolFromEnv({ pool: 'hub_trade_small', jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON', indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_SMALL_', allowFallbackSingleKey: false });
        if (relayerKeys.length) {
          relayerPoolSource = 'hub_trade_small';
        } else {
          relayerKeys = loadRelayerPoolFromEnv({ pool: 'global_for_ops', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
          if (relayerKeys.length) relayerPoolSource = 'global';
        }
      }

      laneLog('A', 'Lifecycle operators', 'start', `pool=${relayerPoolSource} candidates=${relayerKeys.length}`);
      log('lifecycle_operators_pool', 'start', {
        pool: relayerPoolSource,
        count: relayerKeys.length,
        addresses: relayerKeys.map((k) => k.address),
        market: orderBook,
        envKeys: {
          RELAYER_PRIVATE_KEYS_CHALLENGE_JSON: !!process.env.RELAYER_PRIVATE_KEYS_CHALLENGE_JSON,
          RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON: !!process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON,
          RELAYER_PRIVATE_KEYS_JSON: !!process.env.RELAYER_PRIVATE_KEYS_JSON,
        },
      });

      if (relayerKeys.length > 0) {
        const addrs = relayerKeys.map((k) => k.address);

        const opsAndExemptContract = new ethers.Contract(orderBook!, [
          'function setLifecycleOperatorBatch(address[] operators, bool authorized) external',
          'function setProposalBondExemptBatch(address[] accounts, bool exempt) external',
        ], wallet);

        laneLog('A', 'Lifecycle operators', 'start', `registering ${addrs.length} relayer(s) on ${shortAddr(orderBook!)} [${addrs.map(shortAddr).join(', ')}]`);
        const opTx = await opsAndExemptContract.setLifecycleOperatorBatch(addrs, true, await nonceMgr.nextOverrides());
        laneLog('A', 'Lifecycle operators', 'start', `tx sent ${shortTx(opTx.hash)}`);
        log('lifecycle_operators_tx', 'start', { tx: opTx.hash, count: addrs.length, market: orderBook });
        pending.push({ label: 'Lifecycle operators', logKey: 'lifecycle_operators', tx: opTx, extra: { count: addrs.length, addresses: addrs, market: orderBook } });

        laneLog('A', 'Bond exemptions', 'start', `${addrs.length} address(es) on ${shortAddr(orderBook!)}`);
        const exemptTx = await opsAndExemptContract.setProposalBondExemptBatch(addrs, true, await nonceMgr.nextOverrides());
        laneLog('A', 'Bond exemptions', 'start', `tx sent ${shortTx(exemptTx.hash)}`);
        log('bond_exempt_tx', 'start', { tx: exemptTx.hash, count: addrs.length, market: orderBook });
        pending.push({ label: 'Bond exemptions', logKey: 'bond_exempt', tx: exemptTx, extra: { count: addrs.length, addresses: addrs, market: orderBook } });
      } else {
        laneLog('A', 'Lifecycle operators', 'error', `NO RELAYER KEYS FOUND — pool=${relayerPoolSource}. Gasless challenges will fall back to admin key.`);
        log('lifecycle_operators', 'skipped', { reason: 'no relayer keys found', pool: relayerPoolSource, market: orderBook });
      }
    } catch (e: any) {
      laneLog('A', 'Lifecycle operators / bond exemptions', 'error', e?.shortMessage || e?.message || String(e));
      log('lifecycle_operators', 'error', { error: e?.message || String(e), market: orderBook, stack: e?.stack?.split('\n').slice(0, 3).join(' | ') });
    }

    // Wait for ALL transactions to mine in parallel
    if (pending.length > 0) {
      laneLog('A', 'Awaiting confirmations', 'start', `${pending.length} pending txs: [${pending.map(p => p.label).join(', ')}]`);
      const results = await Promise.allSettled(
        pending.map(({ label, logKey, tx, successDetail, extra }) =>
          tx.wait()
            .then((receipt: any) => {
              const status = receipt?.status === 1 ? 'confirmed' : `reverted (status=${receipt?.status})`;
              laneLog('A', label, receipt?.status === 1 ? 'success' : 'error', `${status} block=${receipt?.blockNumber} gas=${receipt?.gasUsed?.toString()}`);
              log(logKey, receipt?.status === 1 ? 'success' : 'error', {
                tx: receipt?.hash || tx.hash,
                status: receipt?.status,
                blockNumber: receipt?.blockNumber,
                gasUsed: receipt?.gasUsed?.toString(),
                ...(extra || {}),
              });
              return { label, success: receipt?.status === 1 };
            })
            .catch((e: any) => {
              const reason = e?.reason || e?.shortMessage || e?.message || String(e);
              laneLog('A', label, 'error', `TX FAILED: ${reason}`);
              log(logKey, 'error', { error: reason, tx: tx.hash, ...(extra || {}) });
              return { label, success: false };
            })
        ),
      );
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - succeeded;
      laneLog('A', 'Confirmations complete', failed > 0 ? 'error' : 'success', `${succeeded}/${results.length} succeeded${failed > 0 ? ` — ${failed} FAILED` : ''}`);
    }

    // ── Post-deployment verification + retry for critical config ──
    // Bond config and operator registration are required for gasless challenges.
    // If either is missing after the parallel TX batch, retry synchronously.
    const verifyContract = new ethers.Contract(orderBook!, [
      'function getChallengeBondConfig() external view returns (uint256 bondAmount, address slashRecipient)',
      'function setChallengeBondConfig(uint256 bondAmount, address slashRecipient) external',
      'function isLifecycleOperator(address account) external view returns (bool)',
      'function setLifecycleOperatorBatch(address[] operators, bool authorized) external',
      'function setProposalBondExemptBatch(address[] accounts, bool exempt) external',
      'function isProposalBondExempt(address account) external view returns (bool)',
    ], wallet);

    const MAX_VERIFY_RETRIES = 2;

    // Verify + retry: Challenge bond
    for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      try {
        const [bondAmt, slashAddr] = await verifyContract.getChallengeBondConfig();
        if (BigInt(bondAmt) > 0n && slashAddr !== ethers.ZeroAddress) {
          laneLog('A', 'Challenge bond VERIFIED', 'success', `bond=${Number(bondAmt) / 1e6} USDC slash=${shortAddr(slashAddr)}`);
          log('challenge_bond_verify', 'success', { bondAmount: bondAmt.toString(), slashRecipient: slashAddr, market: orderBook });
          break;
        }
        if (attempt < MAX_VERIFY_RETRIES) {
          laneLog('A', 'Challenge bond MISSING', 'error', `bond=${bondAmt} slash=${slashAddr} — retrying (${attempt + 1}/${MAX_VERIFY_RETRIES})`);
          log('challenge_bond_verify', 'error', { bondAmount: bondAmt.toString(), slashRecipient: slashAddr, attempt, market: orderBook });
          await nonceMgr.resync();
          const retryTx = await verifyContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, CHALLENGE_SLASH_RECIPIENT, await nonceMgr.nextOverrides());
          laneLog('A', 'Challenge bond retry', 'start', `tx sent ${shortTx(retryTx.hash)}`);
          await retryTx.wait();
          laneLog('A', 'Challenge bond retry', 'success', 'confirmed');
        } else {
          laneLog('A', 'Challenge bond CRITICAL', 'error', `FAILED after ${MAX_VERIFY_RETRIES} retries — gasless challenges will NOT work on this market`);
          log('challenge_bond_verify', 'error', { critical: true, bondAmount: bondAmt.toString(), slashRecipient: slashAddr, market: orderBook });
        }
      } catch (verifyErr: any) {
        if (attempt < MAX_VERIFY_RETRIES) {
          laneLog('A', 'Challenge bond verify error', 'error', `${verifyErr?.shortMessage || verifyErr?.message} — retrying`);
        } else {
          laneLog('A', 'Challenge bond CRITICAL', 'error', `Verification failed after retries: ${verifyErr?.message}`);
          log('challenge_bond_verify', 'error', { critical: true, error: verifyErr?.message, market: orderBook });
        }
      }
    }

    // Verify + retry: Lifecycle operators
    const operatorAddrs = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
    if (!operatorAddrs.length) {
      const fallback = loadRelayerPoolFromEnv({ pool: 'global_for_ops', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
      operatorAddrs.push(...fallback);
    }
    if (operatorAddrs.length > 0) {
      for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
        try {
          const checkResults = await Promise.all(
            operatorAddrs.slice(0, 3).map(async (k) => ({
              address: k.address,
              isOperator: await verifyContract.isLifecycleOperator(k.address),
            })),
          );
          const anyRegistered = checkResults.some((r) => r.isOperator);
          if (anyRegistered) {
            const registered = checkResults.filter((r) => r.isOperator).length;
            laneLog('A', 'Operators VERIFIED', 'success', `${registered}/${checkResults.length} sampled are registered`);
            log('lifecycle_operators_verify', 'success', { registered, sampled: checkResults.length, market: orderBook });
            break;
          }
          if (attempt < MAX_VERIFY_RETRIES) {
            laneLog('A', 'Operators MISSING', 'error', `0/${checkResults.length} registered — retrying (${attempt + 1}/${MAX_VERIFY_RETRIES})`);
            log('lifecycle_operators_verify', 'error', { registered: 0, sampled: checkResults.length, attempt, market: orderBook });
            await nonceMgr.resync();
            const addrs = operatorAddrs.map((k) => k.address);
            const retryOpTx = await verifyContract.setLifecycleOperatorBatch(addrs, true, await nonceMgr.nextOverrides());
            laneLog('A', 'Operators retry', 'start', `tx sent ${shortTx(retryOpTx.hash)} (${addrs.length} addrs)`);
            await retryOpTx.wait();
            laneLog('A', 'Operators retry', 'success', 'confirmed');
            const retryExemptTx = await verifyContract.setProposalBondExemptBatch(addrs, true, await nonceMgr.nextOverrides());
            laneLog('A', 'Bond exemptions retry', 'start', `tx sent ${shortTx(retryExemptTx.hash)}`);
            await retryExemptTx.wait();
            laneLog('A', 'Bond exemptions retry', 'success', 'confirmed');
          } else {
            laneLog('A', 'Operators CRITICAL', 'error', `FAILED after ${MAX_VERIFY_RETRIES} retries — gasless challenges will use admin fallback`);
            log('lifecycle_operators_verify', 'error', { critical: true, market: orderBook });
          }
        } catch (verifyErr: any) {
          if (attempt < MAX_VERIFY_RETRIES) {
            laneLog('A', 'Operators verify error', 'error', `${verifyErr?.shortMessage || verifyErr?.message} — retrying`);
          } else {
            laneLog('A', 'Operators CRITICAL', 'error', `Verification failed after retries: ${verifyErr?.message}`);
            log('lifecycle_operators_verify', 'error', { critical: true, error: verifyErr?.message, market: orderBook });
          }
        }
      }
    }

    laneLog('A', 'Lane complete', 'success');
  };

  // Lane B: vault admin operations (CoreVault role grants only)
  const laneB = async () => {
    laneLog('B', 'Starting lane', 'start', `signer=${shortAddr(vaultAddr)}`);

    laneLog('B', 'Grant CoreVault roles', 'start', shortAddr(effectiveCoreVaultAddress));
    log('grant_roles', 'start', { coreVault: effectiveCoreVaultAddress, orderBook });
    
    // Check which wallet has DEFAULT_ADMIN_ROLE - vault admin may not have it
    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // 0x00...00
    const vaultReadOnly = new ethers.Contract(effectiveCoreVaultAddress, CoreVaultABI as any, provider);
    const [adminHasRole, vaultAdminHasRole] = await Promise.all([
      vaultReadOnly.hasRole(DEFAULT_ADMIN_ROLE, ownerAddress).catch(() => false),
      vaultReadOnly.hasRole(DEFAULT_ADMIN_ROLE, vaultAddr).catch(() => false),
    ]);
    
    // Use whichever wallet has admin role (prefer vault wallet for parallelism)
    const roleGranterWallet = vaultAdminHasRole ? vaultWallet : (adminHasRole ? wallet : vaultWallet);
    const roleGranterNonceMgr = vaultAdminHasRole ? vaultNonceMgr : (adminHasRole ? nonceMgr : vaultNonceMgr);
    const roleGranterAddr = await roleGranterWallet.getAddress();
    
    if (!vaultAdminHasRole && adminHasRole) {
      laneLog('B', 'Role granter override', 'start', `vaultAdmin lacks DEFAULT_ADMIN_ROLE, using admin ${shortAddr(roleGranterAddr)}`);
      log('grant_roles_wallet_override', 'success', { 
        vaultAdminHasRole, adminHasRole, 
        using: roleGranterAddr,
        reason: 'vaultAdmin lacks DEFAULT_ADMIN_ROLE' 
      });
    }
    
    const coreVault = new ethers.Contract(effectiveCoreVaultAddress, CoreVaultABI as any, roleGranterWallet);
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

    const sendRoleWithRetry = async (
      roleName: string, roleHash: string, maxRetries = 3,
    ): Promise<ethers.TransactionResponse> => {
      let gasBumpMultiplier = 1n;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Always resync nonce before each attempt - the wallet may be used
          // concurrently by other jobs, causing stale nonces even on first try
          await roleGranterNonceMgr.resync();
          const baseOv = await roleGranterNonceMgr.nextOverrides();
          // Apply gas bump if this is a retry due to replacement underpriced
          const ov = gasBumpMultiplier > 1n ? {
            ...baseOv,
            maxFeePerGas: baseOv.maxFeePerGas ? baseOv.maxFeePerGas * gasBumpMultiplier : undefined,
            maxPriorityFeePerGas: baseOv.maxPriorityFeePerGas ? baseOv.maxPriorityFeePerGas * gasBumpMultiplier : undefined,
            gasPrice: baseOv.gasPrice ? baseOv.gasPrice * gasBumpMultiplier : undefined,
          } : baseOv;
          const tx = await coreVault.grantRole(roleHash, orderBook!, ov);
          laneLog('B', roleName, 'start', `tx sent ${shortTx(tx.hash)}${attempt > 1 ? ` (retry ${attempt})` : ''}`);
          log(`grant_${roleName}_sent`, 'success', { tx: tx.hash, attempt, granter: roleGranterAddr });
          return tx;
        } catch (e: any) {
          const msg = e?.shortMessage || e?.error?.message || e?.message || String(e);
          const code = e?.error?.code ?? e?.code;
          const isNonceError = /nonce.*too low|nonce.*already.*used|NONCE_EXPIRED/i.test(msg);
          const isReplacementError = /replacement.*underpriced|REPLACEMENT_UNDERPRICED|replacement fee too low/i.test(msg) || code === 'REPLACEMENT_UNDERPRICED';
          const isAccessControlError = /AccessControl|e2517d3f|unauthorized/i.test(msg) || e?.data?.includes?.('e2517d3f');
          const isTransient =
            isNonceError ||
            isReplacementError ||
            code === -32100 ||
            code === 'UNKNOWN_ERROR' ||
            /unexpected error|timeout|ECONNRESET|ENOTFOUND|socket hang up|rate.?limit|ETIMEDOUT/i.test(msg);
          // Access control errors are not transient - fail fast
          if (isAccessControlError) {
            laneLog('B', roleName, 'error', `ACCESS DENIED: ${roleGranterAddr} lacks DEFAULT_ADMIN_ROLE on CoreVault`);
            throw new Error(`AccessControlUnauthorizedAccount: ${roleGranterAddr} cannot grant roles on CoreVault ${effectiveCoreVaultAddress}`);
          }
          if (!isTransient || attempt === maxRetries) throw e;
          // Bump gas price for replacement errors (need 10%+ increase to replace pending tx)
          if (isReplacementError) gasBumpMultiplier = gasBumpMultiplier === 1n ? 2n : gasBumpMultiplier + 1n;
          laneLog('B', roleName, 'error', `send failed (attempt ${attempt}/${maxRetries}): ${msg}`);
          log(`grant_${roleName}_retry`, 'error', { attempt, maxRetries, error: msg, isNonceError, isReplacementError, gasBump: Number(gasBumpMultiplier) });
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      throw new Error(`${roleName} grant failed after ${maxRetries} retries`);
    };

    const tx1 = await sendRoleWithRetry('ORDERBOOK_ROLE', ORDERBOOK_ROLE);
    const tx2 = await sendRoleWithRetry('SETTLEMENT_ROLE', SETTLEMENT_ROLE);

    await Promise.all([
      tx1.wait().then((r: any) => laneLog('B', 'ORDERBOOK_ROLE', 'success', `mined block ${r?.blockNumber}`)),
      tx2.wait().then((r: any) => laneLog('B', 'SETTLEMENT_ROLE', 'success', `mined block ${r?.blockNumber}`)),
    ]);
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
    marketIdentifier,
    displayName: derivedDisplayName,
  };
}
