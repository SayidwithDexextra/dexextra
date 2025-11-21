import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';

const ALLOWED: Record<string, string> = {
  metaPlaceLimit: 'metaPlaceLimit',
  metaPlaceMarginLimit: 'metaPlaceMarginLimit',
  metaPlaceMarket: 'metaPlaceMarket',
  metaPlaceMarginMarket: 'metaPlaceMarginMarket',
  metaModifyOrder: 'metaModifyOrder',
  metaCancelOrder: 'metaCancelOrder',
};

function selectorFor(method: string): string | null {
  switch (method) {
    case 'metaPlaceLimit':
      return 'metaPlaceLimit((address,uint256,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginLimit':
      return 'metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarket':
      return 'metaPlaceMarket((address,uint256,bool,uint256,uint256),bytes)';
    case 'metaPlaceMarginMarket':
      return 'metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)';
    case 'metaModifyOrder':
      return 'metaModifyOrder((address,uint256,uint256,uint256,uint256,uint256),bytes)';
    case 'metaCancelOrder':
      return 'metaCancelOrder((address,uint256,uint256,uint256),bytes)';
    default:
      return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const method: string = body?.method;
    const message = body?.message;
    const signature: string = body?.signature;
    console.log('[GASLESS][API][trade] incoming', { orderBook, method });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    if (!ALLOWED[method]) {
      return NextResponse.json({ error: 'method not allowed' }, { status: 400 });
    }
    if (!message || typeof signature !== 'string') {
      return NextResponse.json({ error: 'missing payload' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const pk = process.env.RELAYER_PRIVATE_KEY;
    console.log('[GASLESS][API][trade] env', {
      hasPK: !!pk,
      rpcUrlUsed: rpcUrl ? (rpcUrl.includes('http') ? rpcUrl : 'set') : 'unset',
      chainIdEnv: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 'unset',
    });
    if (!rpcUrl || !pk) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const net = await provider.getNetwork();
      console.log('[GASLESS][API][trade] provider network', { chainId: String(net.chainId) });
    } catch {}
    const wallet = new ethers.Wallet(pk, provider);
    const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, wallet);

    // Probe selector presence to avoid opaque "Function does not exist"
    try {
      const sig = selectorFor(method);
      if (sig) {
        const sel = ethers.id(sig).slice(0, 10);
        const loupe = new ethers.Contract(orderBook, ["function facetAddress(bytes4) view returns (address)"], provider);
        const facetAddr = await loupe.facetAddress(sel as any);
        console.log('[GASLESS][API][trade] selector probe', { method, signature: sig, selector: sel, facetAddr });
        if (!facetAddr || facetAddr === ethers.ZeroAddress) {
          return NextResponse.json({ error: `diamond_missing_selector:${method}`, selector: sel, signature: sig }, { status: 400 });
        }
      }
    } catch (_) {
      // ignore probe errors; proceed to call
    }
    // Call corresponding meta method
    let tx;
    switch (method) {
      case 'metaPlaceLimit':
        tx = await meta.metaPlaceLimit(message, signature);
        break;
      case 'metaPlaceMarginLimit':
        tx = await meta.metaPlaceMarginLimit(message, signature);
        break;
      case 'metaPlaceMarket':
        tx = await meta.metaPlaceMarket(message, signature);
        break;
      case 'metaPlaceMarginMarket':
        tx = await meta.metaPlaceMarginMarket(message, signature);
        break;
      case 'metaModifyOrder':
        tx = await meta.metaModifyOrder(message, signature);
        break;
      case 'metaCancelOrder':
        tx = await meta.metaCancelOrder(message, signature);
        break;
    }
    const rc = await tx.wait();
    console.log('[GASLESS][API][trade] relayed', { txHash: tx.hash, blockNumber: rc?.blockNumber });
    return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
  } catch (e: any) {
    console.error('[GASLESS][API][trade] error', e?.message || e);
    return NextResponse.json({ error: e?.message || 'relay failed' }, { status: 500 });
  }
}


