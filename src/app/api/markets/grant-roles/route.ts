import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

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

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(adminPk, provider);

    const coreVaultAbi = (await import('@/../Dexetrav5/artifacts/src/CoreVault.sol/CoreVault.json')).default.abi;
    const coreVault = new ethers.Contract(coreVaultAddress, coreVaultAbi, wallet);

    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

    const results: any = {};
    try {
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
      const r1 = await tx1.wait();
      results.ORDERBOOK_ROLE = { tx: tx1.hash, blockNumber: r1?.blockNumber };
    } catch (e: any) {
      results.ORDERBOOK_ROLE = { error: e?.message || String(e) };
    }
    try {
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
      const r2 = await tx2.wait();
      results.SETTLEMENT_ROLE = { tx: tx2.hash, blockNumber: r2?.blockNumber };
    } catch (e: any) {
      results.SETTLEMENT_ROLE = { error: e?.message || String(e) };
    }

    return NextResponse.json({ ok: true, coreVault: coreVaultAddress, orderBook, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Role grant failed' }, { status: 500 });
  }
}


