import crypto from 'node:crypto';
import { Wallet, TypedDataDomain } from 'ethers';

export type SessionPermit = {
  trader: string;
  relayer: string;
  expiry: bigint;
  maxNotionalPerTrade: bigint;
  maxNotionalPerSession: bigint;
  methodsBitmap: `0x${string}`;
  sessionSalt: `0x${string}`;
  allowedMarkets: `0x${string}`[];
  nonce: bigint;
};

export type SessionCreateResult = {
  sessionId: string;
  txHash?: string;
  blockNumber?: number;
};

function randomBytes32(): `0x${string}` {
  return (`0x${crypto.randomBytes(32).toString('hex')}`) as `0x${string}`;
}

export function defaultMethodsBitmap(): `0x${string}` {
  // bits 0..5 set (placeLimit, placeMarginLimit, placeMarket, placeMarginMarket, modify, cancel)
  const v = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n) | (1n << 5n);
  return (`0x${v.toString(16).padStart(64, '0')}`) as `0x${string}`;
}

export async function fetchSessionNonce(appUrl: string, trader: string): Promise<bigint> {
  const url = new URL('/api/gasless/session/nonce', appUrl);
  url.searchParams.set('trader', trader);
  const res = await fetch(url.toString(), { method: 'GET' });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /api/gasless/session/nonce failed: ${res.status} ${text}`);
  const json = JSON.parse(text);
  return BigInt(json?.nonce ?? 0);
}

export function buildSessionPermit(params: {
  trader: string;
  relayer?: string;
  expirySec: number;
  nonce: bigint;
  allowedMarkets: `0x${string}`[];
  maxNotionalPerTrade?: bigint;
  maxNotionalPerSession?: bigint;
  methodsBitmap?: `0x${string}`;
}): SessionPermit {
  const relayer = (params.relayer || '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const sessionSalt = randomBytes32();
  return {
    trader: params.trader,
    relayer,
    expiry: BigInt(params.expirySec),
    maxNotionalPerTrade: params.maxNotionalPerTrade ?? 0n,
    maxNotionalPerSession: params.maxNotionalPerSession ?? 0n,
    methodsBitmap: params.methodsBitmap ?? defaultMethodsBitmap(),
    sessionSalt,
    allowedMarkets: params.allowedMarkets,
    nonce: params.nonce,
  };
}

export async function signSessionPermit(params: {
  privateKey: string;
  chainId: number;
  registryAddress: string;
  permit: SessionPermit;
}): Promise<string> {
  const wallet = new Wallet(params.privateKey);
  const domain: TypedDataDomain = {
    name: 'DexetraMeta',
    version: '1',
    chainId: params.chainId,
    verifyingContract: params.registryAddress,
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
  const message = {
    trader: params.permit.trader,
    relayer: params.permit.relayer,
    expiry: params.permit.expiry,
    maxNotionalPerTrade: params.permit.maxNotionalPerTrade,
    maxNotionalPerSession: params.permit.maxNotionalPerSession,
    methodsBitmap: params.permit.methodsBitmap,
    sessionSalt: params.permit.sessionSalt,
    allowedMarkets: params.permit.allowedMarkets,
    nonce: params.permit.nonce,
  };
  return await wallet.signTypedData(domain, types as any, message as any);
}

export async function createGaslessSessionViaApi(params: {
  appUrl: string;
  orderBook?: string;
  permit: SessionPermit;
  signature: string;
}): Promise<SessionCreateResult> {
  const url = new URL('/api/gasless/session/init', params.appUrl);

  // Convert BigInt values to strings for JSON transport to API route
  const permitForApi = {
    trader: params.permit.trader,
    relayer: params.permit.relayer,
    expiry: params.permit.expiry.toString(),
    maxNotionalPerTrade: params.permit.maxNotionalPerTrade.toString(),
    maxNotionalPerSession: params.permit.maxNotionalPerSession.toString(),
    methodsBitmap: params.permit.methodsBitmap,
    sessionSalt: params.permit.sessionSalt,
    allowedMarkets: params.permit.allowedMarkets,
    nonce: params.permit.nonce.toString(),
  };

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderBook: params.orderBook,
      permit: permitForApi,
      signature: params.signature,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/gasless/session/init failed: ${res.status} ${text}`);
  const json = JSON.parse(text);
  if (!json?.sessionId) throw new Error(`Session init succeeded but missing sessionId: ${text}`);
  return { sessionId: String(json.sessionId), txHash: json?.txHash, blockNumber: json?.blockNumber };
}





