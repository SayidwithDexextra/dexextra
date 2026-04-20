import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { sendWithNonceRetry, withRelayer, isInsufficientFundsError } from '@/lib/relayerRouter';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';
import { computeRelayerProof } from '@/lib/relayerMerkle';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { gaslessTradeRateLimit, gaslessTradeGlobalRateLimit, tripCircuitBreaker, isCircuitBreakerOpen } from '@/lib/rate-limit';

class HttpError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any, message?: string) {
    super(message || (body?.error ? String(body.error) : 'http_error'));
    this.status = status;
    this.body = body;
  }
}

function parseBigintish(v: any, label: string): bigint {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') return BigInt(v);
  } catch {
    // fallthrough
  }
  throw new HttpError(400, { error: `invalid_${label}` });
}

function safeJsonParseArray(text: string): string[] {
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function decodeRevertData(data: string): { kind: string; message?: string; selector?: string; args?: any } | null {
  if (!data || typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  try {
    // Error(string)
    if (selector === '0x08c379a0') {
      const abi = new ethers.AbiCoder();
      const [msg] = abi.decode(['string'], ('0x' + data.slice(10)) as any);
      return { kind: 'Error(string)', message: String(msg), selector };
    }
    // Panic(uint256)
    if (selector === '0x4e487b71') {
      const abi = new ethers.AbiCoder();
      const [code] = abi.decode(['uint256'], ('0x' + data.slice(10)) as any);
      return { kind: 'Panic(uint256)', message: String(code), selector };
    }
    // OZ AccessControl v5 custom error
    const acSel = ethers.id('AccessControlUnauthorizedAccount(address,bytes32)').slice(0, 10).toLowerCase();
    if (selector === acSel) {
      const abi = new ethers.AbiCoder();
      const [account, role] = abi.decode(['address', 'bytes32'], ('0x' + data.slice(10)) as any);
      return { kind: 'AccessControlUnauthorizedAccount', selector, args: { account, role } };
    }
    // CoreVault custom errors (no args)
    const coreNoArg = [
      'InvalidImpl()',
      'LiqImplNotSet()',
      'InvalidAmount()',
      'InvalidAddress()',
      'CollateralDecimalsMustBe6()',
      'InsufficientAvailable()',
      'InsufficientBalance()',
      'MarketNotFound()',
      'AlreadyReserved()',
      'PositionNotFound()',
      'UnauthorizedOrderBook()',
    ];
    for (const sig of coreNoArg) {
      const sel = ethers.id(sig).slice(0, 10).toLowerCase();
      if (selector === sel) return { kind: 'CoreVaultError', selector, message: sig };
    }
    return { kind: 'Unknown', selector };
  } catch {
    return { kind: 'Unknown', selector };
  }
}

function extractRevertData(err: any): string | null {
  const d =
    err?.data ||
    err?.info?.error?.data ||
    err?.error?.data ||
    err?.receipt?.revertReason ||
    err?.revert?.data;
  if (typeof d === 'string' && d.startsWith('0x')) return d;
  if (typeof d === 'object' && typeof d?.data === 'string' && d.data.startsWith('0x')) return d.data;
  return null;
}

const ALLOWED: Record<string, string> = {
  // Margin-only order methods (spot functions removed)
  metaPlaceMarginLimit: 'metaPlaceMarginLimit',
  metaPlaceMarginMarket: 'metaPlaceMarginMarket',
  metaPlaceMarginMarketWithSlippage: 'metaPlaceMarginMarketWithSlippage',
  metaModifyOrder: 'metaModifyOrder',
  metaCancelOrder: 'metaCancelOrder',
  // Session-based (sign-once) calls - margin only
  sessionPlaceMarginLimit: 'sessionPlaceMarginLimit',
  sessionPlaceMarginMarket: 'sessionPlaceMarginMarket',
  sessionModifyOrder: 'sessionModifyOrder',
  sessionCancelOrder: 'sessionCancelOrder',
};

const PLACE_METHODS = new Set([
  'metaPlaceMarginLimit',
  'metaPlaceMarginMarket',
  'metaPlaceMarginMarketWithSlippage',
  'sessionPlaceMarginLimit',
  'sessionPlaceMarginMarket',
]);

function normalizeSide(isBuy?: boolean): 'BUY' | 'SELL' | null {
  if (typeof isBuy !== 'boolean') return null;
  return isBuy ? 'BUY' : 'SELL';
}

function normalizeOrderType(method: string): 'LIMIT' | 'MARKET' | null {
  if (method.includes('Limit')) return 'LIMIT';
  if (method.includes('Market')) return 'MARKET';
  return null;
}

function safeBigInt(v: any): bigint | null {
  try {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === 'string' && v.trim()) return BigInt(v.trim());
    return null;
  } catch {
    return null;
  }
}

function normalizePriceHuman(priceRaw: any): string | null {
  const bn = safeBigInt(priceRaw);
  if (bn === null) return null;
  try {
    // Prices are sent in USDC 6 decimals from the UI (see TradingPanel: parseUnits(..., 6))
    return ethers.formatUnits(bn, 6);
  } catch {
    return null;
  }
}

function normalizeQtyHuman(amountRaw: any): string | null {
  const bn = safeBigInt(amountRaw);
  if (bn === null) return null;
  try {
    // Amounts are sent in 18 decimals base units from the UI (see TradingPanel: parseUnits(..., 18))
    return ethers.formatUnits(bn, 18);
  } catch {
    return null;
  }
}

async function resolveMarketMetricId(orderBook: string): Promise<string | null> {
  const addr = orderBook.toLowerCase();
  const lookup = async (table: 'orderbook_markets_resolved' | 'orderbook_markets_view') => {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('metric_id')
      // market_address is checksum-cased in views; match case-insensitively
      .ilike('market_address', addr)
      .single();
    if (!error && data?.metric_id) return String(data.metric_id);
    return null;
  };

  const fromResolved = await lookup('orderbook_markets_resolved');
  if (fromResolved) return fromResolved;
  const fromView = await lookup('orderbook_markets_view');
  if (fromView) return fromView;
  return null;
}

async function saveGaslessOrderHistory(payload: {
  method: string;
  orderBook: string;
  txHash: string;
  blockNumber?: number | null;
  isSession: boolean;
  sessionId?: string;
  message?: any;
  params?: any;
}): Promise<void> {
  const { method, orderBook, txHash, blockNumber, isSession, sessionId, message, params } = payload;
  if (!PLACE_METHODS.has(method)) return;

  const trader =
    (params?.trader && ethers.isAddress(params.trader) ? params.trader : null) ||
    (message?.trader && ethers.isAddress(message.trader) ? message.trader : null);

  if (!trader) {
    console.warn('[GASLESS][API][trade] unable to persist history: missing trader', { method, orderBook });
    return;
  }

  const marketMetricId = (await resolveMarketMetricId(orderBook)) || orderBook.toLowerCase();
  const orderType = normalizeOrderType(method);
  const side = normalizeSide(params?.isBuy);
  const orderId = params?.orderId ? String(params.orderId) : `tx:${txHash}`;

  const priceHuman = normalizePriceHuman(params?.price);
  const qtyHuman = normalizeQtyHuman(params?.amount);

  const historyPayload = {
    method,
    orderBook,
    isSession,
    sessionId,
    params: {
      trader,
      price: params?.price ?? null,
      amount: params?.amount ?? null,
      isBuy: typeof params?.isBuy === 'boolean' ? params.isBuy : null,
      orderId: params?.orderId ?? null,
    },
    message: message ? { trader: message?.trader } : null,
    normalized: {
      // stored as strings to avoid JS float rounding; Postgres numeric accepts strings
      price: priceHuman,
      quantity: qtyHuman,
    },
  };

  const { error } = await supabaseAdmin
    .from('userOrderHistory')
    .insert([{
      trader_wallet_address: trader,
      market_metric_id: marketMetricId,
      order_id: orderId,
      tx_hash: txHash,
      block_number: blockNumber ?? 0,
      log_index: 0,
      event_type: 'SUBMITTED',
      side: side ?? undefined,
      order_type: orderType ?? undefined,
      price: priceHuman,
      quantity: qtyHuman,
      filled_quantity: 0,
      status: 'SUBMITTED',
      payload: historyPayload,
      occurred_at: new Date().toISOString(),
    }], { returning: 'minimal' });

  if (error) {
    console.error('[GASLESS][API][trade] failed to persist history', error);
  }
}

function selectorFor(method: string): string | null {
  switch (method) {
    // Margin-only methods (spot functions removed from contract)
    case 'metaPlaceMarginLimit':
      return 'metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginMarket':
      return 'metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginMarketWithSlippage':
      return 'metaPlaceMarginMarketWithSlippage((address,uint256,bool,uint256,uint256,uint256),bytes)';
    case 'metaModifyOrder':
      return 'metaModifyOrder((address,uint256,uint256,uint256,uint256,uint256),bytes)';
    case 'metaCancelOrder':
      return 'metaCancelOrder((address,uint256,uint256,uint256),bytes)';
    case 'sessionPlaceMarginLimit':
      return 'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])';
    case 'sessionPlaceMarginMarket':
      return 'sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])';
    case 'sessionModifyOrder':
      return 'sessionModifyOrder(bytes32,address,uint256,uint256,uint256,bytes32[])';
    case 'sessionCancelOrder':
      return 'sessionCancelOrder(bytes32,address,uint256,bytes32[])';
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const reqStartTime = Date.now();
  const timings: Record<string, number> = {};
  
  const logTiming = (step: string, extra?: Record<string, any>) => {
    const elapsed = Date.now() - reqStartTime;
    timings[step] = elapsed;
    const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[TIMING][trade] +${elapsed}ms | ${step}${extraStr}`);
  };
  
  try {
    logTiming('START');
    
    // --- FAST PATH: Skip expensive checks when GASLESS_FAST_MODE=true ---
    const fastMode = String(process.env.GASLESS_FAST_MODE || '').toLowerCase() === 'true';
    console.log(`[TIMING][trade] fastMode=${fastMode}`);
    
    // --- Skip rate limiting entirely if GASLESS_SKIP_RATE_LIMIT=true (or in fast mode) ---
    const skipRateLimit = fastMode || String(process.env.GASLESS_SKIP_RATE_LIMIT || '').toLowerCase() === 'true';
    
    let circuitStatus = { open: false, reason: null };
    let rateLimitResult = { globalSuccess: true, ipSuccess: true };
    
    if (skipRateLimit) {
      logTiming('rate_limit_skipped');
    } else {
      // --- Circuit breaker check (parallelize with rate limit) ---
      const circuitPromise = isCircuitBreakerOpen();
      
      // --- Rate limiting (run in parallel with circuit breaker) ---
      const forwarded = req.headers.get('x-forwarded-for');
      const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
      const identifier = `gasless:${ip}`;
      
      const rateLimitPromise = (async () => {
        try {
          const [globalResult, ipResult] = await Promise.all([
            gaslessTradeGlobalRateLimit.limit('gasless:global'),
            gaslessTradeRateLimit.limit(identifier),
          ]);
          return { globalSuccess: globalResult.success, ipSuccess: ipResult.success };
        } catch (rateLimitError) {
          console.warn('[GASLESS][API][trade] rate limit check failed, allowing request:', rateLimitError);
          return { globalSuccess: true, ipSuccess: true };
        }
      })();

      // Await both in parallel
      [circuitStatus, rateLimitResult] = await Promise.all([circuitPromise, rateLimitPromise]);
      logTiming('rate_limit_done');
    }
    
    if (circuitStatus.open) {
      console.warn('[GASLESS][API][trade] circuit breaker open', circuitStatus);
      return NextResponse.json(
        { 
          error: 'service_temporarily_unavailable', 
          message: 'Gasless trading is temporarily unavailable. Please try again in a minute.',
          reason: circuitStatus.reason,
          retryAfter: 60 
        },
        { status: 503, headers: { 'Retry-After': '60' } }
      );
    }

    if (!rateLimitResult.globalSuccess) {
      console.warn('[GASLESS][API][trade] global rate limit exceeded');
      return NextResponse.json(
        { error: 'rate_limit_exceeded', message: 'Service is experiencing high traffic. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': '10' } }
      );
    }
    if (!rateLimitResult.ipSuccess) {
      console.warn('[GASLESS][API][trade] rate limit exceeded for', identifier);
      return NextResponse.json(
        { error: 'rate_limit_exceeded', message: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': '30' } }
      );
    }

    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const method: string = body?.method;
    const message = body?.message;
    const signature: string = body?.signature;
    const sessionId: string | undefined = body?.sessionId;
    const params = body?.params;
    logTiming('parsed_body', { orderBook, method, isSession: Boolean(sessionId) && String(method).startsWith('session'), fastMode });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    if (!ALLOWED[method]) {
      return NextResponse.json({ error: 'method not allowed' }, { status: 400 });
    }
    // Legacy meta path expects message + signature
    const isSession = Boolean(sessionId) && String(method).startsWith('session');
    if (!isSession) {
      if (!message || typeof signature !== 'string') {
        return NextResponse.json({ error: 'missing payload' }, { status: 400 });
      }
    }
    logTiming('validation_done');
    
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    if (isSession) {
      if (!registryAddress || !ethers.isAddress(registryAddress)) {
        return NextResponse.json({ error: 'server missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
      }
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    logTiming('provider_created');
    
    // Skip network check and code check in fast mode - these add ~200-400ms
    if (!fastMode) {
      try {
        const net = await provider.getNetwork();
        logTiming('network_check_done');
        console.log('[UpGas][API][trade] provider network', { chainId: String(net.chainId) });
      } catch {}

      try {
        const code = await provider.getCode(orderBook);
        logTiming('code_check_done');
        if (!code || code === '0x') {
          return NextResponse.json(
            { error: 'orderbook_not_deployed', orderBook },
            { status: 400 }
          );
        }
      } catch (codeErr: any) {
        console.warn('[UpGas][API][trade] orderBook code check failed', {
          orderBook,
          error: codeErr?.shortMessage || codeErr?.message || String(codeErr),
        });
      }
    } else {
      logTiming('fast_mode_skipped_checks');
    }
    // Session V2: session is authorized to a relayer *set* (Merkle root) in the registry.
    // Any relayer in our configured keyset can submit, but it must pass a valid Merkle proof.

    const tradeGasLimit = (() => {
      // Margin market orders can be gas-heavy (matching loops + vault accounting + reentrancy sentry).
      // If this is too low, the tx can revert *without a revert reason* due to out-of-gas in an internal call.
      // HyperEVM currently has a 3,000,000 block gas limit; keep a margin below that.
      const DEFAULT_TRADE_GAS_LIMIT = 2_800_000n;
      const raw = String(process.env.GASLESS_TRADE_GAS_LIMIT || '').trim()
      if (!raw) return DEFAULT_TRADE_GAS_LIMIT
      try {
        const n = BigInt(raw)
        return n > 0n ? n : DEFAULT_TRADE_GAS_LIMIT
      } catch {
        return DEFAULT_TRADE_GAS_LIMIT
      }
    })()

    // Gas limit is computed per routed pool (small vs big) after we estimate gas.
    // Initialize to the configured/default value as a fallback.
    let effectiveTradeGasLimit = tradeGasLimit

    // Probe selector presence to avoid opaque "Function does not exist"
    try {
      const enableProbe = String(process.env.GASLESS_PROBE_SELECTORS || 'false').toLowerCase() === 'true';
      if (enableProbe) {
        const sig = selectorFor(method);
        if (sig) {
          const sel = ethers.id(sig).slice(0, 10);
          const loupe = new ethers.Contract(orderBook, ["function facetAddress(bytes4) view returns (address)"], provider);
          const facetAddr = await loupe.facetAddress(sel as any);
          console.log('[GASLESS][API][trade] selector probe', { method, signature: sig, selector: sel, facetAddr });
          console.log('[UpGas][API][trade] selector probe', { method, signature: sig, selector: sel, facetAddr });
          if (!facetAddr || facetAddr === ethers.ZeroAddress) {
            return NextResponse.json({ error: `diamond_missing_selector:${method}`, selector: sel, signature: sig }, { status: 400 });
          }
        }
      }
    } catch (_) {
      // ignore probe errors; proceed to call
    }
    // Call corresponding method (meta or session)
    const stickyKey = isSession ? (params?.trader || sessionId || '') : '';

    // --- Gas estimation + relayer routing (small blocks vs large blocks) ---
    // Goal: route gasless trade to a "big-block" relayer if the tx won't fit in small blocks,
    // without failing first.
    const SMALL_BLOCK_GAS_LIMIT = (() => {
      const raw = String(process.env.HYPEREVM_SMALL_BLOCK_GAS_LIMIT || '').trim();
      if (!raw) return 2_000_000n;
      try { return BigInt(raw); } catch { return 2_000_000n; }
    })();
    const ESTIMATE_BUFFER_BPS = (() => {
      const raw = String(process.env.GASLESS_ESTIMATE_BUFFER_BPS || '').trim();
      if (!raw) return 13000n; // 1.30x
      try {
        const v = BigInt(raw);
        return v >= 10000n && v <= 30000n ? v : 13000n;
      } catch {
        return 13000n;
      }
    })();

    const metaIface = new ethers.Interface((MetaTradeFacet as any).abi);

    const smallKeys = loadRelayerPoolFromEnv({
      pool: 'hub_trade_small',
      jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON',
      indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_SMALL_',
      // Back-compat: allow falling back to RELAYER_PRIVATE_KEYS_JSON / RELAYER_PRIVATE_KEY
      allowFallbackSingleKey: true,
      // Exclude "big" relayer keys - they must never sign session transactions for this pool
      excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'],
    });
    const bigKeys = loadRelayerPoolFromEnv({
      pool: 'hub_trade_big',
      jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON',
      globalJsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON',
      indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_BIG_',
      allowFallbackSingleKey: false,
    });
    const legacyKeys = loadRelayerPoolFromEnv({
      pool: 'hub_trade',
      jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON',
      indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_',
      allowFallbackSingleKey: true,
      // Exclude "big" relayer keys - they must never sign session transactions for this pool
      excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'],
    });

    const hasSmall = smallKeys.length > 0;
    const hasBig = bigKeys.length > 0;
    const estimateFrom = (hasSmall ? smallKeys[0]?.address : legacyKeys[0]?.address) || null;

    let routedPool: 'hub_trade' | 'hub_trade_small' | 'hub_trade_big' = hasSmall ? 'hub_trade_small' : 'hub_trade';
    let estimatedGas: bigint | null = null;
    let estimatedGasBuffered: bigint | null = null;
    let estimatedFromAddress: string | null = estimateFrom;

    logTiming('before_gas_estimate');
    
    // Skip gas estimation in fast mode - use default gas limit
    const skipGasEstimate = fastMode || String(process.env.GASLESS_SKIP_GAS_ESTIMATE || '').toLowerCase() === 'true';
    
    if (!skipGasEstimate && estimateFrom) {
      try {
        let data: string | null = null;
        if (isSession) {
          // Need a proof for the "from" address, otherwise estimateGas may revert on relayer checks.
          const globalKeys = loadRelayerPoolFromEnv({
            pool: 'global',
            globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
            allowFallbackSingleKey: true,
          });
          const relayerAddrs = globalKeys.map((k) => ethers.getAddress(k.address));
          const proof = computeRelayerProof(relayerAddrs, estimateFrom);

          const args =
            method === 'sessionPlaceMarginLimit'
              ? [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, proof]
              : method === 'sessionPlaceMarginMarket'
              ? [sessionId, params?.trader, params?.amount, params?.isBuy, proof]
              : method === 'sessionModifyOrder'
              ? [sessionId, params?.trader, params?.orderId, params?.price, params?.amount, proof]
              : method === 'sessionCancelOrder'
              ? [sessionId, params?.trader, params?.orderId, proof]
              : [];
          data = metaIface.encodeFunctionData(method, args as any);
        } else {
          // Legacy meta path
          data = metaIface.encodeFunctionData(method, [message, signature] as any);
        }

        if (data) {
          estimatedGas = await provider.estimateGas({ from: estimateFrom, to: orderBook, data } as any);
          logTiming('gas_estimate_done');
          estimatedGasBuffered = (estimatedGas * ESTIMATE_BUFFER_BPS) / 10000n;
          if (estimatedGasBuffered > SMALL_BLOCK_GAS_LIMIT && hasBig) {
            routedPool = 'hub_trade_big';
          } else if (hasSmall) {
            routedPool = 'hub_trade_small';
          } else {
            routedPool = 'hub_trade';
          }
          console.log('[UpGas][API][trade] estimateGas routing', {
            method,
            isSession,
            estimatedGas: estimatedGas.toString(),
            buffered: estimatedGasBuffered.toString(),
            bufferBps: ESTIMATE_BUFFER_BPS.toString(),
            smallBlockLimit: SMALL_BLOCK_GAS_LIMIT.toString(),
            estimateFrom,
            routedPool,
          });
        }
      } catch (e: any) {
        logTiming('gas_estimate_failed');
        console.warn('[UpGas][API][trade] estimateGas failed; using default pool', {
          method,
          error: e?.shortMessage || e?.message || String(e),
          estimateFrom,
        });
      }
    } else {
      logTiming('gas_estimate_skipped');
    }

    function isBlockGasLimitError(err: any): boolean {
      const msg = String(err?.shortMessage || err?.reason || err?.message || err || '').toLowerCase();
      return (
        msg.includes('exceeds block gas limit') ||
        msg.includes('block gas limit') ||
        msg.includes('transaction gas limit exceeds') ||
        msg.includes('gas limit too high') ||
        msg.includes('intrinsic gas too low')
      );
    }

    const BIG_BLOCK_GAS_LIMIT = (() => {
      const raw = String(process.env.HYPEREVM_BIG_BLOCK_GAS_LIMIT || '').trim();
      if (!raw) return 30_000_000n;
      try { return BigInt(raw); } catch { return 30_000_000n; }
    })();

    function computeGasLimitForPool(pool: 'hub_trade' | 'hub_trade_small' | 'hub_trade_big'): bigint {
      // Use estimate when available; otherwise use configured tradeGasLimit.
      const desired = (estimatedGasBuffered && estimatedGasBuffered > 0n)
        ? (estimatedGasBuffered + 50_000n)
        : tradeGasLimit;

      // Safety headroom so we don't request the entire block.
      const safetySmall = 120_000n;
      const safetyBig = 300_000n;

      if (pool === 'hub_trade_big') {
        const cap = BIG_BLOCK_GAS_LIMIT > safetyBig ? (BIG_BLOCK_GAS_LIMIT - safetyBig) : BIG_BLOCK_GAS_LIMIT;
        return cap > 0n && desired > cap ? cap : desired;
      }
      if (pool === 'hub_trade_small') {
        const cap = SMALL_BLOCK_GAS_LIMIT > safetySmall ? (SMALL_BLOCK_GAS_LIMIT - safetySmall) : SMALL_BLOCK_GAS_LIMIT;
        return cap > 0n && desired > cap ? cap : desired;
      }
      // Legacy pool: cap against small-block limit by default (safe).
      const cap = SMALL_BLOCK_GAS_LIMIT > safetySmall ? (SMALL_BLOCK_GAS_LIMIT - safetySmall) : SMALL_BLOCK_GAS_LIMIT;
      return cap > 0n && desired > cap ? cap : desired;
    }

    const sendWithPool = async (pool: 'hub_trade' | 'hub_trade_small' | 'hub_trade_big') => {
      const sendPoolStart = Date.now();
      // IMPORTANT: Set gasLimit according to the target pool before sending.
      effectiveTradeGasLimit = computeGasLimitForPool(pool);
      console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | sendWithPool(${pool}) START`, {
        gasLimit: effectiveTradeGasLimit.toString(),
      });
      
      return await withRelayer({
        pool,
        provider,
        stickyKey,
        action: async (wallet) => {
        const actionStart = Date.now();
        console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | withRelayer action START (${actionStart - sendPoolStart}ms into sendWithPool)`);
        
        const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, wallet);
        if (isSession) {
          if (!sessionId || typeof sessionId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
            throw new HttpError(400, { error: 'invalid_session_id' });
          }
          if (!params?.trader || !ethers.isAddress(params.trader)) {
            throw new HttpError(400, { error: 'invalid_trader' });
          }
          // Basic numeric shape checks (keep permissive; on-chain checks still apply)
          if (
            (method === 'sessionPlaceMarginLimit' || method === 'sessionModifyOrder') &&
            (params?.price === undefined || params?.price === null)
          ) {
            throw new HttpError(400, { error: 'missing_price' });
          }
          if (
            (method === 'sessionPlaceMarginLimit' || method === 'sessionPlaceMarginMarket' || method === 'sessionModifyOrder') &&
            (params?.amount === undefined || params?.amount === null)
          ) {
            throw new HttpError(400, { error: 'missing_amount' });
          }

          // Compute Merkle proof for this relayer wallet address against the configured relayer set.
          const keys = loadRelayerPoolFromEnv({
            pool: 'global',
            globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
            allowFallbackSingleKey: true,
          });
          const relayerAddrs = keys.map((k) => ethers.getAddress(k.address));
          const relayerProof = computeRelayerProof(relayerAddrs, wallet.address);
          console.log('[UpGas][API][trade] session path selected', { method, sessionId, params, relayer: wallet.address, proofLen: relayerProof.length });

          // On-chain diagnostics (helps when RPC omits revert data, producing "missing revert data")
          // SKIP in fast mode - these checks add 300-600ms of RPC latency
          if (!fastMode) {
            try {
              const registry = new ethers.Contract(registryAddress!, (GlobalSessionRegistry as any).abi, provider);
              // OPTIMIZATION: Run all 3 RPC calls in parallel instead of sequentially
              const [s, allowed, proofOk] = await Promise.all([
                registry.sessions(sessionId),
                registry.allowedOrderbook(orderBook),
                registry.isRelayerAllowed(sessionId, wallet.address, relayerProof),
              ]);
              const traderOnchain = String(s?.trader || ethers.ZeroAddress);
              const expiryOnchain = Number(s?.expiry || 0);
              const revokedOnchain = Boolean(s?.revoked);
              const maxNotionalPerTradeOnchain = BigInt(s?.maxNotionalPerTrade ?? 0);
              const maxNotionalPerSessionOnchain = BigInt(s?.maxNotionalPerSession ?? 0);
              const sessionNotionalUsedOnchain = BigInt(s?.sessionNotionalUsed ?? 0);
              const methodsBitmapOnchain = String(s?.methodsBitmap || ethers.ZeroHash);

              const now = Math.floor(Date.now() / 1000);
              const traderMatches =
                traderOnchain &&
                traderOnchain !== ethers.ZeroAddress &&
                traderOnchain.toLowerCase() === String(params.trader).toLowerCase();

              console.log('[UpGas][API][trade] session diagnostics', {
                sessionId,
                traderOnchain,
                traderParam: params.trader,
                traderMatches,
                expiryOnchain,
                now,
                revokedOnchain,
                maxNotionalPerTrade: maxNotionalPerTradeOnchain.toString(),
                maxNotionalPerSession: maxNotionalPerSessionOnchain.toString(),
                sessionNotionalUsed: sessionNotionalUsedOnchain.toString(),
                methodsBitmap: methodsBitmapOnchain,
                allowedOrderbook: Boolean(allowed),
                relayer: wallet.address,
                proofOk: Boolean(proofOk),
                proofLen: relayerProof.length,
              });

              if (traderOnchain === ethers.ZeroAddress) {
                throw new HttpError(400, { error: 'session_unknown', sessionId });
              }
              if (!traderMatches) {
                throw new HttpError(400, { error: 'session_bad_trader', expected: traderOnchain, got: params.trader });
              }
              if (revokedOnchain) {
                throw new HttpError(400, { error: 'session_revoked', sessionId });
              }
              if (expiryOnchain > 0 && now > expiryOnchain) {
                throw new HttpError(400, { error: 'session_expired', sessionId, now, expiry: expiryOnchain });
              }
              if (!allowed) {
                throw new HttpError(400, { error: 'session_orderbook_not_allowed', orderBook, registry: registryAddress });
              }
              if (!proofOk) {
                throw new HttpError(400, { error: 'session_bad_relayer', relayer: wallet.address, proofLen: relayerProof.length });
              }

              // Session policy checks (so we can fail fast with a useful error instead of a revert-without-data)
              // Margin-only method bits (spot functions removed from contract)
              const methodBitIndex =
                method === 'sessionPlaceMarginLimit'
                  ? 1n
                  : method === 'sessionPlaceMarginMarket'
                  ? 3n
                  : method === 'sessionModifyOrder'
                  ? 4n
                  : method === 'sessionCancelOrder'
                  ? 5n
                  : null;
              if (methodBitIndex !== null) {
                const bitmap = BigInt(methodsBitmapOnchain);
                const allowedByBitmap = (bitmap & (1n << methodBitIndex)) !== 0n;
                if (!allowedByBitmap) {
                  throw new HttpError(400, {
                    error: 'session_method_denied',
                    method,
                    methodBitIndex: methodBitIndex.toString(),
                    methodsBitmap: methodsBitmapOnchain,
                  });
                }
              }

              // Notional caps: registry uses "notional" computed by MetaTradeFacet: amount * price / 1e18 (6 decimals)
              const notional6 =
                method === 'sessionCancelOrder'
                  ? 0n
                  : method === 'sessionPlaceMarginMarket'
                  ? 0n // market notional depends on book ref price; registry still enforces it at execution time
                  : (() => {
                      const price = parseBigintish(params?.price, 'price');
                      const amount = parseBigintish(params?.amount, 'amount');
                      return (amount * price) / 1_000_000_000_000_000_000n;
                    })();

              if (maxNotionalPerTradeOnchain > 0n && notional6 > maxNotionalPerTradeOnchain) {
                throw new HttpError(400, {
                  error: 'session_trade_cap',
                  notional6: notional6.toString(),
                  maxNotionalPerTrade: maxNotionalPerTradeOnchain.toString(),
                });
              }
              if (maxNotionalPerSessionOnchain > 0n && sessionNotionalUsedOnchain + notional6 > maxNotionalPerSessionOnchain) {
                throw new HttpError(400, {
                  error: 'session_session_cap',
                  notional6: notional6.toString(),
                  sessionNotionalUsed: sessionNotionalUsedOnchain.toString(),
                  maxNotionalPerSession: maxNotionalPerSessionOnchain.toString(),
                });
              }
            } catch (diagErr: any) {
              if (diagErr instanceof HttpError) throw diagErr;
              console.warn('[UpGas][API][trade] session diagnostics failed', {
                method,
                error: diagErr?.reason || diagErr?.shortMessage || diagErr?.message || String(diagErr),
              });
            }
          }

          // Orderbook/vault prechecks for margin orders (gives a useful error even when RPC omits revert data)
          // SKIP in fast mode - these checks add 1000-2000ms of RPC latency (10+ sequential calls)
          if (!fastMode && (method === 'sessionPlaceMarginLimit' || method === 'sessionPlaceMarginMarket')) {
            try {
              const view = new ethers.Contract(
                orderBook,
                [
                  'function getLeverageInfo() view returns (bool enabled,uint256 maxLev,uint256 marginReq,address controller)',
                  'function getFeeStructure() view returns (uint256 takerFeeBps,uint256 makerFeeBps,address protocolFeeRecipient,uint256 protocolFeeShareBps,uint256 legacyTradingFee,address marketOwnerFeeRecipient)',
                  'function marketStatic() view returns (address vault,bytes32 marketId,bool useVWAP,uint256 vwapWindow)',
                  'function bestBid() view returns (uint256)',
                  'function bestAsk() view returns (uint256)',
                  'function buyLevels(uint256 price) view returns (tuple(uint256 totalAmount,uint256 firstOrderId,uint256 lastOrderId,bool exists))',
                  'function sellLevels(uint256 price) view returns (tuple(uint256 totalAmount,uint256 firstOrderId,uint256 lastOrderId,bool exists))',
                  'function getOrder(uint256 orderId) view returns (tuple(uint256 orderId,address trader,uint256 price,uint256 amount,bool isBuy,uint256 timestamp,uint256 nextOrderId,uint256 marginRequired,bool isMarginOrder))',
                ],
                provider
              );
              
              // OPTIMIZATION: Parallelize initial view calls
              const [leverageResult, feeResult, marketResult, bestBidResult, bestAskResult] = await Promise.all([
                view.getLeverageInfo(),
                view.getFeeStructure().catch(() => [0n, 0n, null, 0n, 0n]),
                view.marketStatic(),
                view.bestBid(),
                view.bestAsk(),
              ]);
              
              const [enabled, maxLev, marginReq] = leverageResult;
              const [takerFeeBps, makerFeeBps, , , legacyTradingFee] = feeResult;
              const [vaultAddr, marketId] = marketResult;
              const bestBid = BigInt(bestBidResult);
              const bestAsk = BigInt(bestAskResult);
              
              let estimatedFeeBps = 0n;
              try {
                const taker = BigInt(takerFeeBps);
                const maker = BigInt(makerFeeBps);
                const legacy = BigInt(legacyTradingFee);
                estimatedFeeBps = (taker > 0n || maker > 0n) ? (taker > maker ? taker : maker) : legacy;
              } catch (_feeErr) {}

              const vault = new ethers.Contract(
                vaultAddr,
                [
                  'function marketSettled(bytes32 marketId) view returns (bool)',
                  'function getAvailableCollateral(address user) view returns (uint256)',
                  'function marketToOrderBook(bytes32 marketId) view returns (address)',
                  'function hasRole(bytes32 role, address account) view returns (bool)',
                  'function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)',
                ],
                provider
              );

              // OPTIMIZATION: Parallelize vault checks
              const ORDERBOOK_ROLE = ethers.id('ORDERBOOK_ROLE');
              const [settled, assignedOb, hasOrderbookRole, available6Raw] = await Promise.all([
                vault.marketSettled(marketId),
                vault.marketToOrderBook(marketId),
                vault.hasRole(ORDERBOOK_ROLE, orderBook),
                vault.getAvailableCollateral.staticCall(params.trader),
              ]);
              
              if (settled) throw new HttpError(400, { error: 'ob_settled', marketId });

              if (!assignedOb || String(assignedOb) === ethers.ZeroAddress) {
                throw new HttpError(400, { error: 'vault_market_not_assigned', marketId, vault: vaultAddr });
              }
              if (String(assignedOb).toLowerCase() !== String(orderBook).toLowerCase()) {
                throw new HttpError(400, {
                  error: 'vault_market_assigned_to_other_orderbook',
                  marketId,
                  vault: vaultAddr,
                  assignedOrderBook: assignedOb,
                  requestedOrderBook: orderBook,
                });
              }

              if (!hasOrderbookRole) {
                throw new HttpError(400, {
                  error: 'vault_orderbook_role_missing',
                  vault: vaultAddr,
                  orderBook,
                  role: ORDERBOOK_ROLE,
                });
              }

              if (!(Boolean(enabled) || BigInt(marginReq) === 10000n)) {
                throw new HttpError(400, {
                  error: 'margin_not_enabled',
                  leverageEnabled: Boolean(enabled),
                  marginRequirementBps: marginReq?.toString?.() ?? String(marginReq),
                  maxLev: maxLev?.toString?.() ?? String(maxLev),
                });
              }

              const isBuy = Boolean(params?.isBuy);
              let price: bigint;
              if (method === 'sessionPlaceMarginMarket') {
                const refPrice = isBuy ? bestAsk : bestBid;
                if (refPrice <= 0n) {
                  throw new HttpError(400, { error: 'ob_no_liquidity_for_market', side: isBuy ? 'buy' : 'sell' });
                }
                price = refPrice;
                if (params && (params.price === undefined || params.price === null || params.price === '0' || params.price === 0)) {
                  params.price = refPrice.toString();
                }
              } else {
                price = parseBigintish(params?.price, 'price');
              }
              const amount = parseBigintish(params?.amount, 'amount');
              if (price <= 0n) throw new HttpError(400, { error: 'price_must_be_gt_0' });
              if (amount <= 0n) throw new HttpError(400, { error: 'amount_must_be_gt_0' });

              // Crossing check - uses already-fetched bestBid/bestAsk
              const crosses = isBuy ? (bestAsk > 0n && bestAsk <= price) : (bestBid > 0n && bestBid >= price);
              if (crosses) {
                // Only do expensive order-level checks if actually crossing
                try {
                  if (!isBuy && bestBid > 0n && bestBid >= price) {
                    const lvl: any = await view.buyLevels(bestBid);
                    const firstId = BigInt(lvl?.firstOrderId ?? 0);
                    if (firstId > 0n) {
                      const top: any = await view.getOrder(firstId);
                      if (!Boolean(top?.isMarginOrder)) {
                        throw new HttpError(400, {
                          error: 'crosses_spot_liquidity',
                          side: 'sell',
                          limitPrice: price.toString(),
                          bestBid: bestBid.toString(),
                          topOrderId: firstId.toString(),
                          topOrderIsMargin: false,
                        });
                      }
                    }
                  }
                  if (isBuy && bestAsk > 0n && bestAsk <= price) {
                    const lvl: any = await view.sellLevels(bestAsk);
                    const firstId = BigInt(lvl?.firstOrderId ?? 0);
                    if (firstId > 0n) {
                      const top: any = await view.getOrder(firstId);
                      if (!Boolean(top?.isMarginOrder)) {
                        throw new HttpError(400, {
                          error: 'crosses_spot_liquidity',
                          side: 'buy',
                          limitPrice: price.toString(),
                          bestAsk: bestAsk.toString(),
                          topOrderId: firstId.toString(),
                          topOrderIsMargin: false,
                        });
                      }
                    }
                  }
                } catch (crossErr: any) {
                  if (crossErr instanceof HttpError) throw crossErr;
                }
              }

              // Position-aware margin check
              let effectiveAmount = amount < 1_000_000_000_000n ? 1_000_000_000_000n : amount;
              try {
                const [posSize] = await vault.getPositionSummary.staticCall(params.trader, marketId);
                const currentNet = BigInt(posSize as any);
                const isReducing = (currentNet > 0n && !isBuy) || (currentNet < 0n && isBuy);
                if (isReducing) {
                  const absCurrentSize = currentNet >= 0n ? currentNet : -currentNet;
                  effectiveAmount = effectiveAmount <= absCurrentSize ? 0n : effectiveAmount - absCurrentSize;
                }
              } catch (_posErr) {}

              const fullNotional6 = (amount * price) / 1_000_000_000_000_000_000n;
              const estimatedFee6 = estimatedFeeBps > 0n ? (fullNotional6 * estimatedFeeBps) / 10000n : 0n;
              const notional6 = (effectiveAmount * price) / 1_000_000_000_000_000_000n;
              const marginBps = isBuy ? BigInt(marginReq) : 15000n;
              const marginRequired6 = (notional6 * marginBps) / 10000n;
              const totalRequired6 = marginRequired6 + estimatedFee6;
              const available6 = BigInt(available6Raw);

              if (available6 < totalRequired6) {
                throw new HttpError(400, {
                  error: 'insufficient_collateral',
                  available6: available6.toString(),
                  required6: totalRequired6.toString(),
                  marginRequired6: marginRequired6.toString(),
                  estimatedFee6: estimatedFee6.toString(),
                  notional6: notional6.toString(),
                  marginBps: marginBps.toString(),
                });
              }
            } catch (preErr: any) {
              if (preErr instanceof HttpError) throw preErr;
              console.warn('[UpGas][API][trade] margin precheck failed (non-fatal)', {
                method,
                error: preErr?.reason || preErr?.shortMessage || preErr?.message || String(preErr),
              });
            }
          }

          // Preflight eth_call to get a readable revert when available (some RPCs omit revert data on estimateGas)
          // SKIP in fast mode - this duplicates work and adds ~200-500ms
          if (!fastMode) {
            try {
              const fn = (meta as any)[method]
              if (typeof fn === 'function') {
                await fn.staticCall?.(
                  ...(method === 'sessionPlaceMarginLimit'
                    ? [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof]
                    : method === 'sessionPlaceMarginMarket'
                    ? [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof]
                    : method === 'sessionModifyOrder'
                    ? [sessionId, params?.trader, params?.orderId, params?.price, params?.amount, relayerProof]
                    : method === 'sessionCancelOrder'
                    ? [sessionId, params?.trader, params?.orderId, relayerProof]
                    : [])
                )
              }
            } catch (pre: any) {
            const data = extractRevertData(pre);
            const decoded = data ? decodeRevertData(data) : null;
            const decodedMsg = decoded?.message || decoded?.kind || null;
            const rawMsg = pre?.reason || pre?.shortMessage || pre?.message || String(pre);
            // Log for observability
            console.warn('[UpGas][API][trade] session preflight failed', {
              method,
              error: rawMsg,
              code: pre?.code,
              hasData: Boolean(data),
              dataSelector: decoded?.selector,
              decoded: decodedMsg,
              rpcMsg: pre?.info?.error?.message,
            });

            // Fail fast for cancel/modify when order is known to not exist (avoids broadcasting a tx that will revert).
            const orderNotFoundMsg =
              decodedMsg && String(decodedMsg).toLowerCase().includes('order does not exist');
            if (
              orderNotFoundMsg &&
              (method === 'sessionCancelOrder' || method === 'sessionModifyOrder')
            ) {
              throw new HttpError(400, {
                error: 'order_not_found',
                message: decodedMsg || 'Order does not exist',
              });
            }

            // Log only for other preflight failures; do not fail the session path.
            // Some RPCs can be flaky here and we'd rather rely on the mined receipt when configured.
            }
          } // end if (!fastMode) for preflight
          
          console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | 🎯 ABOUT TO CALL SMART CONTRACT - method=${method} (${Date.now() - actionStart}ms into action)`);
          
          switch (method) {
            // Margin-only session methods (spot functions removed)
            case 'sessionPlaceMarginLimit':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceMarginLimit',
                args: [sessionId, params?.trader, params?.price, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: effectiveTradeGasLimit },
              });
            case 'sessionPlaceMarginMarket':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionPlaceMarginMarket',
                args: [sessionId, params?.trader, params?.amount, params?.isBuy, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: effectiveTradeGasLimit },
              });
            case 'sessionModifyOrder':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionModifyOrder',
                args: [sessionId, params?.trader, params?.orderId, params?.price, params?.amount, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: effectiveTradeGasLimit },
              });
            case 'sessionCancelOrder':
              return await sendWithNonceRetry({
                provider,
                wallet,
                contract: meta,
                method: 'sessionCancelOrder',
                args: [sessionId, params?.trader, params?.orderId, relayerProof],
                label: `trade:${method}`,
                overrides: { gasLimit: effectiveTradeGasLimit },
              });
            default:
              throw new Error('method not allowed');
          }
        }

          console.log('[UpGas][API][trade] legacy meta path selected', { method, hasMessage: !!message, hasSignature: typeof signature === 'string' });
          switch (method) {
            // Margin-only meta methods (spot functions removed)
            case 'metaPlaceMarginLimit':
              return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarginLimit', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: effectiveTradeGasLimit } });
            case 'metaPlaceMarginMarket':
              return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarginMarket', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: effectiveTradeGasLimit } });
            case 'metaPlaceMarginMarketWithSlippage':
              return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaPlaceMarginMarketWithSlippage', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: effectiveTradeGasLimit } });
            case 'metaModifyOrder':
              return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaModifyOrder', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: effectiveTradeGasLimit } });
            case 'metaCancelOrder':
              return await sendWithNonceRetry({ provider, wallet, contract: meta, method: 'metaCancelOrder', args: [message, signature], label: `trade:${method}`, overrides: { gasLimit: effectiveTradeGasLimit } });
            default:
              throw new Error('method not allowed');
          }
        }
      });
    };

    logTiming('before_send_tx');
    
    let reroutedToBig = false;
    let tx: ethers.TransactionResponse;
    try {
      console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | 🚀 CALLING sendWithPool(${routedPool}) NOW`);
      tx = await sendWithPool(routedPool);
      logTiming('tx_broadcasted', { txHash: tx.hash });
      console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | ✅ TX HASH RECEIVED: ${tx.hash}`);
    } catch (sendErr: any) {
      logTiming('send_failed');
      const canRetryToBig = hasBig && routedPool !== 'hub_trade_big' && isBlockGasLimitError(sendErr);
      if (!canRetryToBig) throw sendErr;
      console.warn('[UpGas][API][trade] retrying via big-block relayer due to block gas limit error', {
        method,
        prevPool: routedPool,
        error: sendErr?.shortMessage || sendErr?.message || String(sendErr),
      });
      reroutedToBig = true;
      routedPool = 'hub_trade_big';
      tx = await sendWithPool('hub_trade_big');
      logTiming('tx_broadcasted_retry');
    }
    
    logTiming('before_history_persist');
    
    // Persist *placement* history only.
    // IMPORTANT: cancellation must never depend on Supabase history writes.
    if (PLACE_METHODS.has(method)) {
      try {
        await saveGaslessOrderHistory({
          method,
          orderBook,
          txHash: tx.hash,
          blockNumber: null,
          isSession,
          sessionId,
          message,
          params,
        });
        logTiming('history_persisted');
      } catch (err) {
        logTiming('history_persist_failed');
        console.error('[GASLESS][API][trade] history persist exception', err);
      }
    } else {
      logTiming('history_skipped');
    }
    // Configurable wait policy to reduce perceived latency
    const isCancelMethod = method === 'sessionCancelOrder' || method === 'metaCancelOrder';
    const waitConfirms = Number(process.env.GASLESS_TRADE_WAIT_CONFIRMS ?? '0');
    if (Number.isFinite(waitConfirms) && waitConfirms > 0) {
      const rc = await provider.waitForTransaction(tx.hash, waitConfirms);
      const status = (rc as any)?.status;
      console.log('[GASLESS][API][trade] relayed', { txHash: tx.hash, blockNumber: rc?.blockNumber, status });
      console.log('[UpGas][API][trade] relayed', { txHash: tx.hash, blockNumber: rc?.blockNumber, status });
      if (typeof status === 'number' && status === 0) {
        // If the tx reverted due to out-of-gas / block constraints on the small relayer,
        // automatically retry via the big-block relayer instead of surfacing an error to the user.
        try {
          const enableRetry = String(process.env.GASLESS_RETRY_BIG_ON_REVERT || 'true').toLowerCase() === 'true';
          if (enableRetry && hasBig && routedPool !== 'hub_trade_big') {
            const txObj: any = await provider.getTransaction(tx.hash);
            const gasLimit = txObj?.gasLimit ? BigInt(txObj.gasLimit.toString()) : 0n;
            const gasUsed = (rc as any)?.gasUsed ? BigInt((rc as any).gasUsed.toString()) : 0n;
            const nearLimit = gasLimit > 0n && gasUsed > 0n && gasUsed + 25_000n >= gasLimit;
            const likelyTooBigForSmall =
              (estimatedGasBuffered !== null && estimatedGasBuffered > SMALL_BLOCK_GAS_LIMIT) || nearLimit;
            if (likelyTooBigForSmall) {
              console.warn('[UpGas][API][trade] tx reverted; retrying via big-block relayer', {
                method,
                prevPool: routedPool,
                txHash: tx.hash,
                gasUsed: gasUsed.toString(),
                gasLimit: gasLimit.toString(),
                estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
              });
              reroutedToBig = true;
              routedPool = 'hub_trade_big';
              const tx2 = await sendWithPool('hub_trade_big');
              return NextResponse.json({
                txHash: tx2.hash,
                pending: true,
                estimatedGas: estimatedGas ? estimatedGas.toString() : null,
                estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
                routedPool,
                estimatedFromAddress,
                reroutedToBig,
                retryReason: 'revert_retry_big',
                previousTxHash: tx.hash,
              });
            }
          }
        } catch (retryErr: any) {
          console.warn('[UpGas][API][trade] revert retry failed', retryErr?.shortMessage || retryErr?.message || String(retryErr));
        }
        return NextResponse.json(
          { error: 'tx_reverted', txHash: tx.hash, blockNumber: rc?.blockNumber },
          { status: 500 }
        );
      }
      return NextResponse.json({
        txHash: tx.hash,
        blockNumber: rc?.blockNumber,
        mined: true,
        estimatedGas: estimatedGas ? estimatedGas.toString() : null,
        estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
        routedPool,
        estimatedFromAddress,
        reroutedToBig,
      });
    }

    logTiming('before_poll_check');
    
    // Optional short polling window for fast revert detection without waiting for confirmations.
    // For cancel methods we default to 0 so the client gets txHash immediately for optimistic UI;
    // set GASLESS_TRADE_POLL_RECEIPT_MS to poll for receipt if desired.
    const pollMsRaw = String(process.env.GASLESS_TRADE_POLL_RECEIPT_MS ?? '').trim();
    let pollMs = pollMsRaw ? Number(pollMsRaw) : 0;
    // Cancels: no default poll so we return right after broadcast (client removes order on txHash for slick UX).
    if (isCancelMethod && !(Number.isFinite(pollMs) && pollMs > 0)) {
      pollMs = 0;
    }
    // Placements: default to a short poll window (unless explicitly disabled) so we can surface immediate reverts.
    // IN FAST MODE: Skip polling entirely
    if (!isCancelMethod && !pollMsRaw && !fastMode) {
      pollMs = 7000;
    }
    console.log(`[TIMING][trade] +${Date.now() - reqStartTime}ms | poll_config: pollMs=${pollMs}, fastMode=${fastMode}, isCancelMethod=${isCancelMethod}`);
    if (Number.isFinite(pollMs) && pollMs > 0) {
      const deadline = Date.now() + pollMs;
      let lastRc: any = null;
      while (Date.now() < deadline) {
        try {
          const rc = await provider.getTransactionReceipt(tx.hash);
          if (rc) {
            lastRc = rc as any;
            break;
          }
        } catch {
          // ignore transient receipt fetch errors
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (lastRc) {
        const status = (lastRc as any)?.status;
        console.log('[UpGas][API][trade] polled receipt', { txHash: tx.hash, blockNumber: lastRc?.blockNumber, status });
        if (typeof status === 'number' && status === 0) {
          // Same retry-to-big logic as above for fast-revert polling path.
          try {
            const enableRetry = String(process.env.GASLESS_RETRY_BIG_ON_REVERT || 'true').toLowerCase() === 'true';
            if (enableRetry && hasBig && routedPool !== 'hub_trade_big') {
              const txObj: any = await provider.getTransaction(tx.hash);
              const gasLimit = txObj?.gasLimit ? BigInt(txObj.gasLimit.toString()) : 0n;
              const gasUsed = (lastRc as any)?.gasUsed ? BigInt((lastRc as any).gasUsed.toString()) : 0n;
              const nearLimit = gasLimit > 0n && gasUsed > 0n && gasUsed + 25_000n >= gasLimit;
              const likelyTooBigForSmall =
                (estimatedGasBuffered !== null && estimatedGasBuffered > SMALL_BLOCK_GAS_LIMIT) || nearLimit;
              if (likelyTooBigForSmall) {
                console.warn('[UpGas][API][trade] polled revert; retrying via big-block relayer', {
                  method,
                  prevPool: routedPool,
                  txHash: tx.hash,
                  gasUsed: gasUsed.toString(),
                  gasLimit: gasLimit.toString(),
                  estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
                });
                reroutedToBig = true;
                routedPool = 'hub_trade_big';
                const tx2 = await sendWithPool('hub_trade_big');
                return NextResponse.json({
                  txHash: tx2.hash,
                  pending: true,
                  estimatedGas: estimatedGas ? estimatedGas.toString() : null,
                  estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
                  routedPool,
                  estimatedFromAddress,
                  reroutedToBig,
                  retryReason: 'polled_revert_retry_big',
                  previousTxHash: tx.hash,
                });
              }
            }
          } catch (retryErr: any) {
            console.warn('[UpGas][API][trade] polled revert retry failed', retryErr?.shortMessage || retryErr?.message || String(retryErr));
          }
          return NextResponse.json(
            { error: 'tx_reverted', txHash: tx.hash, blockNumber: lastRc?.blockNumber },
            { status: 500 }
          );
        }
        return NextResponse.json({
          txHash: tx.hash,
          blockNumber: lastRc?.blockNumber,
          mined: true,
          estimatedGas: estimatedGas ? estimatedGas.toString() : null,
          estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
          routedPool,
          estimatedFromAddress,
          reroutedToBig,
        });
      }
    }
    logTiming('RESPONSE');
    const totalElapsedMs = Date.now() - reqStartTime;
    console.log('[GASLESS][API][trade] broadcasted', { txHash: tx.hash, waitConfirms, totalElapsedMs, fastMode });
    console.log('[UpGas][API][trade] broadcasted', { txHash: tx.hash, waitConfirms, totalElapsedMs, fastMode });
    console.log('[TIMING][trade] FINAL TIMINGS:', JSON.stringify(timings));
    return NextResponse.json({
      txHash: tx.hash,
      pending: true,
      estimatedGas: estimatedGas ? estimatedGas.toString() : null,
      estimatedGasBuffered: estimatedGasBuffered ? estimatedGasBuffered.toString() : null,
      routedPool,
      estimatedFromAddress,
      reroutedToBig,
      serverElapsedMs: totalElapsedMs,
      fastMode,
      timings,
    });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    if (isInsufficientFundsError(e) || String(e?.message || '').includes('insufficient funds for gas')) {
      console.error('[GASLESS][API][trade] all relayers out of funds', e?.message || e);
      // Trip circuit breaker to prevent further spam while relayers are empty
      await tripCircuitBreaker('all_relayers_out_of_funds');
      console.warn('[GASLESS][API][trade] circuit breaker tripped - relayers out of funds');
      return NextResponse.json(
        { 
          error: 'all_relayers_insufficient_funds', 
          message: 'All relayers in the pool have insufficient gas funds. Please try again later.',
          retryAfter: 60
        },
        { status: 503, headers: { 'Retry-After': '60' } }
      );
    }
    console.error('[GASLESS][API][trade] error', e?.message || e);
    console.error('[UpGas][API][trade] error', e?.stack || e?.message || String(e));
    return NextResponse.json({ error: e?.message || 'relay failed' }, { status: 500 });
  }
}


