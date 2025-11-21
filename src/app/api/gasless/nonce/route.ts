import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderBook = searchParams.get('orderBook');
    const trader = searchParams.get('trader');
    console.log('[GASLESS][API][nonce] incoming', { orderBook, trader });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    if (!trader || !ethers.isAddress(trader)) {
      return NextResponse.json({ error: 'invalid trader' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    console.log('[GASLESS][API][nonce] env', {
      rpcUrlUsed: rpcUrl ? (rpcUrl.includes('http') ? rpcUrl : 'set') : 'unset',
      chainIdEnv: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 'unset',
    });
    if (!rpcUrl) {
      return NextResponse.json({ error: 'missing RPC_URL' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const net = await provider.getNetwork();
      console.log('[GASLESS][API][nonce] provider network', { chainId: String(net.chainId) });
    } catch {}
    const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, provider);
    const nonce = await meta.metaNonce(trader);
    return NextResponse.json({ nonce: nonce?.toString?.() ?? '0' });
  } catch (e: any) {
    console.error('[GASLESS][API][nonce] error', e?.message || e);
    return NextResponse.json({ error: e?.message || 'nonce failed' }, { status: 500 });
  }
}


