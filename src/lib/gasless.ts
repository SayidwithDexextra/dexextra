import { CHAIN_CONFIG } from './contractConfig';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';
import { getActiveEthereumProvider, type EthereumProvider } from '@/lib/wallet';

type Hex = `0x${string}`;

type ChainCheckResult = { ok: true } | { ok: false; error: string };

const TARGET_CHAIN_ID = Number(CHAIN_CONFIG.chainId || 0);
const TARGET_CHAIN_HEX = `0x${TARGET_CHAIN_ID.toString(16)}`;

function getWalletProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return (getActiveEthereumProvider() ?? (window as any)?.ethereum ?? null) as any;
}

async function ensureCorrectChain(ethereum: EthereumProvider): Promise<ChainCheckResult> {
  let activeChainId: number | null = null;

  try {
    const active = await ethereum.request({ method: 'eth_chainId' });
    if (typeof active === 'string') {
      activeChainId = parseInt(active, 16);
    }
    if (activeChainId === TARGET_CHAIN_ID) {
      return { ok: true };
    }
  } catch {
    // Fallback to switch attempt below
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: TARGET_CHAIN_HEX }],
    });
    return { ok: true };
  } catch (switchErr: any) {
    if (switchErr?.code === 4902) {
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: TARGET_CHAIN_HEX,
            chainName: 'Hyperliquid Mainnet',
            rpcUrls: [CHAIN_CONFIG.rpcUrl].filter(Boolean),
            nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
          }],
        });
        return { ok: true };
      } catch (addErr: any) {
        return {
          ok: false,
          error: 'Add Hyperliquid Mainnet (chainId 999) to your wallet, then retry.',
        };
      }
    }

    const activeText = activeChainId
      ? `Current chainId is ${activeChainId}.`
      : 'Current chain is unknown.';

    return {
      ok: false,
      error: `Switch your wallet to Hyperliquid Mainnet (chainId ${TARGET_CHAIN_ID}) before enabling trading. ${activeText}`,
    };
  }
}

export type GaslessMethod =
  | 'metaPlaceLimit'
  | 'metaPlaceMarginLimit'
  | 'metaPlaceMarket'
  | 'metaPlaceMarginMarket'
  | 'metaModifyOrder'
  | 'metaCancelOrder'
  // Session-based (no per-action signatures)
  | 'sessionPlaceLimit'
  | 'sessionPlaceMarginLimit'
  | 'sessionPlaceMarket'
  | 'sessionPlaceMarginMarket'
  | 'sessionModifyOrder'
  | 'sessionCancelOrder';

export interface GaslessResponse {
  success: boolean;
  txHash?: string;
  blockNumber?: number | null;
  mined?: boolean;
  pending?: boolean;
  // Server-provided estimate + routing hints (optional)
  estimatedGas?: string | null;
  estimatedGasBuffered?: string | null;
  routedPool?: string;
  estimatedFromAddress?: string | null;
  reroutedToBig?: boolean;
  retryReason?: string;
  previousTxHash?: string;
  error?: string;
}

export interface SessionCreateResponse {
  success: boolean;
  sessionId?: string;
  txHash?: string;
  error?: string;
  expirySec?: number;
}

// Normalize provider/wallet signature errors (especially noisy on mobile wallets)
function normalizeProviderError(err: any): string {
  const raw = err?.message || err?.data?.message || String(err || '');
  const msg = (raw || '').toLowerCase();
  if (msg.includes('user rejected') || msg.includes('denied') || msg.includes('rejected')) {
    return 'Signature was rejected in your wallet.';
  }
  if (msg.includes('unsupported method') || msg.includes('eth_signtypeddata_v4')) {
    return 'Your wallet does not support this signing method on this device.';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Signature request timed out. Please try again.';
  }
  if (msg.includes('cannot read') || msg.includes('undefined')) {
    return 'Wallet is not ready. Reopen your wallet and try again.';
  }
  return raw || 'Signature failed. Please retry.';
}

