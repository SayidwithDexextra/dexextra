import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getPusherServer } from '@/lib/pusher-server';

type CheckResult = { name: string; pass: boolean; details?: Record<string, any> | string };

function selector(signature: string): string {
  return ethers.id(signature).slice(0, 10);
}

export async function POST(req: Request) {
  const startTs = Date.now();
  try {
    const body = await req.json();
    const orderBook: string = body?.orderBook;
    const autoFix: boolean = Boolean(body?.autoFix);
    const pipelineId: string = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const pusher = pipelineId ? getPusherServer() : null;
    const channel = pipelineId ? `deploy-${pipelineId}` : '';
    const push = (event: string, data: any) => {
      if (!pusher || !channel) return;
      try {
        (pusher as any)['pusher'].trigger(channel, 'progress', {
          step: event, status: 'info', data, timestamp: new Date().toISOString(),
        });
      } catch {}
    };
    push('inspect_gasless_start', { orderBook, autoFix });
    if (!orderBook || !ethers.isAddress(orderBook)) {
      return NextResponse.json({ error: 'invalid orderBook' }, { status: 400 });
    }
    const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
    const registryAddress = process.env.SESSION_REGISTRY_ADDRESS;
    const coreVault = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;
    if (!rpcUrl) return NextResponse.json({ error: 'missing RPC_URL' }, { status: 500 });
    if (!registryAddress || !ethers.isAddress(registryAddress)) {
      return NextResponse.json({ error: 'missing SESSION_REGISTRY_ADDRESS' }, { status: 500 });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const net = await provider.getNetwork();
      push('inspect_gasless_network', { chainId: String(net.chainId) });
    } catch {}
    const checks: CheckResult[] = [];
    const loupe = new ethers.Contract(orderBook, ['function facetAddress(bytes4) view returns (address)'], provider);
    // sessionRegistry presence and value
    let sessionRegistryOnDiamond: string | null = null;
    try {
      const selView = selector('sessionRegistry()');
      const viewFacet = await loupe.facetAddress(selView);
      checks.push({ name: 'diamond.hasSelector.sessionRegistry', pass: !!viewFacet && viewFacet !== ethers.ZeroAddress, details: { selector: selView, facet: viewFacet } });
      if (viewFacet && viewFacet !== ethers.ZeroAddress) {
        const meta = new ethers.Contract(orderBook, ['function sessionRegistry() view returns (address)'], provider);
        sessionRegistryOnDiamond = await meta.sessionRegistry();
        checks.push({ name: 'meta.sessionRegistry.nonzero', pass: !!sessionRegistryOnDiamond && sessionRegistryOnDiamond !== ethers.ZeroAddress, details: { sessionRegistryOnDiamond } });
        checks.push({
          name: 'meta.sessionRegistry.matches_env',
          pass: !!sessionRegistryOnDiamond && sessionRegistryOnDiamond.toLowerCase() === registryAddress.toLowerCase(),
          details: { sessionRegistryOnDiamond, expected: registryAddress },
        });
      }
    } catch (e: any) {
      checks.push({ name: 'meta.sessionRegistry.readable', pass: false, details: e?.message || String(e) });
    }
    // registry allowlist
    try {
      const reg = new ethers.Contract(registryAddress, ['function allowedOrderbook(address) view returns (bool)'], provider);
      const allowed = await reg.allowedOrderbook(orderBook);
      checks.push({ name: 'registry.allowedOrderbook', pass: allowed === true, details: { allowed } });
    } catch (e: any) {
      checks.push({ name: 'registry.allowedOrderbook.readable', pass: false, details: e?.message || String(e) });
    }
    // required selectors
    const required = [
      'sessionPlaceLimit(bytes32,address,uint256,uint256,bool)',
      'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool)',
      'sessionPlaceMarket(bytes32,address,uint256,bool)',
      'sessionPlaceMarginMarket(bytes32,address,uint256,bool)',
      'sessionModifyOrder(bytes32,address,uint256,uint256,uint256)',
      'sessionCancelOrder(bytes32,address,uint256)',
      'setSessionRegistry(address)',
    ];
    for (const sig of required) {
      try {
        const sel = selector(sig);
        const facet = await loupe.facetAddress(sel);
        checks.push({ name: `diamond.hasSelector.${sig}`, pass: !!facet && facet !== ethers.ZeroAddress, details: { selector: sel, facet } });
      } catch (e: any) {
        checks.push({ name: `diamond.hasSelector.${sig}.readable`, pass: false, details: e?.message || String(e) });
      }
    }
    // core vault roles (optional)
    if (coreVault && ethers.isAddress(coreVault)) {
      try {
        const vault = new ethers.Contract(coreVault, ['function hasRole(bytes32,address) view returns (bool)'], provider);
        const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
        const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
        const hasOB = await vault.hasRole(ORDERBOOK_ROLE, orderBook);
        const hasSET = await vault.hasRole(SETTLEMENT_ROLE, orderBook);
        checks.push({ name: 'coreVault.hasRole.ORDERBOOK_ROLE', pass: hasOB === true });
        checks.push({ name: 'coreVault.hasRole.SETTLEMENT_ROLE', pass: hasSET === true });
      } catch (e: any) {
        checks.push({ name: 'coreVault.roles.readable', pass: false, details: e?.message || String(e) });
      }
    }
    // Auto-fix if requested
    const failed = checks.filter((c) => !c.pass).map((c) => c.name);
    const fixes: any[] = [];
    if (autoFix && failed.length) {
      const pk = process.env.ADMIN_PRIVATE_KEY;
      if (!pk || !/^0x[a-fA-F0-9]{64}$/.test(pk)) {
        push('inspect_gasless_autofix_error', { error: 'ADMIN_PRIVATE_KEY missing/invalid; cannot autoFix' });
      } else {
        const wallet = new ethers.Wallet(pk, provider);
        // fix allowlist
        if (failed.includes('registry.allowedOrderbook')) {
          try {
            const reg = new ethers.Contract(registryAddress, ['function setAllowedOrderbook(address,bool) external'], wallet);
            const tx = await reg.setAllowedOrderbook(orderBook, true);
            push('inspect_gasless_fix_allow_sent', { txHash: tx.hash });
            const rc = await tx.wait();
            fixes.push({ action: 'allow_orderbook', txHash: tx.hash, blockNumber: rc?.blockNumber });
          } catch (e: any) {
            fixes.push({ action: 'allow_orderbook', error: e?.message || String(e) });
          }
        }
        // fix sessionRegistry zero/mismatch
        if (failed.includes('meta.sessionRegistry.nonzero') || failed.includes('meta.sessionRegistry.matches_env')) {
          try {
            const meta = new ethers.Contract(orderBook, ['function setSessionRegistry(address) external'], wallet);
            const tx = await meta.setSessionRegistry(registryAddress);
            push('inspect_gasless_fix_registry_sent', { txHash: tx.hash });
            const rc = await tx.wait();
            fixes.push({ action: 'set_session_registry', txHash: tx.hash, blockNumber: rc?.blockNumber });
          } catch (e: any) {
            fixes.push({ action: 'set_session_registry', error: e?.message || String(e) });
          }
        }
      }
    }
    const passCount = checks.filter((c) => c.pass).length;
    const total = checks.length;
    const rsp = {
      orderBook,
      registryAddress,
      coreVaultAddress: coreVault || null,
      summary: { pass: passCount, total, durationMs: Date.now() - startTs },
      checks,
      fixes,
    };
    push('inspect_gasless_done', rsp.summary);
    return NextResponse.json(rsp);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'inspect failed' }, { status: 500 });
  }
}





