import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CoreVaultABI } from '@/lib/contracts';

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'grant_roles',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

export async function POST(req: Request) {
  try {
    const { orderBook, coreVault: coreVaultOverride } = await req.json();
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'Invalid orderBook address' }, { status: 400 });
    }

    const coreVaultAddress =
      coreVaultOverride || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS || (globalThis as any).process?.env?.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
    if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    const adminPk = process.env.ADMIN_PRIVATE_KEY || process.env.ROLE_ADMIN_PRIVATE_KEY;
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    if (!adminPk || !rpcUrl) {
      return NextResponse.json({ error: 'Server admin key or RPC URL not configured' }, { status: 400 });
    }

    logStep('grant_roles', 'start', { orderBook, coreVault: coreVaultAddress });
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(adminPk, provider);

    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);

    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

    const results: any = {};
    try {
      logStep('grant_ORDERBOOK_ROLE', 'start', { orderBook });
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
      const r1 = await tx1.wait();
      results.ORDERBOOK_ROLE = { tx: tx1.hash, blockNumber: r1?.blockNumber };
      logStep('grant_ORDERBOOK_ROLE', 'success', results.ORDERBOOK_ROLE);
    } catch (e: any) {
      results.ORDERBOOK_ROLE = { error: e?.message || String(e) };
      logStep('grant_ORDERBOOK_ROLE', 'error', results.ORDERBOOK_ROLE);
    }
    try {
      logStep('grant_SETTLEMENT_ROLE', 'start', { orderBook });
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
      const r2 = await tx2.wait();
      results.SETTLEMENT_ROLE = { tx: tx2.hash, blockNumber: r2?.blockNumber };
      logStep('grant_SETTLEMENT_ROLE', 'success', results.SETTLEMENT_ROLE);
    } catch (e: any) {
      results.SETTLEMENT_ROLE = { error: e?.message || String(e) };
      logStep('grant_SETTLEMENT_ROLE', 'error', results.SETTLEMENT_ROLE);
    }

    logStep('grant_roles', 'success', { orderBook, coreVault: coreVaultAddress });
    return NextResponse.json({ ok: true, coreVault: coreVaultAddress, orderBook, results });
  } catch (e: any) {
    logStep('grant_roles', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Role grant failed' }, { status: 500 });
  }
}