// Normalize relayer errors so phone users see a concise reason
function normalizeRelayErrorBody(body: string, context?: string): string {
  let text = body?.trim?.() || '';
  let parsed: { error?: string; message?: string; details?: string } | null = null;
  try {
    parsed = JSON.parse(body);
    if (parsed?.error) text = String(parsed.error);
    // Log full details for debugging
    console.error('[Gasless] Relay error details:', {
      context,
      rawBody: body,
      parsedError: parsed?.error,
      parsedMessage: parsed?.message,
      parsedDetails: parsed?.details,
    });
  } catch {
    console.error('[Gasless] Relay error (non-JSON):', { context, rawBody: body });
  }
  
  // Handle known error codes
  if (parsed?.error === 'session_bad_relayer') {
    return 'This gasless session does not authorize the relayer that submitted your trade. Please re-enable gasless trading (create a new session) and retry.';
  }
  if (parsed?.error === 'session_expired') {
    return 'Gasless session expired. Please re-enable gasless trading and retry.';
  }
  if (parsed?.error === 'order_not_found') {
    return parsed?.message && parsed.message !== 'order_not_found'
      ? String(parsed.message)
      : 'Order does not exist. It may have been filled or already cancelled.';
  }
  if (parsed?.error === 'orderbook_not_deployed') {
    return 'This market contract is not deployed on the connected network. Refresh the page and retry (or switch to the correct chain).';
  }
  if (parsed?.error === 'bad_sig') {
    return 'Signature verification failed. Please try signing again with your wallet.';
  }
  if (parsed?.error === 'bad_nonce') {
    return `Session nonce mismatch. Your session may be out of sync - please try again.`;
  }
  if (parsed?.error === 'server misconfigured' || parsed?.error === 'server missing SESSION_REGISTRY_ADDRESS') {
    return 'Server configuration error. Please contact support or try again later.';
  }
  if (parsed?.error === 'missing payload') {
    return 'Invalid request sent to server. Please refresh the page and try again.';
  }
  
  const lower = (text || '').toLowerCase();
  if (lower.includes('session: bad relayer') || lower.includes('missing proof') || lower.includes('session: unknown')) {
    return 'Gasless session is out of date. Please re-enable gasless trading and retry.';
  }
  if (lower.includes('session: expired') || lower.includes('expired')) {
    return 'Gasless session expired. Please re-enable gasless trading and retry.';
  }
  if (lower.includes('crosses_spot_liquidity')) {
    return 'Cannot execute a margin trade against spot-only liquidity at the top of the book. Cancel any spot orders on this market or place a limit order that does not immediately cross.';
  }
  if (lower.includes('closing_loss_exceeds_position_margin')) {
    return 'Closing this size at the current price would realize more loss than your position margin. Reduce the close size or add collateral, then try again.';
  }
  if (lower.includes('insufficient collateral')) {
    return 'Insufficient collateral for this order. Deposit more or reduce size.';
  }
  if (lower.includes('nonce too low')) {
    return 'Trading session expired. Please refresh and try again.';
  }
  if (lower.includes('session')) {
    return text || 'Session error. Please reconnect your wallet.';
  }
  if (lower.includes('relayer') || lower.includes('gas')) {
    return `Relayer error: ${text}. Please try again.`;
  }
  if (lower.includes('revert') || lower.includes('execution reverted')) {
    return `Transaction failed: ${text}. Please try again.`;
  }
  
  // For completely unknown errors, provide more context
  if (!text || text === 'undefined' || text === 'null') {
    return 'An unknown error occurred. Please check your connection and try again.';
  }
  
  return `${text}. Please try again.`;
}

// Lightweight classifiers so callers can adjust UX without re-parsing all errors.
export function isSessionErrorMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('session') ||
    lower.includes('relayer') ||
    lower.includes('nonce too low')
  );
}

