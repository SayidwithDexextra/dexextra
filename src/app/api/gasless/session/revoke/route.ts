import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const sessionId: string = body?.sessionId;
    console.log('[UpGas][API][session/revoke] incoming', { orderBook, sessionId });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    if (!sessionId || !ethers.isHexString(sessionId)) {
      return NextResponse.json({ error: 'invalid sessionId' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const pk = process.env.RELAYER_PRIVATE_KEY;
    if (!rpcUrl || !pk) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, wallet);

    console.log('[UpGas][API][session/revoke] calling revokeSession', { sessionId });
    const tx = await meta.revokeSession(sessionId);
    console.log('[UpGas][API][session/revoke] tx submitted', { txHash: tx.hash });
    const rc = await tx.wait();
    console.log('[UpGas][API][session/revoke] tx mined', { blockNumber: rc?.blockNumber });
    return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
  } catch (e: any) {
    console.error('[GASLESS][API][session/revoke] error', e?.message || e);
    console.error('[UpGas][API][session/revoke] error', e?.stack || e?.message || String(e));
    return NextResponse.json({ error: e?.message || 'session revoke failed' }, { status: 500 });
  }
}


