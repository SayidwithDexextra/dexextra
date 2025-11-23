import { CHAIN_CONFIG } from './contractConfig';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';

type Hex = `0x${string}`;

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
  error?: string;
}

export interface SessionCreateResponse {
  success: boolean;
  sessionId?: string;
  txHash?: string;
  error?: string;
  expirySec?: number;
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

  // Sign typed data via wallet (eth_signTypedData_v4)
  const ethereum = (window as any)?.ethereum;
  if (!ethereum) return { success: false, error: 'No wallet provider' };

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

  const signature: string = await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [trader, payload],
  });

  // Submit to relayer API
  try {
    console.log('[UpGas][client] POST /api/gasless/trade (legacy)', { orderBook, method, hasMessage: true, hasSignature: true });
  } catch {}
  const res = await fetch('/api/gasless/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderBook,
      method,
      message: jsonMessage,
      signature,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    try { console.error('[UpGas][client] relay http error', { status: res.status, text }); } catch {}
    return { success: false, error: `relay http ${res.status}: ${text}` };
  }
  const json = await res.json();
  try { console.log('[UpGas][client] relay success', { txHash: json?.txHash }); } catch {}
  return { success: true, txHash: json?.txHash as string };
}

// ----------------- Session-based helpers -----------------
export async function createGaslessSession(params: {
  trader: string;
  relayer?: string; // optional relayer allowlist
  expirySec?: number;
  maxNotionalPerTrade?: bigint;
  maxNotionalPerSession?: bigint;
  methodsBitmap?: `0x${string}`; // defaults to enabling limit/market/modify/cancel
  allowedMarkets?: `0x${string}`[]; // optional
}): Promise<SessionCreateResponse> {
  const {
    trader,
    relayer,
    expirySec,
    maxNotionalPerTrade = 0n,
    maxNotionalPerSession = 0n,
    methodsBitmap,
    allowedMarkets = [],
  } = params;

  const ethereum = (window as any)?.ethereum;
  if (!ethereum) return { success: false, error: 'No wallet provider' };
  const now = Math.floor(Date.now() / 1000);
  const defaultLifetime = Number((process as any)?.env?.NEXT_PUBLIC_SESSION_DEFAULT_LIFETIME_SECS ?? 86400);
  const expiry = BigInt(expirySec ?? (now + defaultLifetime));
  // Build domain for global session registry
  const registryAddr = (process as any)?.env?.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS as string | undefined;
  if (!registryAddr) return { success: false, error: 'Missing NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS' };
  const domain = {
    name: 'DexetraMeta',
    version: '1',
    chainId: Number(CHAIN_CONFIG.chainId),
    verifyingContract: registryAddr as Hex,
  };
  const nonce = await fetchRegistryNonce(trader);
  // Build a random salt for session id uniqueness
  const sessionSalt = (ethersRandomHex(32) as `0x${string}`);
  const relayerAddr = relayer || (process as any)?.env?.NEXT_PUBLIC_RELAYER_ADDRESS || '0x0000000000000000000000000000000000000000';
  const bitmap = methodsBitmap ?? defaultMethodsBitmap();
  const message = {
    trader,
    relayer: relayerAddr,
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
      { name: 'relayer', type: 'address' },
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

  const signature: string = await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [trader, payload],
  });

  const res = await fetch('/api/gasless/session/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permit: message, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    try { console.error('[UpGas][client] session init http error', { status: res.status, text }); } catch {}
    return { success: false, error: `session http ${res.status}: ${text}` };
  }
  const json = await res.json();
  try { console.log('[UpGas][client] session init success', { sessionId: json?.sessionId, txHash: json?.txHash }); } catch {}
  return { success: true, sessionId: json?.sessionId, txHash: json?.txHash, expirySec: Number(expiry) };
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
  const res = await fetch('/api/gasless/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    try { console.error('[UpGas][client] session trade http error', { status: res.status, text }); } catch {}
    return { success: false, error: `relay http ${res.status}: ${text}` };
  }
  const json = await res.json();
  try { console.log('[UpGas][client] session trade success', { txHash: json?.txHash }); } catch {}
  return { success: true, txHash: json?.txHash as string };
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