export function isBusinessRuleErrorMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('crosses_spot_liquidity') ||
    lower.includes('cannot execute a margin trade against spot-only liquidity') ||
    lower.includes('closing_loss_exceeds_position_margin') ||
    lower.includes('closing loss exceeds position margin') ||
    lower.includes('insufficient collateral') ||
    lower.includes('insufficient available collateral')
  );
}

function normalizeNetworkError(err: any): string {
  const raw = err?.message || String(err || '');
  if (/failed to fetch/i.test(raw)) return 'Network error talking to relayer. Check connectivity.';
  return raw || 'Network error. Please retry.';
}

async function fetchNonce(orderBook: string, trader: string): Promise<bigint> {
  const url = `/api/gasless/nonce?orderBook=${orderBook}&trader=${trader}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`nonce http ${res.status}`);
  const json = await res.json();
  return BigInt(json?.nonce ?? 0);
}

async function fetchRegistryNonce(trader: string): Promise<bigint> {
  const url = `/api/gasless/session/nonce?trader=${trader}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`session nonce http ${res.status}`);
  const json = await res.json();
  return BigInt(json?.nonce ?? 0);
}

function buildDomain(orderBook: string) {
  return {
    name: 'DexetraMeta',
    version: '1',
    chainId: Number(CHAIN_CONFIG.chainId),
    verifyingContract: orderBook as Hex,
  };
}

