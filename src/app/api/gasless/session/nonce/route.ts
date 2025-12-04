import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const trader = searchParams.get('trader');
    const registry = process.env.SESSION_REGISTRY_ADDRESS;
    console.log('[UpGas][API][session/nonce] incoming', { trader, registrySet: !!registry });
    if (!trader || !ethers.isAddress(trader)) {
      return NextResponse.json({ error: 'invalid trader' }, { status: 400 });
    }
    if (!registry || !ethers.isAddress(registry)) {
      return NextResponse.json({ error: 'missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'missing RPC_URL' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const net = await provider.getNetwork();
      console.log('[UpGas][API][session/nonce] provider network', { chainId: String(net.chainId) });
    } catch {}
    const reg = new ethers.Contract(registry, (GlobalSessionRegistry as any).abi, provider);
    const nonce = await reg.metaNonce(trader);
    console.log('[UpGas][API][session/nonce] response', { nonce: nonce?.toString?.() ?? '0' });
    return NextResponse.json({ nonce: nonce?.toString?.() ?? '0' });
  } catch (e: any) {
    console.error('[UpGas][API][session/nonce] error', e?.stack || e?.message || String(e));
    return NextResponse.json({ error: e?.message || 'nonce failed' }, { status: 500 });
  }
}









