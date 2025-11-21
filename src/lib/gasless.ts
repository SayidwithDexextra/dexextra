import { CHAIN_CONFIG } from './contractConfig';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';

type Hex = `0x${string}`;

export type GaslessMethod =
  | 'metaPlaceLimit'
  | 'metaPlaceMarginLimit'
  | 'metaPlaceMarket'
  | 'metaPlaceMarginMarket'
  | 'metaModifyOrder'
  | 'metaCancelOrder';

export interface GaslessResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

async function fetchNonce(orderBook: string, trader: string): Promise<bigint> {
  const url = `/api/gasless/nonce?orderBook=${orderBook}&trader=${trader}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`nonce http ${res.status}`);
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
  const nonce = await fetchNonce(orderBook, trader);
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
    return { success: false, error: `relay http ${res.status}: ${text}` };
  }
  const json = await res.json();
  return { success: true, txHash: json?.txHash as string };
}