function buildTypes(method: GaslessMethod) {
  switch (method) {
    case 'metaCancelOrder':
      return {
        CancelOrder: [
          { name: 'trader', type: 'address' },
          { name: 'orderId', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    case 'metaPlaceLimit':
      return {
        PlaceLimit: [
          { name: 'trader', type: 'address' },
          { name: 'price', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'isBuy', type: 'bool' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    case 'metaPlaceMarginLimit':
      return {
        PlaceMarginLimit: [
          { name: 'trader', type: 'address' },
          { name: 'price', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'isBuy', type: 'bool' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    case 'metaPlaceMarket':
      return {
        PlaceMarket: [
          { name: 'trader', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'isBuy', type: 'bool' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    case 'metaPlaceMarginMarket':
      return {
        PlaceMarginMarket: [
          { name: 'trader', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'isBuy', type: 'bool' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    case 'metaModifyOrder':
      return {
        ModifyOrder: [
          { name: 'trader', type: 'address' },
          { name: 'orderId', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
    default:
      return {} as const;
  }
}

export async function signAndSubmitGasless(params: {
  method: GaslessMethod;
  orderBook: string;
  trader: string;
  // numeric parameters should already be in wei units expected by the facet
  priceWei?: bigint;
  amountWei?: bigint;
  isBuy?: boolean;
  orderId?: bigint;
  deadlineSec?: number;
}): Promise<GaslessResponse> {
  if (params.method.startsWith('session')) {
    throw new Error('Use submitSessionTrade for session methods');
  }
  try { console.log('[UpGas][client] legacy meta flow used', { method: params.method, orderBook: params.orderBook, trader: params.trader }); } catch {}
  const {
    method,
    orderBook,
    trader,
    priceWei,
    amountWei,
    isBuy,
    orderId,
    deadlineSec,
  } = params;

  const deadline = BigInt(deadlineSec ?? Math.floor(Date.now() / 1000) + 300);
  const nonce = await fetchRegistryNonce(trader);
  const domain = buildDomain(orderBook);
  const types = buildTypes(method) as any;
  try {
    console.log('[GASLESS] client env', {
      NEXT_PUBLIC_GASLESS_ENABLED: (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED,
      chainId: (CHAIN_CONFIG as any)?.chainId,
    });
  } catch {}

  // Build primary type and message by method
  let primaryType = '';
  let message: any = {};
  switch (method) {
    case 'metaPlaceMarginLimit':
      primaryType = 'PlaceMarginLimit';
      message = {
        trader,
        price: priceWei ?? 0n,
        amount: amountWei ?? 0n,
        isBuy: Boolean(isBuy),
        deadline,
        nonce,
      };
      break;
    case 'metaPlaceMarginMarket':
      primaryType = 'PlaceMarginMarket';
      message = {
        trader,
        amount: amountWei ?? 0n,
        isBuy: Boolean(isBuy),
        deadline,
        nonce,
      };
      break;
    case 'metaPlaceLimit':
      primaryType = 'PlaceLimit';
      message = {
        trader,
        price: priceWei ?? 0n,
        amount: amountWei ?? 0n,
        isBuy: Boolean(isBuy),
        deadline,
        nonce,
      };
      break;
    case 'metaPlaceMarket':
      primaryType = 'PlaceMarket';
      message = {
        trader,
        amount: amountWei ?? 0n,
        isBuy: Boolean(isBuy),
        deadline,
        nonce,
      };
      break;
    case 'metaModifyOrder':
      primaryType = 'ModifyOrder';
      message = {
        trader,
        orderId: orderId ?? 0n,
        price: priceWei ?? 0n,
        amount: amountWei ?? 0n,
        deadline,
        nonce,
      };
      break;
    case 'metaCancelOrder':
      primaryType = 'CancelOrder';
      message = { trader, orderId: orderId ?? 0n, deadline, nonce };
      break;
    default:
      throw new Error('unsupported method');
  }

  // Convert any BigInt fields to string for JSON serialization
  const serialize = (v: any): any => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(serialize);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) out[k] = serialize(val as any);
      return out;
    }
    return v;
  };
  const jsonMessage = serialize(message);
  try {
    console.log('[GASLESS] EIP712 domain', domain);
    console.log('[GASLESS] EIP712 primaryType', primaryType);
    console.log('[GASLESS] EIP712 message', jsonMessage);
  } catch {}

  // Sign typed data via the selected wallet provider (EIP-6963 aware).
  const ethereum = getWalletProvider();
  if (!ethereum) return { success: false, error: 'No wallet provider' };

  const chainCheck = await ensureCorrectChain(ethereum);
  if (!chainCheck.ok) {
    return { success: false, error: chainCheck.error };
  }

  // Ensure the wallet has authorized the account we are signing with.
  // In multi-wallet environments, using an aggregator provider can trigger
  // "method not authorized" errors if the wrong provider is used.
  try {
    const accounts = await ethereum.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return { success: false, error: 'Wallet is not connected. Please connect your wallet and retry.' };
    }
    const selected = String(accounts[0]);
    if (selected.toLowerCase() !== String(trader).toLowerCase()) {
      return {
        success: false,
        error: `Wallet account mismatch. Selected: ${selected.slice(0, 10)}…, expected: ${String(trader).slice(0, 10)}…. Switch accounts in your wallet and retry.`,
      };
    }
  } catch {
    // ignore; will surface in signing error below
  }

  const payload = JSON.stringify({
    types: { EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ], ...(types as any) },
    domain,
    primaryType,
    message: jsonMessage,
  });

  let signature: string;
  try {
    signature = await ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [trader, payload],
    });
  } catch (err) {
    return { success: false, error: normalizeProviderError(err) };
  }

  // Submit to relayer API
  try {
    console.log('[UpGas][client] POST /api/gasless/trade (legacy)', { orderBook, method, hasMessage: true, hasSignature: true });
  } catch {}
  let res: Response;
  try {
    res = await fetch('/api/gasless/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderBook,
        method,
        message: jsonMessage,
        signature,
      }),
    });
  } catch (err) {
    return { success: false, error: normalizeNetworkError(err) };
  }
  const body = await res.text();
  if (!res.ok) {
    try { console.warn('[UpGas][client] relay http error', { status: res.status, body }); } catch {}
    return { success: false, error: normalizeRelayErrorBody(body) };
  }
  let json: any = {};
  try { json = body ? JSON.parse(body) : {}; } catch { json = {}; }
  try { console.log('[UpGas][client] relay success', { txHash: json?.txHash }); } catch {}
  return { success: true, txHash: json?.txHash as string };
}

// ----------------- Session-based helpers -----------------
export async function createGaslessSession(params: {
  trader: string;
  expirySec?: number;
  maxNotionalPerTrade?: bigint;
  maxNotionalPerSession?: bigint;
  methodsBitmap?: `0x${string}`; // defaults to enabling limit/market/modify/cancel
  allowedMarkets?: `0x${string}`[]; // optional
}): Promise<SessionCreateResponse> {
  const {
    trader,
    expirySec,
    maxNotionalPerTrade = 0n,
    maxNotionalPerSession = 0n,
    methodsBitmap,
    allowedMarkets = [],
  } = params;

  console.log('[Gasless] createGaslessSession started', { trader, expirySec });

  const ethereum = getWalletProvider();
  if (!ethereum) {
    console.error('[Gasless] No wallet provider detected');
    return { success: false, error: 'No wallet provider detected. Please install a wallet extension.' };
  }

  // Ensure wallet connection/authorization exists before attempting typed-data signing.
  // Some providers throw: "The requested account and/or method has not been authorized by the user."
  let selectedAccount: string | null = null;
  try {
    const accounts = await ethereum.request({ method: 'eth_accounts' });
    if (Array.isArray(accounts) && accounts.length > 0) {
      selectedAccount = String(accounts[0]);
    }
  } catch {}
  if (!selectedAccount) {
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      if (Array.isArray(accounts) && accounts.length > 0) {
        selectedAccount = String(accounts[0]);
      }
    } catch (err: any) {
      return { success: false, error: normalizeProviderError(err) };
    }
  }
  if (!selectedAccount) {
    return { success: false, error: 'Wallet is not connected. Please connect your wallet and retry.' };
  }
  if (selectedAccount.toLowerCase() !== trader.toLowerCase()) {
    return {
      success: false,
      error: `Wallet account mismatch. Selected: ${selectedAccount.slice(0, 10)}…, expected: ${trader.slice(0, 10)}…. Switch accounts in your wallet and retry.`,
    };
  }

  console.log('[Gasless] Checking chain...');
  const chainCheck = await ensureCorrectChain(ethereum);
  if (!chainCheck.ok) {
    console.error('[Gasless] Chain check failed:', chainCheck.error);
    return { success: false, error: chainCheck.error };
  }
  console.log('[Gasless] Chain check passed');

  const now = Math.floor(Date.now() / 1000);
  const defaultLifetime = Number((process as any)?.env?.NEXT_PUBLIC_SESSION_DEFAULT_LIFETIME_SECS ?? 86400);
  const expiry = BigInt(expirySec ?? (now + defaultLifetime));
  
  // Build domain for global session registry
  const registryAddr = (process as any)?.env?.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS as string | undefined;
  if (!registryAddr) {
    console.error('[Gasless] Missing SESSION_REGISTRY_ADDRESS config');
    return { success: false, error: 'Session registry not configured. Please contact support.' };
  }
  
  const domain = {
    name: 'DexetraMeta',
    version: '1',
    chainId: Number(CHAIN_CONFIG.chainId),
    verifyingContract: registryAddr as Hex,
  };
  
  console.log('[Gasless] Fetching registry nonce for trader...');
  let nonce: bigint;
  try {
    nonce = await fetchRegistryNonce(trader);
    console.log('[Gasless] Got nonce:', nonce.toString());
  } catch (err: any) {
    console.error('[Gasless] Failed to fetch nonce:', err?.message || err);
    return { success: false, error: 'Failed to fetch session nonce. Please check your connection and try again.' };
  }
  
  // Build a random salt for session id uniqueness
  const sessionSalt = (ethersRandomHex(32) as `0x${string}`);
  const bitmap = methodsBitmap ?? defaultMethodsBitmap();

  // Fetch relayer set root from server so one signature authorizes any configured relayer key.
  console.log('[Gasless] Fetching relayer set root...');
  let relayerSetRoot: string = '0x' + '00'.repeat(32);
  let relayerSetError: string | null = null;
  try {
    const r = await fetch('/api/gasless/session/relayer-set', { method: 'GET' });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[Gasless] Relayer set fetch failed:', r.status, errText);
      relayerSetError = `Relayer service error (${r.status})`;
    } else {
      const j = await r.json();
      if (j?.relayerSetRoot && typeof j.relayerSetRoot === 'string') {
        relayerSetRoot = j.relayerSetRoot;
        console.log('[Gasless] Got relayer set root:', relayerSetRoot.slice(0, 18) + '...');
      }
    }
  } catch (err: any) {
    console.error('[Gasless] Relayer set fetch error:', err?.message || err);
    relayerSetError = 'Network error fetching relayer configuration';
  }
  if (!relayerSetRoot || relayerSetRoot === ('0x' + '00'.repeat(32))) {
    const errorMsg = relayerSetError || 'Relayer set is unavailable. Please try again in a moment.';
    console.error('[Gasless] No valid relayer set root:', errorMsg);
    return { success: false, error: errorMsg };
  }

  const message = {
    trader,
    relayerSetRoot,
    expiry: expiry.toString(),
    maxNotionalPerTrade: maxNotionalPerTrade.toString(),
    maxNotionalPerSession: maxNotionalPerSession.toString(),
    methodsBitmap: bitmap,
    sessionSalt,
    allowedMarkets,
    nonce: nonce.toString(),
  };

  const types = {
    SessionPermit: [
      { name: 'trader', type: 'address' },
      { name: 'relayerSetRoot', type: 'bytes32' },
      { name: 'expiry', type: 'uint256' },
      { name: 'maxNotionalPerTrade', type: 'uint256' },
      { name: 'maxNotionalPerSession', type: 'uint256' },
      { name: 'methodsBitmap', type: 'bytes32' },
      { name: 'sessionSalt', type: 'bytes32' },
      { name: 'allowedMarkets', type: 'bytes32[]' },
      { name: 'nonce', type: 'uint256' },
    ],
  } as const;

  const payload = JSON.stringify({
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...(types as any),
    },
    domain,
    primaryType: 'SessionPermit',
    message,
  });

  console.log('[Gasless] Requesting wallet signature...');
  let signature: string;
  try {
    signature = await ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [trader, payload],
    });
    console.log('[Gasless] Signature obtained');
  } catch (err: any) {
    const normalizedError = normalizeProviderError(err);
    console.error('[Gasless] Wallet signature failed:', {
      error: err?.message || err,
      code: err?.code,
      normalized: normalizedError,
    });
    return { success: false, error: normalizedError };
  }

  console.log('[Gasless] Submitting session init to API...');
  let res: Response;
  try {
    res = await fetch('/api/gasless/session/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permit: message, signature }),
    });
  } catch (err: any) {
    const normalizedError = normalizeNetworkError(err);
    console.error('[Gasless] Session init network error:', {
      error: err?.message || err,
      normalized: normalizedError,
    });
    return { success: false, error: normalizedError };
  }
  
  const body = await res.text();
  console.log('[Gasless] Session init response:', { status: res.status, ok: res.ok, bodyLength: body?.length });
  
  if (!res.ok) {
    console.error('[Gasless] Session init HTTP error:', { status: res.status, body });
    return { success: false, error: normalizeRelayErrorBody(body, 'session/init') };
  }
  
  let json: any = {};
  try { 
    json = body ? JSON.parse(body) : {}; 
  } catch (parseErr) { 
    console.error('[Gasless] Failed to parse session init response:', { body, parseErr });
    json = {}; 
  }
  
  if (!json?.sessionId) {
    console.error('[Gasless] Session init response missing sessionId:', json);
    return { success: false, error: 'Session was created but no session ID returned. Please try again.' };
  }
  
  console.log('[Gasless] Session init success:', { sessionId: json.sessionId, txHash: json.txHash });
  return { success: true, sessionId: json.sessionId, txHash: json?.txHash, expirySec: Number(expiry) };
}

export async function submitSessionTrade(params: {
  method: Extract<GaslessMethod, 'sessionPlaceLimit' | 'sessionPlaceMarginLimit' | 'sessionPlaceMarket' | 'sessionPlaceMarginMarket' | 'sessionModifyOrder' | 'sessionCancelOrder'>;
  orderBook: string;
  sessionId: string;
  trader: string;
  priceWei?: bigint;
  amountWei?: bigint;
  isBuy?: boolean;
  orderId?: bigint;
}): Promise<GaslessResponse> {
  const { method, orderBook, sessionId, trader, priceWei, amountWei, isBuy, orderId } = params;
  try {
    console.log('[UpGas][client] submitSessionTrade', {
      method, orderBook, sessionId, trader,
      price: priceWei?.toString(), amount: amountWei?.toString(), isBuy, orderId: orderId?.toString()
    });
  } catch {}
  const payload: any = {
    orderBook,
    method,
    sessionId,
    params: {
      trader,
      price: priceWei?.toString(),
      amount: amountWei?.toString(),
      isBuy,
      orderId: orderId?.toString(),
    },
  };
  let res: Response;
  try {
    res = await fetch('/api/gasless/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { success: false, error: normalizeNetworkError(err) };
  }
  const body = await res.text();
  if (!res.ok) {
    try { console.warn('[UpGas][client] session trade http error', { status: res.status, body }); } catch {}
    return { success: false, error: normalizeRelayErrorBody(body) };
  }
  let json: any = {};
  try { json = body ? JSON.parse(body) : {}; } catch { json = {}; }
  try {
    console.log('[UpGas][client] session trade success', {
      txHash: json?.txHash,
      blockNumber: json?.blockNumber,
      mined: json?.mined,
      pending: json?.pending,
    });
    if (json?.estimatedGas || json?.routedPool) {
      console.log('[UpGas][client] trade gas estimate', {
        estimatedGas: json?.estimatedGas,
        estimatedGasBuffered: json?.estimatedGasBuffered,
        routedPool: json?.routedPool,
        estimatedFromAddress: json?.estimatedFromAddress,
        reroutedToBig: json?.reroutedToBig,
      });
    }
  } catch {}
  return {
    success: true,
    txHash: json?.txHash as string,
    blockNumber: typeof json?.blockNumber === 'number' ? json.blockNumber : null,
    mined: Boolean(json?.mined),
    pending: Boolean(json?.pending),
    estimatedGas: typeof json?.estimatedGas === 'string' ? json.estimatedGas : null,
    estimatedGasBuffered: typeof json?.estimatedGasBuffered === 'string' ? json.estimatedGasBuffered : null,
    routedPool: typeof json?.routedPool === 'string' ? json.routedPool : undefined,
    estimatedFromAddress: typeof json?.estimatedFromAddress === 'string' ? json.estimatedFromAddress : null,
    reroutedToBig: Boolean(json?.reroutedToBig),
    retryReason: typeof json?.retryReason === 'string' ? json.retryReason : undefined,
    previousTxHash: typeof json?.previousTxHash === 'string' ? json.previousTxHash : undefined,
  };
}

function defaultMethodsBitmap(): `0x${string}` {
  // bits: 0..5 set
  const v = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n) | (1n << 5n);
  const hex = '0x' + v.toString(16).padStart(64, '0');
  return hex as `0x${string}`;
}

function ethersRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return '0x' + Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}


