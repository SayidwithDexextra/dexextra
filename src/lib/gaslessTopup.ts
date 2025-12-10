import { parseUnits } from 'viem';
import { verifyTypedData } from 'ethers';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from './contractConfig';

const GASLESS_TOPUP_ENDPOINT = '/api/gasless/topup';
type ChainCheckResult = { ok: true } | { ok: false; error: string };

async function getSelectedAccount(): Promise<string | null> {
  if (typeof window === 'undefined' || !(window as any)?.ethereum) return null;
  const ethereum = (window as any).ethereum;
  // Try requesting to ensure wallet is connected
  const methods = ['eth_requestAccounts', 'eth_accounts'];
  for (const m of methods) {
    try {
      const accounts: string[] = await ethereum.request({ method: m });
      if (Array.isArray(accounts) && accounts.length > 0) {
        return accounts[0] || null; // keep checksum from wallet
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function getActiveChainId(): Promise<number | null> {
  try {
    if (typeof window === 'undefined' || !(window as any)?.ethereum) return null;
    const active = await (window as any).ethereum.request({ method: 'eth_chainId' });
    if (typeof active === 'string') return parseInt(active, 16);
    if (typeof active === 'number') return active;
    return null;
  } catch {
    return null;
  }
}

async function switchToTargetChain(targetChainId: number): Promise<ChainCheckResult> {
  if (typeof window === 'undefined' || !(window as any)?.ethereum) {
    return { ok: false, error: 'No wallet provider detected.' };
  }
  const ethereum = (window as any).ethereum;
  const chainHex = `0x${targetChainId.toString(16)}`;
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    });
    return { ok: true };
  } catch (switchErr: any) {
    if (switchErr?.code === 4902) {
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainHex,
            chainName: 'Hyperliquid Mainnet',
            rpcUrls: [CHAIN_CONFIG.rpcUrl].filter(Boolean),
            nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
          }],
        });
        return { ok: true };
      } catch (addErr: any) {
        return { ok: false, error: addErr?.message || 'Add target chain to your wallet and retry.' };
      }
    }
    return { ok: false, error: switchErr?.message || 'Switch to the trading network then retry.' };
  }
}

function normalizeProviderError(err: any): string {
  const raw = err?.message || err?.data?.message || String(err || '');
  const lower = raw.toLowerCase?.() || '';
  if (lower.includes('user rejected') || lower.includes('denied')) return 'Signature was rejected in your wallet.';
  if (lower.includes('unsupported method') || lower.includes('eth_signtypeddata_v4')) return 'Wallet does not support typed-data signing on this device.';
  return raw || 'Signature failed. Please retry.';
}

async function getTopUpNonce(
  vault: string,
  trader: string
): Promise<{ nonce: bigint }> {
  const url = new URL(GASLESS_TOPUP_ENDPOINT, window.location.origin);
  url.searchParams.set('vault', vault);
  url.searchParams.set('trader', trader);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`nonce http ${res.status}`);
  const json = await res.json();
  return {
    nonce: BigInt(json?.nonce ?? 0),
  };
}

function normalizeMarketId(marketId: string): string | null {
  if (!marketId) return null;
  const trimmed = marketId.trim();
  if (!trimmed.startsWith('0x')) return null;
  if (trimmed.length !== 66) return null;
  return trimmed;
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

  const parsedMarketId = normalizeMarketId(marketId);
  if (!parsedMarketId) return { success: false, error: 'Invalid marketId for top-up' };

  if (!trader) {
    return { success: false, error: 'Missing trader address' };
  }
  const effectiveTrader = trader;
  const effectiveTraderLower = trader.toLowerCase();

  let amountWei: bigint;
  try {
    amountWei = parseUnits(amount, 6);
    if (amountWei <= 0n) return { success: false, error: 'Amount must be greater than 0' };
  } catch {
    return { success: false, error: 'Invalid amount' };
  }

  let nonce: bigint;
  try {
    const res = await getTopUpNonce(vaultAddr, effectiveTrader);
    nonce = res.nonce;
  } catch (e: any) {
    return { success: false, error: e?.message || 'nonce fetch failed' };
  }

  // Ensure wallet is on the configured trading chain (same as gasless trading)
  let activeChainId = await getActiveChainId();
  const desiredChainId = Number(CHAIN_CONFIG.chainId || 0);

  if (activeChainId !== desiredChainId && desiredChainId > 0) {
    const switched = await switchToTargetChain(desiredChainId);
    if (!switched.ok) return { success: false, error: switched.error };
    activeChainId = await getActiveChainId();
  }

  if (!activeChainId || activeChainId <= 0 || (desiredChainId > 0 && activeChainId !== desiredChainId)) {
    return { success: false, error: 'Unable to determine network. Please reconnect wallet.' };
  }

  const domain = {
    name: 'CoreVault',
    version: '1',
    chainId: desiredChainId,
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
    user: effectiveTrader,
    marketId: parsedMarketId,
    amount: amountWei.toString(),
    nonce: nonce.toString(),
  };

  let signature: string;
  try {
    signature = await (window as any).ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [effectiveTrader, JSON.stringify({ domain, types, primaryType: 'TopUp', message })],
    });
  } catch (err: any) {
    return { success: false, error: normalizeProviderError(err) };
  }

  // Optional local verification to aid debugging; do not block relay on mismatch
  try {
    const recovered = verifyTypedData(domain as any, types as any, message as any, signature);
    if (!recovered || recovered.toLowerCase() !== effectiveTraderLower) {
      console.warn('[gaslessTopUpPosition] signature mismatch (non-blocking)', {
        recovered,
        expected: effectiveTrader,
        domain,
        message,
      });
    }
  } catch (e: any) {
    console.warn('[gaslessTopUpPosition] signature verify failed (non-blocking)', e);
  }

  try {
    const res = await fetch(GASLESS_TOPUP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vault: vaultAddr,
        user: effectiveTrader,
        marketId: parsedMarketId,
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

