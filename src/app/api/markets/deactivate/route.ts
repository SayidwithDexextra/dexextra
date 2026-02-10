import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { strictRateLimit } from '@/lib/rate-limit';

function extractError(e: any) {
  try {
    return (
      e?.shortMessage ||
      e?.reason ||
      e?.error?.message ||
      (typeof e?.data === 'string' ? e.data : undefined) ||
      (typeof e?.info?.error?.data === 'string' ? e.info.error.data : undefined) ||
      e?.message ||
      String(e)
    );
  } catch {
    return String(e);
  }
}

async function getTxOverrides(provider: ethers.Provider) {
  try {
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('2', 'gwei');
    const minMax = ethers.parseUnits('20', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('10', 'gwei');
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits('20', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('20', 'gwei') } as const;
  }
}

async function createNonceManager(signer: ethers.Wallet) {
  const address = await signer.getAddress();
  let next = await signer.provider!.getTransactionCount(address, 'pending');
  return {
    async nextOverrides() {
      const fee = await getTxOverrides(signer.provider!);
      const ov: any = { ...fee, nonce: next };
      next += 1;
      return ov;
    },
    async resync() {
      next = await signer.provider!.getTransactionCount(address, 'pending');
      return next;
    },
    async peek() {
      return next;
    },
  } as const;
}

export async function POST(req: Request) {
  try {
    // Rate limiting (sensitive: relayer submits on-chain tx)
    try {
      const identifier =
        req.headers.get('x-forwarded-for') ||
        req.headers.get('x-real-ip') ||
        'anonymous';
      const { success } = await strictRateLimit.limit(`markets.deactivate:${identifier}`);
      if (!success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    } catch {}

    const body = await req.json();
    const marketId = typeof body?.marketId === 'string' ? body.marketId.trim() : '';
    const orderBook = typeof body?.orderBook === 'string' ? body.orderBook.trim() : '';
    const creatorWalletAddress = typeof body?.creatorWalletAddress === 'string' ? body.creatorWalletAddress.trim() : '';
    const signature = typeof body?.signature === 'string' ? body.signature.trim() : '';
    const issuedAt = typeof body?.issuedAt === 'string' ? body.issuedAt.trim() : '';
    const deadline = typeof body?.deadline === 'string' ? body.deadline.trim() : '';
    const dryRun = Boolean(body?.dryRun);

    if (!marketId) return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'Invalid orderBook address' }, { status: 400 });
    }
    if (!creatorWalletAddress || !ethers.isAddress(creatorWalletAddress)) {
      return NextResponse.json({ error: 'Invalid creatorWalletAddress' }, { status: 400 });
    }
    if (!signature || !signature.startsWith('0x')) {
      return NextResponse.json({ error: 'signature is required' }, { status: 400 });
    }
    if (!issuedAt || !deadline) {
      return NextResponse.json({ error: 'issuedAt and deadline are required' }, { status: 400 });
    }

    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    const pk = process.env.ADMIN_PRIVATE_KEY;
    const factoryAddress =
      process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 400 });
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
      return NextResponse.json({ error: 'Factory address not configured' }, { status: 400 });
    }
    if (!sbUrl || !sbKey) return NextResponse.json({ error: 'Supabase service key not configured' }, { status: 400 });

    // Validate timestamp window to reduce replay/abuse
    try {
      const now = Date.now();
      const issuedMs = Date.parse(issuedAt);
      const deadlineMs = Date.parse(deadline);
      if (!Number.isFinite(issuedMs) || !Number.isFinite(deadlineMs)) throw new Error('bad date');
      if (deadlineMs < now) return NextResponse.json({ error: 'Signature expired' }, { status: 400 });
      // Must be issued recently (2 minutes)
      if (Math.abs(now - issuedMs) > 2 * 60 * 1000) {
        return NextResponse.json({ error: 'Signature timestamp too old or too far in future' }, { status: 400 });
      }
      if (deadlineMs - issuedMs > 5 * 60 * 1000) {
        return NextResponse.json({ error: 'Signature deadline window too large' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid issuedAt/deadline' }, { status: 400 });
    }

    // Verify the market belongs to the creator (DB is the source of truth for Settings UI)
    const supabase = createClient(sbUrl, sbKey);
    const { data: marketRow, error: marketErr } = await supabase
      .from('markets')
      .select('id, market_address, creator_wallet_address')
      .eq('id', marketId)
      .maybeSingle();

    if (marketErr) {
      return NextResponse.json({ error: 'Failed to look up market', details: marketErr.message }, { status: 500 });
    }
    if (!marketRow?.id) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }
    const dbOrderBook = String((marketRow as any).market_address || '').trim();
    const dbCreator = String((marketRow as any).creator_wallet_address || '').trim();
    if (!dbOrderBook || dbOrderBook.toLowerCase() !== orderBook.toLowerCase()) {
      return NextResponse.json({ error: 'Market/orderBook mismatch' }, { status: 400 });
    }
    if (!dbCreator || dbCreator.toLowerCase() !== creatorWalletAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Not authorized for this market' }, { status: 403 });
    }

    // Verify signature (EIP-191 personal_sign)
    const message =
      `Dexextra: Deactivate market (bond refund)\n` +
      `marketId: ${marketId}\n` +
      `orderBook: ${orderBook}\n` +
      `factory: ${factoryAddress}\n` +
      `creator: ${creatorWalletAddress}\n` +
      `issuedAt: ${issuedAt}\n` +
      `deadline: ${deadline}\n`;
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch (e: any) {
      return NextResponse.json({ error: 'Invalid signature', details: extractError(e) }, { status: 400 });
    }
    if (recovered.toLowerCase() !== creatorWalletAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Signature does not match creator' }, { status: 403 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const nonceMgr = await createNonceManager(wallet);
    const sender = await wallet.getAddress();

    // Minimal ABI to avoid drift; this is stable and small.
    const factoryAbi = ['function deactivateFuturesMarket(address orderBook)'];
    const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);

    // Resolve marketId (bytes32) + vault address from the orderbook itself.
    // We use this to "finalize" the market (settle) so new orders cannot be placed.
    let marketIdBytes32: string | null = null;
    let vaultAddressFromOB: string | null = null;
    try {
      const ob = new ethers.Contract(
        orderBook,
        ['function marketStatic() view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)'],
        provider
      );
      const [v, mid] = await ob.marketStatic();
      vaultAddressFromOB = String(v || '').trim();
      marketIdBytes32 = String(mid || '').trim();
      if (!ethers.isAddress(vaultAddressFromOB)) vaultAddressFromOB = null;
      if (!marketIdBytes32 || !marketIdBytes32.startsWith('0x') || marketIdBytes32.length !== 66) marketIdBytes32 = null;
    } catch {}

    if (!vaultAddressFromOB || !marketIdBytes32) {
      return NextResponse.json({ error: 'Could not resolve marketId/vault from orderBook' }, { status: 400 });
    }

    // Preflight: ensure orderBook has bytecode
    try {
      const code = await provider.getCode(orderBook);
      if (!code || code === '0x' || code === '0x0') {
        return NextResponse.json({ error: 'orderBook has no bytecode' }, { status: 400 });
      }
    } catch {}

    // Preflight staticcall to surface the exact revert reason without spending gas.
    try {
      await factory.deactivateFuturesMarket.staticCall(orderBook, { from: sender });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: 'deactivate preflight failed',
          details: extractError(e),
        },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        factory: factoryAddress,
        orderBook,
        sender,
        recovered,
        marketIdBytes32,
        coreVault: vaultAddressFromOB,
      });
    }

    // 1) Settle market to stop all new trading.
    // Order placement facets check CoreVault.marketSettled(marketId) and will revert once settled.
    const vault = new ethers.Contract(
      vaultAddressFromOB,
      [
        'function marketSettled(bytes32 marketId) view returns (bool)',
        'function getMarkPrice(bytes32 marketId) view returns (uint256)',
        'function settleMarket(bytes32 marketId, uint256 finalPrice)',
      ],
      wallet
    );

    let settlementTxHash: string | null = null;
    let finalPriceUsed: string | null = null;
    try {
      const alreadySettled: boolean = Boolean(await vault.marketSettled(marketIdBytes32));
      if (!alreadySettled) {
        const mark: bigint = await vault.getMarkPrice(marketIdBytes32);
        if (!(mark > 0n)) {
          return NextResponse.json({ error: 'Cannot settle: mark price is 0' }, { status: 400 });
        }
        finalPriceUsed = mark.toString();
        // best-effort staticcall preflight
        try {
          await vault.settleMarket.staticCall(marketIdBytes32, mark, { from: sender });
        } catch (e: any) {
          return NextResponse.json(
            { error: 'settle preflight failed', details: extractError(e) },
            { status: 400 }
          );
        }
        const txSettle = await vault.settleMarket(marketIdBytes32, mark, await nonceMgr.nextOverrides());
        const rcSettle = await txSettle.wait();
        settlementTxHash = txSettle.hash;
        if (rcSettle?.status !== 1) {
          return NextResponse.json({ error: 'Settlement transaction failed', txHash: txSettle.hash }, { status: 500 });
        }
      }
    } catch (e: any) {
      return NextResponse.json({ error: 'Failed to settle market', details: extractError(e) }, { status: 500 });
    }

    // Send tx (relayer/admin pays gas)
    const tx = await factory.deactivateFuturesMarket(orderBook, await nonceMgr.nextOverrides());
    const receipt = await tx.wait();

    // Persist deactivation in Supabase so the market is treated as inactive across the app.
    // Note: this endpoint is specifically used for "bond refund via deactivation", so we always flip is_active off.
    let dbUpdated = false;
    let dbUpdateError: string | null = null;
    try {
      if (receipt?.status === 1) {
        const { error: updErr } = await supabase
          .from('markets')
          .update({
            is_active: false,
            // The market was settled above (or already settled). Use SETTLED so UIs stop treating it as tradable.
            market_status: 'SETTLED',
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', marketId);
        if (updErr) {
          dbUpdateError = updErr.message;
        } else {
          dbUpdated = true;
        }
      }
    } catch (e: any) {
      dbUpdateError = extractError(e);
    }

    return NextResponse.json({
      ok: true,
      factory: factoryAddress,
      orderBook,
      sender,
      coreVault: vaultAddressFromOB,
      marketIdBytes32,
      settlementTxHash,
      finalPriceUsed,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? null,
      status: receipt?.status ?? null,
      dbUpdated,
      dbUpdateError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: extractError(e) }, { status: 500 });
  }
}

