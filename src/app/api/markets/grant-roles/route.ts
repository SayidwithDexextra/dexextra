import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CoreVaultABI, resolveFactoryVault } from '@/lib/contracts';

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

async function getTxOverrides() {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL);
    const fee = await provider.getFeeData();
    const minPriority = ethers.parseUnits('0.1', 'gwei');
    const minMax = ethers.parseUnits('1', 'gwei');
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority = fee.maxPriorityFeePerGas > minPriority ? fee.maxPriorityFeePerGas : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority } as const;
    }
    const base = fee.gasPrice || ethers.parseUnits('0.5', 'gwei');
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits('1', 'gwei');
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy } as const;
  } catch {
    return { gasPrice: ethers.parseUnits('1', 'gwei') } as const;
  }
}

export async function POST(req: Request) {
  try {
    const { orderBook, coreVault: coreVaultOverride } = await req.json();
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'Invalid orderBook address' }, { status: 400 });
    }

    const envCoreVault =
      coreVaultOverride || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS || (globalThis as any).process?.env?.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
    if (!envCoreVault || !ethers.isAddress(envCoreVault)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    const adminPk = process.env.ADMIN_PRIVATE_KEY || process.env.ROLE_ADMIN_PRIVATE_KEY;
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    if (!adminPk || !rpcUrl) {
      return NextResponse.json({ error: 'Server admin key or RPC URL not configured' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(adminPk, provider);

    // When no explicit override, auto-resolve via factory to prevent mismatch
    const { effectiveVault: coreVaultAddress, mismatch } =
      coreVaultOverride
        ? { effectiveVault: coreVaultOverride, mismatch: false }
        : await resolveFactoryVault(provider, envCoreVault);
    if (mismatch) {
      logStep('vault_mismatch', 'start', {
        envCoreVault, factoryVault: coreVaultAddress,
        action: 'using factory vault for role grants',
      });
    }

    logStep('grant_roles', 'start', { orderBook, coreVault: coreVaultAddress });

    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);

    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

    const results: any = {};
    try {
      logStep('grant_ORDERBOOK_ROLE', 'start', { orderBook });
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, await getTxOverrides());
      logStep('grant_ORDERBOOK_ROLE_tx_sent', 'success', { tx: tx1.hash });
      const r1 = await tx1.wait();
      results.ORDERBOOK_ROLE = { tx: r1?.hash || tx1.hash, blockNumber: r1?.blockNumber };
      logStep('grant_ORDERBOOK_ROLE_tx_mined', 'success', results.ORDERBOOK_ROLE);
    } catch (e: any) {
      results.ORDERBOOK_ROLE = { error: e?.message || String(e) };
      logStep('grant_ORDERBOOK_ROLE', 'error', results.ORDERBOOK_ROLE);
      return NextResponse.json({ error: 'ORDERBOOK_ROLE grant failed', details: results.ORDERBOOK_ROLE.error }, { status: 500 });
    }
    try {
      logStep('grant_SETTLEMENT_ROLE', 'start', { orderBook });
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, await getTxOverrides());
      logStep('grant_SETTLEMENT_ROLE_tx_sent', 'success', { tx: tx2.hash });
      const r2 = await tx2.wait();
      results.SETTLEMENT_ROLE = { tx: r2?.hash || tx2.hash, blockNumber: r2?.blockNumber };
      logStep('grant_SETTLEMENT_ROLE_tx_mined', 'success', results.SETTLEMENT_ROLE);
    } catch (e: any) {
      results.SETTLEMENT_ROLE = { error: e?.message || String(e) };
      logStep('grant_SETTLEMENT_ROLE', 'error', results.SETTLEMENT_ROLE);
      return NextResponse.json({ error: 'SETTLEMENT_ROLE grant failed', details: results.SETTLEMENT_ROLE.error }, { status: 500 });
    }

    logStep('grant_roles', 'success', { orderBook, coreVault: coreVaultAddress });
    return NextResponse.json({ ok: true, coreVault: coreVaultAddress, orderBook, results });
  } catch (e: any) {
    logStep('grant_roles', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Role grant failed' }, { status: 500 });
  }
}


