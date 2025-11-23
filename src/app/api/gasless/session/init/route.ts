import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const permit = body?.permit;
    const signature: string = body?.signature;
    console.log('[UpGas][API][session/init] incoming', {
      orderBook,
      hasPermit: !!permit,
      hasSignature: typeof signature === 'string',
      trader: permit?.trader,
      relayer: permit?.relayer,
      expiry: permit?.expiry,
    });
    if (!permit || typeof signature !== 'string') {
      return NextResponse.json({ error: 'missing payload' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const pk = process.env.RELAYER_PRIVATE_KEY;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    if (!rpcUrl || !pk) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    if (!registryAddress || !ethers.isAddress(registryAddress)) {
      return NextResponse.json({ error: 'server missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const registry = new ethers.Contract(registryAddress, (GlobalSessionRegistry as any).abi, wallet);

    // Optional: compute sessionId locally to return immediately
    const sessionId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'bytes32'],
      [permit.trader, permit.relayer, permit.sessionSalt]
    ));
    console.log('[UpGas][API][session/init] computed sessionId', { sessionId });

    // Off-chain EIP-712 verification + nonce/expiry sanity checks to avoid opaque chain reverts
    try {
      const net = await provider.getNetwork();
      const domain = { name: 'DexetraMeta', version: '1', chainId: Number(net.chainId), verifyingContract: registryAddress } as const;
      const types = {
        SessionPermit: [
          { name: 'trader', type: 'address' },
          { name: 'relayer', type: 'address' },
          { name: 'expiry', type: 'uint256' },
          { name: 'maxNotionalPerTrade', type: 'uint256' },
          { name: 'maxNotionalPerSession', type: 'uint256' },
          { name: 'methodsBitmap', type: 'bytes32' },
          { name: 'sessionSalt', type: 'bytes32' },
          { name: 'allowedMarkets', type: 'bytes32[]' },
          { name: 'nonce', type: 'uint256' },
        ],
      } as const;
      const recovered = ethers.verifyTypedData(domain as any, types as any, permit, signature);
      console.log('[UpGas][API][session/init] verifyTypedData', { recovered, expected: permit?.trader });
      if (!recovered || recovered.toLowerCase() !== String(permit?.trader).toLowerCase()) {
        return NextResponse.json({ error: 'bad_sig', recovered, expected: permit?.trader }, { status: 400 });
      }
      const onchainNonce = await registry.metaNonce(permit.trader);
      if (onchainNonce?.toString?.() !== String(permit.nonce)) {
        console.log('[UpGas][API][session/init] bad nonce', { expected: onchainNonce?.toString?.(), got: String(permit.nonce) });
        return NextResponse.json({ error: 'bad_nonce', expected: onchainNonce?.toString?.(), got: String(permit.nonce) }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      if (now > Number(permit.expiry)) {
        console.log('[UpGas][API][session/init] expired', { now, expiry: Number(permit.expiry) });
        return NextResponse.json({ error: 'expired' }, { status: 400 });
      }
    } catch (e: any) {
      console.log('[UpGas][API][session/init] offchain verify error', e?.message || e);
      // continue; on-chain will still provide revert if mismatched
    }

    console.log('[UpGas][API][session/init] calling createSession on registry...');
    try {
      const tx = await registry.createSession(permit, signature);
      console.log('[UpGas][API][session/init] tx submitted', { txHash: tx.hash });
      const rc = await tx.wait();
      console.log('[UpGas][API][session/init] tx mined', { blockNumber: rc?.blockNumber });
      return NextResponse.json({ sessionId, txHash: tx.hash, blockNumber: rc?.blockNumber });
    } catch (e: any) {
      console.log('[UpGas][API][session/init] createSession failed, attempting raw send with gasLimit', e?.message || e);
      try {
        const iface = new ethers.Interface((GlobalSessionRegistry as any).abi);
        const data = iface.encodeFunctionData('createSession', [permit, signature]);
        const tx2 = await wallet.sendTransaction({
          to: registryAddress,
          data,
          gasLimit: 1500000n,
        });
        console.log('[UpGas][API][session/init] raw tx submitted', { txHash: tx2.hash });
        const rc2 = await tx2.wait();
        console.log('[UpGas][API][session/init] raw tx mined', { blockNumber: rc2?.blockNumber });
        return NextResponse.json({ sessionId, txHash: tx2.hash, blockNumber: rc2?.blockNumber });
      } catch (e2: any) {
        console.error('[UpGas][API][session/init] raw send failed', e2?.stack || e2?.message || String(e2));
        throw e2;
      }
    }
  } catch (e: any) {
    console.error('[GASLESS][API][session/init] error', e?.message || e);
    console.error('[UpGas][API][session/init] error', e?.stack || e?.message || String(e));
    return NextResponse.json({ error: e?.message || 'session init failed' }, { status: 500 });
  }
}


