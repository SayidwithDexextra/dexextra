import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import MetaTradeFacet from '@/lib/abis/facets/MetaTradeFacet.json';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { sendWithNonceRetry, withRelayer } from '@/lib/relayerRouter';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';
import { computeRelayerProof } from '@/lib/relayerMerkle';

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
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Prefer revoking on the GlobalSessionRegistry when configured (this is what session/init uses).
    if (registryAddress && ethers.isAddress(registryAddress)) {
      console.log('[UpGas][API][session/revoke] calling GlobalSessionRegistry.revokeSession', { sessionId });
      const tx = await withRelayer({
        pool: 'hub_trade',
        provider,
        stickyKey: sessionId,
        action: async (wallet) => {
          const reg = new ethers.Contract(registryAddress, (GlobalSessionRegistry as any).abi, wallet);
          const keys = loadRelayerPoolFromEnv({
            pool: 'global',
            globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
            allowFallbackSingleKey: true,
          });
          const relayerAddrs = keys.map((k) => ethers.getAddress(k.address));
          const relayerProof = computeRelayerProof(relayerAddrs, wallet.address);
          return await sendWithNonceRetry({
            provider,
            wallet,
            contract: reg,
            method: 'revokeSession',
            args: [sessionId, relayerProof],
            label: 'session:revoke:registry',
          });
        }
      });
      console.log('[UpGas][API][session/revoke] tx submitted', { txHash: tx.hash });
      const rc = await tx.wait();
      console.log('[UpGas][API][session/revoke] tx mined', { blockNumber: rc?.blockNumber });
      return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
    }

    // Fallback: legacy local session revoke on the orderBook diamond.
    console.log('[UpGas][API][session/revoke] registry missing; falling back to MetaTradeFacet.revokeSession', { sessionId });
    const tx = await withRelayer({
      pool: 'hub_trade',
      provider,
      stickyKey: sessionId,
      action: async (wallet) => {
        const meta = new ethers.Contract(orderBook, (MetaTradeFacet as any).abi, wallet);
        return await sendWithNonceRetry({
          provider,
          wallet,
          contract: meta,
          method: 'revokeSession',
          args: [sessionId],
          label: 'session:revoke:orderbook',
        });
      }
    });
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


