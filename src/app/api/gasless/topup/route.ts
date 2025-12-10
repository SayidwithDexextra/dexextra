import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import CoreVaultAbi from '@/lib/abis/CoreVault.json';

const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
const pk = process.env.RELAYER_PRIVATE_KEY;

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
    if (!rpcUrl) return bad('server misconfigured', 500);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const cv = new ethers.Contract(vault, CoreVaultAbi, provider);
    const nonce = await cv.topUpNonces(trader);
    return NextResponse.json({ nonce: nonce?.toString?.() || '0' });
  } catch (e: any) {
    return bad(e?.message || 'nonce failed', 500);
  }
}

export async function POST(req: Request) {
  try {
    if (!rpcUrl || !pk) return bad('server misconfigured', 500);
    const { vault, user, marketId, amount, nonce, signature } = await req.json();
    if (!vault || !ethers.isAddress(vault)) return bad('invalid vault');
    if (!user || !ethers.isAddress(user)) return bad('invalid user');
    if (!marketId) return bad('missing marketId');
    if (!amount) return bad('missing amount');
    if (!signature || typeof signature !== 'string') return bad('missing signature');

    const sig = ethers.Signature.from(signature);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const cv = new ethers.Contract(vault, CoreVaultAbi, wallet);
    const tx = await cv.metaTopUpPositionMargin(
      user,
      marketId,
      amount,
      sig.v,
      sig.r,
      sig.s
    );
    const waitConfirms = Number(process.env.GASLESS_TRADE_WAIT_CONFIRMS ?? '0');
    if (waitConfirms > 0) {
      const rc = await wallet.provider.waitForTransaction(tx.hash, waitConfirms);
      return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
    }
    return NextResponse.json({ txHash: tx.hash });
  } catch (e: any) {
    return bad(e?.message || 'relay failed', 500);
  }
}

