import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const registry = process.env.SESSION_REGISTRY_ADDRESS;
    if (!registry || !ethers.isAddress(registry)) {
      return NextResponse.json({ error: 'missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
    }
    if (!sessionId || !ethers.isHexString(sessionId)) {
      return NextResponse.json({ error: 'invalid sessionId' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'missing RPC_URL' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const reg = new ethers.Contract(registry, (GlobalSessionRegistry as any).abi, provider);
    const s = await reg.sessions(sessionId);
    const exists = !!s?.trader && s.trader !== ethers.ZeroAddress;
    const revoked = Boolean(s?.revoked);
    const expiry = BigInt(s?.expiry?.toString?.() || 0n);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const active = exists && !revoked && expiry >= now;
    return NextResponse.json({
      exists,
      active,
      trader: s?.trader || null,
      relayerSetRoot: s?.relayerSetRoot || null,
      expiry: s?.expiry?.toString?.() || '0',
      revoked
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'status failed' }, { status: 500 });
  }
}








