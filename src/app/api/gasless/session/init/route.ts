import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import GlobalSessionRegistry from '@/lib/abis/GlobalSessionRegistry.json';
import { sendWithNonceRetry, withRelayer } from '@/lib/relayerRouter';

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
      relayerSetRoot: permit?.relayerSetRoot,
      expiry: permit?.expiry,
    });
    if (!permit || typeof signature !== 'string') {
      return NextResponse.json({ error: 'missing payload' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    if (!registryAddress || !ethers.isAddress(registryAddress)) {
      return NextResponse.json({ error: 'server missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const registryRead = new ethers.Contract(registryAddress, (GlobalSessionRegistry as any).abi, provider);

    // Optional: compute sessionId locally to return immediately
    const sessionId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32', 'bytes32'],
      [permit.trader, permit.relayerSetRoot, permit.sessionSalt]
    ));
    console.log('[UpGas][API][session/init] computed sessionId', { sessionId });

    // Off-chain EIP-712 verification + nonce/expiry sanity checks to avoid opaque chain reverts
    try {
      const net = await provider.getNetwork();
      const domain = { name: 'DexetraMeta', version: '1', chainId: Number(net.chainId), verifyingContract: registryAddress } as const;
      const types = {
        SessionPermit: [
          { name: 'trader', type: 'address' },
          { name: 'relayerSetRoot', type: 'bytes32' },
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
      const onchainNonce = await registryRead.metaNonce(permit.trader);
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
    const tx = await withRelayer({
      pool: 'hub_trade',
      provider,
      stickyKey: permit?.trader,
      action: async (wallet, meta) => {
        console.log('[UpGas][API][session/init] selected relayer', {
          pool: 'hub_trade',
          relayer: wallet.address,
          relayerKeyId: meta?.key?.id,
          relayerKeyAddr: meta?.key?.address,
          stickyKey: permit?.trader,
        });
        const registry = new ethers.Contract(registryAddress, (GlobalSessionRegistry as any).abi, wallet);
        return await sendWithNonceRetry({
          provider,
          wallet,
          contract: registry,
          method: 'createSession',
          args: [permit, signature],
          label: 'session:init:createSession',
          overrides: { gasLimit: 1500000n },
        });
      }
    });
    console.log('[UpGas][API][session/init] tx submitted', { txHash: tx.hash });
    const waitConfirms = Number(process.env.GASLESS_SESSION_WAIT_CONFIRMS ?? '1');
    if (Number.isFinite(waitConfirms) && waitConfirms > 0) {
      const rc = await tx.wait(waitConfirms);
      console.log('[UpGas][API][session/init] tx mined', { blockNumber: rc?.blockNumber });
      return NextResponse.json({ sessionId, txHash: tx.hash, blockNumber: rc?.blockNumber });
    }
    console.log('[UpGas][API][session/init] broadcasted', { txHash: tx.hash, waitConfirms });
    return NextResponse.json({ sessionId, txHash: tx.hash });
  } catch (e: any) {
    const errorMessage = e?.message || String(e) || 'session init failed';
    const errorCode = e?.code || 'UNKNOWN';
    
    console.error('[GASLESS][API][session/init] error', {
      message: errorMessage,
      code: errorCode,
      stack: e?.stack,
    });
    console.error('[UpGas][API][session/init] error', e?.stack || errorMessage);
    
    // Parse specific error types for better user messages
    let userFriendlyError = errorMessage;
    const lowerMsg = errorMessage.toLowerCase();
    
    if (lowerMsg.includes('nonce') || lowerMsg.includes('replacement')) {
      userFriendlyError = 'Transaction nonce conflict. Please wait a moment and try again.';
    } else if (lowerMsg.includes('gas') || lowerMsg.includes('insufficient funds')) {
      userFriendlyError = 'Relayer gas issue. Please try again in a moment.';
    } else if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
      userFriendlyError = 'Request timed out. Please check your connection and try again.';
    } else if (lowerMsg.includes('network') || lowerMsg.includes('fetch')) {
      userFriendlyError = 'Network error connecting to blockchain. Please try again.';
    } else if (lowerMsg.includes('revert') || lowerMsg.includes('execution reverted')) {
      // Try to extract revert reason
      const revertMatch = errorMessage.match(/reason="([^"]+)"/);
      if (revertMatch) {
        userFriendlyError = `Transaction reverted: ${revertMatch[1]}`;
      } else {
        userFriendlyError = 'Transaction was rejected by the contract. Please try again.';
      }
    }
    
    return NextResponse.json({ 
      error: userFriendlyError,
      code: errorCode,
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    }, { status: 500 });
  }
}


