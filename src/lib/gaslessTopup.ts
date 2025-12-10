import { parseUnits } from 'viem';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from './contractConfig';

const GASLESS_TOPUP_ENDPOINT = '/api/gasless/topup';

async function getTopUpNonce(vault: string, trader: string): Promise<bigint> {
  const url = new URL(GASLESS_TOPUP_ENDPOINT, window.location.origin);
  url.searchParams.set('vault', vault);
  url.searchParams.set('trader', trader);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`nonce http ${res.status}`);
  const json = await res.json();
  return BigInt(json?.nonce ?? 0);
}

export async function gaslessTopUpPosition(params: {
  vault?: string;
  trader: string;
  marketId: string;
  amount: string;
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const { trader, marketId, amount } = params;
  const vaultAddr = params.vault || CONTRACT_ADDRESSES.CORE_VAULT;
  if (!vaultAddr) return { success: false, error: 'missing vault address' };
  if (!window?.ethereum) return { success: false, error: 'No wallet provider' };

  const chainId = Number(CHAIN_CONFIG.chainId);
  const amountWei = parseUnits(amount, 6);
  let nonce: bigint;
  try {
    nonce = await getTopUpNonce(vaultAddr, trader);
  } catch (e: any) {
    return { success: false, error: e?.message || 'nonce fetch failed' };
  }

  const domain = {
    name: 'CoreVault',
    version: '1',
    chainId,
    verifyingContract: vaultAddr,
  };

  const types = {
    TopUp: [
      { name: 'user', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  };

  const message = {
    user: trader,
    marketId,
    amount: amountWei.toString(),
    nonce: nonce.toString(),
  };

  let signature: string;
  try {
    signature = await (window as any).ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [trader, JSON.stringify({ domain, types, primaryType: 'TopUp', message })],
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'signature rejected' };
  }

  try {
    const res = await fetch(GASLESS_TOPUP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vault: vaultAddr,
        user: trader,
        marketId,
        amount: amountWei.toString(),
        nonce: nonce.toString(),
        signature,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body?.txHash) {
      return { success: false, error: body?.error || 'relay failed' };
    }
    return { success: true, txHash: body.txHash };
  } catch (err: any) {
    return { success: false, error: err?.message || 'network error' };
  }
}

