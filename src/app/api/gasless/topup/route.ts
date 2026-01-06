import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import CoreVaultAbi from '@/lib/abis/CoreVault.json';
import { sendWithNonceRetry, withRelayer } from '@/lib/relayerRouter';

// Prefer server RPC but fall back to client-exposed value so local dev works
const rpcUrl =
  process.env.RPC_URL ||
  process.env.HYPERLIQUID_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL;

if (process.env.NODE_ENV !== 'production') {
  console.log('[GASLESS][API][topup] rpcUrl', rpcUrl);
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vault = searchParams.get('vault');
    const trader = searchParams.get('trader');
    if (!vault || !ethers.isAddress(vault)) return bad('invalid vault');
    if (!trader || !ethers.isAddress(trader)) return bad('invalid trader');
    if (!rpcUrl) return bad('server misconfigured: missing RPC_URL', 500);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const cv = new ethers.Contract(vault, CoreVaultAbi.abi, provider);
    const nonce = await cv.topUpNonces(trader);
    return NextResponse.json({
      nonce: nonce?.toString?.() || '0',
    });
  } catch (e: any) {
    console.error('[GASLESS][API][topup][GET] nonce failed', e);
    return bad(e?.message || 'nonce failed', 500);
  }
}

export async function POST(req: Request) {
  try {
    if (!rpcUrl) return bad('server misconfigured', 500);
    const { vault, user, marketId, amount, nonce, signature } = await req.json();
    if (!vault || !ethers.isAddress(vault)) return bad('invalid vault');
    if (!user || !ethers.isAddress(user)) return bad('invalid user');
    if (!marketId || !ethers.isHexString(marketId, 32)) return bad('invalid marketId');
    if (amount === undefined || amount === null) return bad('missing amount');
    if (!signature || typeof signature !== 'string') return bad('missing signature');

    let amountBn: bigint;
    try {
      amountBn = ethers.toBigInt(amount);
      if (amountBn <= 0n) return bad('amount must be greater than 0');
    } catch {
      return bad('invalid amount');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const sig = ethers.Signature.from(signature);
    const tx = await withRelayer({
      pool: 'hub_trade',
      provider,
      stickyKey: user,
      action: async (wallet) => {
        const cv = new ethers.Contract(vault, CoreVaultAbi.abi, wallet);
        return await sendWithNonceRetry({
          provider,
          wallet,
          contract: cv,
          method: 'metaTopUpPositionMargin',
          args: [user, marketId, amountBn, sig.v, sig.r, sig.s],
          label: 'topup:metaTopUpPositionMargin',
        });
      }
    });
    const waitConfirms = Number(process.env.GASLESS_TRADE_WAIT_CONFIRMS ?? '0');
    if (waitConfirms > 0) {
      const rc = await provider.waitForTransaction(tx.hash, waitConfirms);
      return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
    }
    return NextResponse.json({ txHash: tx.hash });
  } catch (e: any) {
    console.error('[GASLESS][API][topup][POST] relay failed', e);
    return bad(e?.message || 'relay failed', 500);
  }
}

