import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import CoreVaultAbi from '@/lib/abis/CoreVault.json';
import { sendWithNonceRetry, withRelayer, isInsufficientFundsError } from '@/lib/relayerRouter';
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys';
import { computeRelayerProof } from '@/lib/relayerMerkle';

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
    const body = await req.json();
    const { vault, user, marketId, amount, sessionId, signature, nonce } = body;

    if (!vault || !ethers.isAddress(vault)) return bad('invalid vault');
    if (!user || !ethers.isAddress(user)) return bad('invalid user');
    if (!marketId || !ethers.isHexString(marketId, 32)) return bad('invalid marketId');
    if (amount === undefined || amount === null) return bad('missing amount');

    let amountBn: bigint;
    try {
      amountBn = ethers.toBigInt(amount);
      if (amountBn <= 0n) return bad('amount must be greater than 0');
    } catch {
      return bad('invalid amount');
    }

    const isSession = Boolean(sessionId) && !signature;

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    let tx: any;

    if (isSession) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return bad('invalid sessionId');

      const globalKeys = loadRelayerPoolFromEnv({
        pool: 'global',
        globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
        allowFallbackSingleKey: true,
      });
      const relayerAddrs = globalKeys.map((k) => ethers.getAddress(k.address));

      tx = await withRelayer({
        pool: 'hub_trade',
        provider,
        stickyKey: user,
        action: async (wallet) => {
          const relayerProof = computeRelayerProof(relayerAddrs, wallet.address);
          const cv = new ethers.Contract(vault, CoreVaultAbi.abi, wallet);
          return await sendWithNonceRetry({
            provider,
            wallet,
            contract: cv,
            method: 'sessionTopUpPositionMargin',
            args: [sessionId, user, marketId, amountBn, wallet.address, relayerProof],
            label: 'topup:sessionTopUpPositionMargin',
          });
        },
      });
    } else {
      if (!signature || typeof signature !== 'string') return bad('missing signature');
      const sig = ethers.Signature.from(signature);
      tx = await withRelayer({
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
        },
      });
    }

    const waitConfirms = Number(process.env.GASLESS_TRADE_WAIT_CONFIRMS ?? '0');
    if (waitConfirms > 0) {
      const rc = await provider.waitForTransaction(tx.hash, waitConfirms);
      return NextResponse.json({ txHash: tx.hash, blockNumber: rc?.blockNumber });
    }
    return NextResponse.json({ txHash: tx.hash });
  } catch (e: any) {
    if (isInsufficientFundsError(e) || String(e?.message || '').includes('insufficient funds for gas')) {
      console.error('[TOPUP] all relayers out of funds', e?.message || e);
      return NextResponse.json(
        { error: 'all_relayers_insufficient_funds', message: 'All relayers in the pool have insufficient gas funds. Please try again later.' },
        { status: 503 },
      );
    }
    console.error('[GASLESS][API][topup][POST] relay failed', e);
    return bad(e?.message || 'relay failed', 500);
  }
}

