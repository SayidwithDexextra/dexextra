import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import path from 'path';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { archivePage } from '@/lib/archivePage';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  CoreVaultABI,
} from '@/lib/contracts';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import MarketLifecycleFacetArtifact from '@/lib/abis/facets/MarketLifecycleFacet.json';
import MetaTradeFacetArtifact from '@/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '@/lib/abis/facets/OrderBookVaultAdminFacet.json';
import { getPusherServer } from '@/lib/pusher-server';

// Vercel: this endpoint can be long-running during deployment.
export const runtime = 'nodejs';
export const maxDuration = 300;

function shortAddr(a: any) {
  const s = String(a || '');
  return (s.startsWith('0x') && s.length === 42) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function trunc(s: any, n = 120) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function maskSecret(v: any, opts?: { showStart?: number; showEnd?: number }) {
  const s = String(v ?? '');
  if (!s) return '';
  const showStart = Math.max(0, opts?.showStart ?? 0);
  const showEnd = Math.max(0, opts?.showEnd ?? 0);
  if (s.length <= showStart + showEnd) return `${s.slice(0, Math.min(2, s.length))}…`;
  return `${s.slice(0, showStart)}…${s.slice(s.length - showEnd)}`;
}

function safeUrlInfo(v: any) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  try {
    // If this is a bare host without protocol, coerce for parsing.
    const hasProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
    const u = new URL(hasProto ? raw : `https://${raw}`);
    return {
      protocol: hasProto ? u.protocol : null,
      host: u.host,
      origin: `${u.protocol}//${u.host}`,
      pathname: u.pathname && u.pathname !== '/' ? u.pathname : '',
    };
  } catch {
    // Not a URL; return a truncated string.
    return { raw: trunc(raw, 120) };
  }
}

function envSource(primaryName: string, fallbackName: string) {
  const p = (process.env as any)[primaryName];
  const f = (process.env as any)[fallbackName];
  return p ? primaryName : f ? fallbackName : null;
}

function friendly(step: string) {
  const map: Record<string, string> = {
    validate_input: 'Validate Input',
    wallet_ready: 'Wallet Ready',
    facet_cut_built: 'Build Diamond Cut',
    factory_static_call: 'Factory Static Call',
    factory_send_tx_prep: 'Prepare Tx',
    factory_send_tx: 'Send Tx',
    factory_send_tx_sent: 'Tx Sent',
    factory_confirm: 'Confirm Tx',
    factory_confirm_mined: 'Mined',
    factory_static_call_meta: 'Factory Static Call (Meta)',
    factory_send_tx_meta: 'Send Tx (Meta)',
    factory_send_tx_meta_sent: 'Tx Sent (Meta)',
    factory_confirm_meta: 'Confirm (Meta)',
    factory_confirm_meta_mined: 'Mined (Meta)',
    ensure_selectors: 'Ensure Placement Selectors',
    ensure_selectors_missing: 'Patch Missing Selectors',
    diamond_cut: 'Diamond Cut',
    attach_session_registry: 'Attach Session Registry',
    attach_session_registry_sent: 'Attach Session Registry (Sent)',
    attach_session_registry_mined: 'Attach Session Registry (Mined)',
    grant_roles: 'Grant CoreVault Roles',
    grant_ORDERBOOK_ROLE_sent: 'Grant ORDERBOOK_ROLE (Sent)',
    grant_ORDERBOOK_ROLE_mined: 'Grant ORDERBOOK_ROLE (Mined)',
    grant_SETTLEMENT_ROLE_sent: 'Grant SETTLEMENT_ROLE (Sent)',
    grant_SETTLEMENT_ROLE_mined: 'Grant SETTLEMENT_ROLE (Mined)',
    // Removed: configure_market and immediate OB param updates to speed deploys
    save_market: 'Save Market (DB)',
    unhandled_error: 'Unhandled Error',
  };
  return map[step] || step;
}

function summarizeData(data?: Record<string, any>) {
  if (!data || typeof data !== 'object') return '';
  const parts: string[] = [];
  if (data.orderBook) parts.push(`orderBook=${shortAddr(data.orderBook)}`);
  if (data.marketId) parts.push(`marketId=${trunc(data.marketId, 12)}`);
  if (data.hash) parts.push(`tx=${trunc(data.hash, 12)}`);
  if (data.block != null || data.blockNumber != null) parts.push(`block=${data.block ?? data.blockNumber}`);
  if (data.missingCount != null) parts.push(`missing=${data.missingCount}`);
  if (data.nonce != null) parts.push(`nonce=${data.nonce}`);
  if (Array.isArray((data as any).cutSummary)) parts.push(`facets=${(data as any).cutSummary.length}`);
  if ((data as any).payer) parts.push(`payer=${shortAddr((data as any).payer)}`);
  if ((data as any).spent) parts.push(`spent=${(data as any).spent} ${(data as any).nativeSymbol || getNativeTokenSymbol()}`);
  if (data.error) parts.push(`error=${trunc(data.error, 100)}`);
  return parts.length ? ` — ${parts.join(' ')}` : '';
}

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

function getNativeTokenSymbol(): string {
  return (
    process.env.NATIVE_TOKEN_SYMBOL ||
    (process.env as any).NEXT_PUBLIC_NATIVE_TOKEN_SYMBOL ||
    'HYPE'
  );
}

async function computeTxSpend(provider: any, payer: string, receipt: any): Promise<Record<string, any>> {
  try {
    const bnRaw = (receipt && (receipt.blockNumber as any)) ?? 0;
    const bn = typeof bnRaw === 'bigint' ? Number(bnRaw) : Number(bnRaw || 0);
    const before = await provider.getBalance(payer, bn > 0 ? bn - 1 : bn);
    const after = await provider.getBalance(payer, bn);
    const spent = (typeof before === 'bigint' && typeof after === 'bigint' && before > after) ? (before - after) : 0n;
    return {
      payer,
      nativeSymbol: getNativeTokenSymbol(),
      balanceBefore: ethers.formatEther(before),
      balanceAfter: ethers.formatEther(after),
      spent: ethers.formatEther(spent),
    };
  } catch {
    return { payer, nativeSymbol: getNativeTokenSymbol() };
  }
}

function logStep(step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) {
  try {
    const ts = new Date().toISOString();
    const tag = `${COLORS.bold}${COLORS.cyan}[CreateMarket]${COLORS.reset}`;
    const name = friendly(step);
    const emoji = status === 'start' ? '🟦' : status === 'success' ? '✅' : '❌';
    const color =
      status === 'start' ? COLORS.yellow :
      status === 'success' ? COLORS.green :
      COLORS.red;
    const human = `${tag} ${emoji} ${color}${name}${COLORS.reset}${summarizeData(data)}  ${COLORS.dim}${ts}${COLORS.reset}`;
    // Human-friendly line
    console.log(human);
    // Structured line (machine-readable)
    console.log(JSON.stringify({
      area: 'market_creation',
      context: 'markets_create',
      step,
      status,
      timestamp: new Date().toISOString(),
      ...((data && typeof data === 'object') ? data : {})
    }));
  } catch {}
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function archiveWithTimeout(
  url: string,
  opts: Parameters<typeof archivePage>[1],
  timeoutMs = 4500
) {
  return await Promise.race([
    archivePage(url, opts),
    new Promise<Awaited<ReturnType<typeof archivePage>>>((resolve) =>
      setTimeout(() => resolve({ success: false, error: 'timeout' }), timeoutMs)
    ),
  ]);
}

function selectorsFromAbi(abi: any[]): string[] {
  try {
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag) => frag?.type === 'function')
      .map((frag) => ethers.id((frag as any).format('sighash')).slice(0, 10));
  } catch (e: any) {
    try {
      return (abi || [])
        .filter((f: any) => f && typeof f === 'object' && f.type === 'function')
        .map((f: any) => {
          const sig = `${f.name}(${(f.inputs || []).map((i: any) => i.type).join(',')})`;
          return ethers.id(sig).slice(0, 10);
        });
    } catch {
      return [];
    }
  }
}

function loadFacetAbi(contractName: string, fallbackAbi: any[]): any[] {
  try {
    const artifactPath = path.join(
      process.cwd(),
      'Dexetrav5',
      'artifacts',
      'src',
      'diamond',
      'facets',
      `${contractName}.sol`,
      `${contractName}.json`
    );
    const raw = readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(raw);
    if (artifact && Array.isArray((artifact as any).abi)) return (artifact as any).abi;
  } catch {}
  return fallbackAbi;
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
      // Resynchronize local nonce with provider pending nonce to recover from NONCE_EXPIRED
      next = await signer.provider!.getTransactionCount(address, 'pending');
      return next;
    },
    async peek() {
      return next;
    }
  } as const;
}

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

function decodeRevert(iface: ethers.Interface, e: any) {
  try {
    const data =
      (typeof e?.data === 'string' && e.data) ||
      (typeof e?.error?.data === 'string' && e.error.data) ||
      (typeof e?.info?.error?.data === 'string' && e.info.error.data) ||
      null;
    if (data && data.startsWith('0x')) {
      try {
        const parsed = iface.parseError(data);
        return {
          name: parsed?.name || null,
          args: parsed?.args ? Array.from(parsed.args) : null,
          data,
        };
      } catch {
        return { name: null, args: null, data };
      }
    }
  } catch {}
  return null;
}

const ERROR_SELECTORS: Record<string, string> = {
  '0x5cd5d233': 'BadSignature',
  '0x7fb0cdec': 'MetaExpired',
  '0x4bd574ec': 'BadNonce',
  '0x6dfe7469': 'MarketCreationRestricted',
  '0xd92e233d': 'ZeroAddress',
  '0x1f8f95a0': 'InvalidOraclePrice',
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pipelineId = typeof body?.pipelineId === 'string' ? String(body.pipelineId) : '';
    const pusher = pipelineId ? getPusherServer() : null;
    const pusherChannel = pipelineId ? `deploy-${pipelineId}` : '';
    const logS = (step: string, status: 'start' | 'success' | 'error', data?: Record<string, any>) => {
      logStep(step, status, data);
      if (pusher && pusherChannel) {
        try {
          (pusher as any)['pusher'].trigger(pusherChannel, 'progress', {
            step, status, data: data || {}, timestamp: new Date().toISOString(),
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('[create/route] pusher broadcast failed', e?.message || String(e));
        }
      }
    };
    const rawSymbol = String(body?.symbol || '').trim();
    const symbol = rawSymbol.toUpperCase();
    const metricUrl = String(body?.metricUrl || '').trim();
    const startPrice = String(body?.startPrice || '1');
    const startPrice6Input = body?.startPrice6;
    const startPrice6 = (startPrice6Input !== undefined && startPrice6Input !== null)
      ? BigInt(String(startPrice6Input))
      : ethers.parseUnits(startPrice, 6);
    const dataSource = String(body?.dataSource || 'User Provided');
    const tags = Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t: any) => String(t)) : [];
    const providedName = typeof body?.name === 'string' ? String(body.name).trim() : '';
    const providedDescription = typeof body?.description === 'string' ? String(body.description).trim() : '';
    const creatorWalletAddress = (body?.creatorWalletAddress && ethers.isAddress(body.creatorWalletAddress)) ? body.creatorWalletAddress : null;
    const clientCutArg = Array.isArray(body?.cutArg) ? body.cutArg : (Array.isArray(body?.cut) ? body.cut : null);
    const iconImageUrl = body?.iconImageUrl ? String(body.iconImageUrl).trim() : null;
    const bannerImageUrl = body?.bannerImageUrl ? String(body.bannerImageUrl).trim() : null;
    const aiSourceLocator = body?.aiSourceLocator || null;
    // Validate settlement date is required and in the future
    if (!body?.settlementDate || typeof body.settlementDate !== 'number' || body.settlementDate <= 0) {
      return NextResponse.json({
        error: 'settlementDate is required and must be a valid future Unix timestamp'
      }, { status: 400 });
    }

    const settlementTs = Math.floor(body.settlementDate);
    const now = Math.floor(Date.now() / 1000);

    if (settlementTs <= now) {
      return NextResponse.json({
        error: 'settlementDate must be in the future'
      }, { status: 400 });
    }

    // One comprehensive, machine-readable env/config snapshot for Vercel vs localhost comparisons.
    // IMPORTANT: keep secrets masked; prefer presence + length over raw values.
    try {
      const headers = req.headers;
      const nodeEnv = process.env.NODE_ENV;
      const vercelEnv = process.env.VERCEL_ENV;
      const vercel = String(process.env.VERCEL || '') === '1';

      const rpcUrlSource =
        process.env.RPC_URL ? 'RPC_URL' :
        process.env.JSON_RPC_URL ? 'JSON_RPC_URL' :
        process.env.ALCHEMY_RPC_URL ? 'ALCHEMY_RPC_URL' :
        null;
      const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;

      const adminPk = process.env.ADMIN_PRIVATE_KEY;
      const appUrl = process.env.APP_URL;
      const gaslessEnabled = String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true';

      const factoryAddressSource = envSource('FUTURES_MARKET_FACTORY_ADDRESS', 'NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS');
      const initFacetSource = envSource('ORDER_BOOK_INIT_FACET', 'NEXT_PUBLIC_ORDER_BOOK_INIT_FACET');
      const coreVaultSource = envSource('CORE_VAULT_ADDRESS', 'NEXT_PUBLIC_CORE_VAULT_ADDRESS');

      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

      const snapshot = {
        tag: 'RELAYER_ENV_SNAPSHOT',
        area: 'market_creation',
        route: 'POST /api/markets/create',
        timestamp: new Date().toISOString(),
        runtime: {
          nodeEnv,
          nextRuntime: (process.env as any).NEXT_RUNTIME || null,
          vercel,
          vercelEnv: vercelEnv || null,
          vercelUrl: process.env.VERCEL_URL || null,
          vercelRegion: process.env.VERCEL_REGION || null,
          vercelGit: {
            commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
            commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
            repoSlug: process.env.VERCEL_GIT_REPO_SLUG || null,
          },
        },
        request: {
          host: headers.get('host'),
          xForwardedHost: headers.get('x-forwarded-host'),
          xForwardedProto: headers.get('x-forwarded-proto'),
          xVercelId: headers.get('x-vercel-id'),
          userAgent: trunc(headers.get('user-agent'), 140),
        },
        input: {
          pipelineId: pipelineId || null,
          symbol: symbol || null,
          metricUrl: metricUrl ? trunc(metricUrl, 160) : null,
          startPrice: startPrice || null,
          startPrice6: String(startPrice6),
          settlementTs,
          creatorWalletAddress: creatorWalletAddress ? shortAddr(creatorWalletAddress) : null,
          tagsCount: Array.isArray(tags) ? tags.length : 0,
          iconImageUrl: iconImageUrl ? trunc(iconImageUrl, 160) : null,
          aiSourceLocatorPresent: Boolean(aiSourceLocator),
        },
        env: {
          gaslessEnabled,
          appUrl: safeUrlInfo(appUrl),
          rpcUrl: safeUrlInfo(rpcUrl),
          rpcUrlSource,
          nativeTokenSymbol: process.env.NATIVE_TOKEN_SYMBOL || (process.env as any).NEXT_PUBLIC_NATIVE_TOKEN_SYMBOL || null,
        },
        addresses: {
          factory: {
            source: factoryAddressSource,
            value: shortAddr(process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS),
          },
          initFacet: {
            source: initFacetSource,
            value: shortAddr(process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET),
          },
          coreVault: {
            source: coreVaultSource,
            value: shortAddr(process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS),
          },
          facets: {
            OB_ADMIN_FACET: shortAddr(process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET),
            OB_PRICING_FACET: shortAddr(process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET),
            OB_ORDER_PLACEMENT_FACET: shortAddr(process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET),
            OB_TRADE_EXECUTION_FACET: shortAddr(process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET),
            OB_LIQUIDATION_FACET: shortAddr(process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET),
            OB_VIEW_FACET: shortAddr(process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET),
            OB_SETTLEMENT_FACET: shortAddr(process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET),
            ORDERBOOK_VAULT_FACET: shortAddr(
              process.env.ORDERBOOK_VALUT_FACET ||
              process.env.ORDERBOOK_VAULT_FACET ||
              (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET ||
              (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET
            ),
            MARKET_LIFECYCLE_FACET: shortAddr(process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET),
            META_TRADE_FACET: shortAddr(process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET),
          },
        },
        secrets: {
          adminPrivateKey: {
            present: Boolean(adminPk),
            length: adminPk ? String(adminPk).length : 0,
          },
          supabaseServiceKey: {
            present: Boolean(sbKey),
            length: sbKey ? String(sbKey).length : 0,
          },
        },
        integrations: {
          supabase: {
            url: safeUrlInfo(sbUrl),
            hasServiceKey: Boolean(sbKey),
          },
          pusher: {
            enabled: Boolean(pusher && pusherChannel),
            channel: pusherChannel || null,
            // Just presence checks; do not emit raw key material.
            hasAppId: Boolean(process.env.PUSHER_APP_ID),
            hasKey: Boolean(process.env.PUSHER_KEY),
            hasSecret: Boolean(process.env.PUSHER_SECRET),
            cluster: process.env.PUSHER_CLUSTER || null,
          },
        },
      };

      // Exactly one log line for easy copy/paste and diffing.
      console.log(JSON.stringify(snapshot));
    } catch {}

    logS('validate_input', 'start');
    if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    if (symbol.length > 100) {
      return NextResponse.json(
        { error: `Symbol too long (${symbol.length}/100). Choose a shorter symbol.` },
        { status: 400 }
      );
    }
    if (!metricUrl) return NextResponse.json({ error: 'Metric URL is required' }, { status: 400 });
    try {
      const startPriceBn = BigInt(startPrice6);
      if (startPriceBn <= 0n) {
        return NextResponse.json({ error: 'startPrice must be greater than zero (6 decimals)' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid startPrice' }, { status: 400 });
    }
    logS('validate_input', 'success');

    // Env configuration
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL;
    // Use ADMIN_PRIVATE_KEY for factory + diamond actions (existing behavior).
    const pk = process.env.ADMIN_PRIVATE_KEY;
    // Use ADMIN_PRIVATE_KEY for CoreVault role grants (explicit user requirement).
    const roleGranterPk = process.env.ADMIN_PRIVATE_KEY;
    const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
    const initFacet = process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET;
    const adminFacet = process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET;
    const pricingFacet = process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET;
    const placementFacet = process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET;
    const execFacet = process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET;
    const liqFacet = process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET;
    const viewFacet = process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET;
    const settleFacet = process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET;
    const vaultFacet =
      process.env.ORDERBOOK_VALUT_FACET ||
      process.env.ORDERBOOK_VAULT_FACET ||
      (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET ||
      (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET;
    const lifecycleFacet = process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET;
    const metaTradeFacet = process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET;
    const coreVaultAddress = process.env.CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS;

    if (!rpcUrl) return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 400 });
    if (!pk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured' }, { status: 400 });
    if (!roleGranterPk) return NextResponse.json({ error: 'ADMIN_PRIVATE_KEY not configured (role grants)' }, { status: 400 });
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) return NextResponse.json({ error: 'Factory address not configured' }, { status: 400 });
    if (!initFacet || !ethers.isAddress(initFacet)) return NextResponse.json({ error: 'Init facet address not configured' }, { status: 400 });
    if (!adminFacet || !pricingFacet || !placementFacet || !execFacet || !liqFacet || !viewFacet || !settleFacet || !vaultFacet || !lifecycleFacet || !metaTradeFacet) {
      return NextResponse.json({ error: 'One or more facet addresses are missing' }, { status: 400 });
    }
    if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
      return NextResponse.json({ error: 'CoreVault address not configured' }, { status: 400 });
    }

    // Provider and signer
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    // IMPORTANT: use a SINGLE nonce manager for this signer across all txs in this route.
    // Creating multiple nonce managers for the same key causes "nonce has already been used".
    const nonceMgr = await createNonceManager(wallet);
    const ownerAddress = await wallet.getAddress();
    try {
      const [net, bal, rpcChainIdHex] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(ownerAddress),
        provider.send('eth_chainId', []),
      ]);
      const rpcChainIdNum = rpcChainIdHex ? Number(rpcChainIdHex) : undefined;
      const balanceEth = ethers.formatEther(bal);
      logS('wallet_ready', 'success', { ownerAddress, chainId: Number(net.chainId), rpcChainIdHex, rpcChainIdNum, balanceWei: bal.toString(), balanceEth });
    } catch {
      logS('wallet_ready', 'success', { ownerAddress });
    }

    // Load ABIs (prefer compiled artifacts to prevent selector drift)
    const adminAbi = loadFacetAbi('OBAdminFacet', OBAdminFacetABI as any[]);
    const pricingAbi = loadFacetAbi('OBPricingFacet', OBPricingFacetABI as any[]);
    const placementAbi = loadFacetAbi('OBOrderPlacementFacet', OBOrderPlacementFacetABI as any[]);
    const execAbi = loadFacetAbi('OBTradeExecutionFacet', OBTradeExecutionFacetABI as any[]);
    const liqAbi = loadFacetAbi('OBLiquidationFacet', OBLiquidationFacetABI as any[]);
    const viewAbi = loadFacetAbi('OBViewFacet', OBViewFacetABI as any[]);
    const settleAbi = loadFacetAbi('OBSettlementFacet', OBSettlementFacetABI as any[]);
    const vaultAbi = loadFacetAbi('OrderBookVaultAdminFacet', (OrderBookVaultAdminFacetArtifact as any)?.abi || []);
    const lifecycleAbi = loadFacetAbi('MarketLifecycleFacet', (MarketLifecycleFacetArtifact as any)?.abi || (MarketLifecycleFacetABI as any[]));
    const metaFacetAbi = (MetaTradeFacetArtifact as any)?.abi || [];

    let cut = [
      { facetAddress: adminFacet, action: 0, functionSelectors: selectorsFromAbi(adminAbi) },
      { facetAddress: pricingFacet, action: 0, functionSelectors: selectorsFromAbi(pricingAbi) },
      { facetAddress: placementFacet, action: 0, functionSelectors: selectorsFromAbi(placementAbi) },
      { facetAddress: execFacet, action: 0, functionSelectors: selectorsFromAbi(execAbi) },
      { facetAddress: liqFacet, action: 0, functionSelectors: selectorsFromAbi(liqAbi) },
      { facetAddress: viewFacet, action: 0, functionSelectors: selectorsFromAbi(viewAbi) },
      { facetAddress: settleFacet, action: 0, functionSelectors: selectorsFromAbi(settleAbi) },
      { facetAddress: vaultFacet, action: 0, functionSelectors: selectorsFromAbi(vaultAbi) },
      { facetAddress: lifecycleFacet, action: 0, functionSelectors: selectorsFromAbi(lifecycleAbi) },
      { facetAddress: metaTradeFacet, action: 0, functionSelectors: selectorsFromAbi(metaFacetAbi) },
    ];
    // Force override cut/initFacet from /api/orderbook/cut to avoid drift
    try {
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const resp = await fetch(`${baseUrl}/api/orderbook/cut`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`cut API ${resp.status}`);
      const data = await resp.json();
      const apiCut = Array.isArray(data?.cut) ? data.cut : [];
      const apiInit = data?.initFacet || null;
      if (!apiCut.length || !apiInit || !ethers.isAddress(apiInit)) {
        throw new Error('cut API returned invalid cut/initFacet');
      }
      cut = apiCut.map((c: any) => ({
        facetAddress: c?.facetAddress,
        action: c?.action ?? 0,
        functionSelectors: Array.isArray(c?.functionSelectors) ? c.functionSelectors : [],
      }));
      // Keep initFacet in sync with the API response so downstream calls use the same init facet.
      // (initFacetAddr was a legacy variable name; initFacet is the canonical one.)
      // eslint-disable-next-line no-param-reassign
      (initFacet as any) = apiInit;
      // eslint-disable-next-line no-console
      console.log('[RELAYER_DEBUG_CUT_OVERRIDE]', { fromApi: true, cutLen: cut.length, initFacet });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[RELAYER_DEBUG_CUT_OVERRIDE] failed', e?.message || String(e));
    }
  try {
    const cutSummary = cut.map((c) => ({ facetAddress: c.facetAddress, selectorCount: (c.functionSelectors || []).length }));
    logS('facet_cut_built', 'success', { cutSummary, cut });
  } catch {}
    const emptyFacets = cut.filter(c => !c.functionSelectors?.length).map(c => c.facetAddress);
    if (emptyFacets.length) {
      return NextResponse.json({ error: 'Facet selectors could not be built', emptyFacets }, { status: 500 });
    }
    let cutArg = cut.map((c) => [c.facetAddress, 0, c.functionSelectors]);

    // If client provided cutArg and gasless is enabled, prefer client order to ensure identical hashing/signature
    if (String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true' && Array.isArray(clientCutArg)) {
      try {
        const normalized = (clientCutArg as any[]).map((e: any) => [e?.[0], Number(e?.[1] ?? 0), Array.isArray(e?.[2]) ? e[2] : []]);
        // Basic validation: addresses and selectors look sane
        const bad = normalized.find((e) => !e?.[0] || !ethers.isAddress(e[0]) || !Array.isArray(e[2]));
        if (!bad) {
          cutArg = normalized as any;
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] usingClientCutArg', true, { entries: cutArg.length });
        }
      } catch {}
    }

    // Resolve factory
    const factoryArtifact = await import('@/lib/abis/FuturesMarketFactory.json');
    const baseFactoryAbi = (factoryArtifact as any)?.default?.abi || (factoryArtifact as any)?.abi || (factoryArtifact as any)?.default || (factoryArtifact as any);
    const gaslessEnabled = String(process.env.GASLESS_CREATE_ENABLED || '').toLowerCase() === 'true';
    const metaAbi = [
      'function metaCreateFuturesMarketDiamond(string,string,uint256,uint256,string,string[],address,(address,uint8,bytes4[])[],address,address,uint256,uint256,bytes) returns (address,bytes32)',
      'function metaCreateNonce(address) view returns (uint256)',
    ];
    const factoryAbi = Array.isArray(baseFactoryAbi) ? [...baseFactoryAbi, ...(gaslessEnabled ? metaAbi : [])] : (gaslessEnabled ? metaAbi : baseFactoryAbi);
    const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
    const factoryIface = new ethers.Interface(factoryAbi);
    const feeRecipient = (body?.feeRecipient && ethers.isAddress(body.feeRecipient)) ? body.feeRecipient : (creatorWalletAddress || ownerAddress);

    // Preflight bytecode checks
    try {
      const [factoryCode, initCode, ...facetCodes] = await Promise.all([
        provider.getCode(factoryAddress),
        provider.getCode(initFacet),
        ...cutArg.map((c: any) => provider.getCode(c?.[0]))
      ]);
      const noFactory = !factoryCode || factoryCode === '0x' || factoryCode === '0x0';
      const noInit = !initCode || initCode === '0x' || initCode === '0x0';
      const badFacets = facetCodes.reduce((acc: number[], code: string, idx: number) => { if (!code || code === '0x' || code === '0x0') acc.push(idx); return acc; }, []);
      if (noFactory || noInit || badFacets.length) {
        return NextResponse.json({ error: 'One or more contract addresses have no bytecode', details: { noFactory, noInit, badFacets } }, { status: 400 });
      }
    } catch {}

    let tx: ethers.TransactionResponse;
    let receipt: ethers.TransactionReceipt | null;
    if (gaslessEnabled) {
      // Gasless via meta-create: require user signature
      const creator = creatorWalletAddress;
      if (!creator) {
        return NextResponse.json({ error: 'creatorWalletAddress required for gasless create' }, { status: 400 });
      }
      const signature = typeof body?.signature === 'string' ? String(body.signature) : null;
      const nonceStr = typeof body?.nonce !== 'undefined' ? String(body.nonce) : null;
      const deadlineStr = typeof body?.deadline !== 'undefined' ? String(body.deadline) : null;
      if (!signature || nonceStr == null || deadlineStr == null) {
        return NextResponse.json({ error: 'signature, nonce, and deadline required when GASLESS_CREATE_ENABLED' }, { status: 400 });
      }
      const nonce = BigInt(nonceStr);
      const deadline = BigInt(deadlineStr);

      // Build typed data and verify off-chain
      const net = await provider.getNetwork();
      // Domain: prefer on-chain helper to avoid env drift (matches client behavior)
      let domainName = String(
        process.env.EIP712_FACTORY_DOMAIN_NAME ||
          (process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_NAME ||
          'DexeteraFactory'
      );
      let domainVersion = String(
        process.env.EIP712_FACTORY_DOMAIN_VERSION ||
          (process.env as any).NEXT_PUBLIC_EIP712_FACTORY_DOMAIN_VERSION ||
          '1'
      );
      let domainChainId = Number(net.chainId);
      let domainVerifying = factoryAddress;
      // hash tags and cut via contract helpers to avoid drift
      let tagsHash: string;
      let cutHash: string;
      try {
        const helper = new ethers.Contract(
          factoryAddress,
          [
            'function computeTagsHash(string[] tags) view returns (bytes32)',
            'function computeCutHash((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut) view returns (bytes32)',
            'function eip712DomainInfo() view returns (string name,string version,uint256 chainId,address verifyingContract,bytes32 domainSeparator)',
          ],
          wallet
        );
        // best-effort: read domain from chain so signatures don't break when env drifts
        try {
          const info = await helper.eip712DomainInfo();
          if (info?.name) domainName = String(info.name);
          if (info?.version) domainVersion = String(info.version);
          if (info?.chainId) domainChainId = Number(info.chainId);
          if (info?.verifyingContract && ethers.isAddress(info.verifyingContract)) domainVerifying = info.verifyingContract;
        } catch {}

        tagsHash = await helper.computeTagsHash(tags);
        cutHash = await helper.computeCutHash(cutArg);
      } catch {
        tagsHash = ethers.keccak256(ethers.solidityPacked(new Array(tags.length).fill('string'), tags));
        const perCutHashes: string[] = [];
        for (const c of cutArg) {
          const selectorsHash = ethers.keccak256(ethers.solidityPacked(new Array((c?.[2] || []).length).fill('bytes4'), c?.[2] || []));
          const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint8','bytes32'], [c?.[0], c?.[1], selectorsHash]);
          perCutHashes.push(ethers.keccak256(enc));
        }
        cutHash = ethers.keccak256(ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes));
      }
      const domain = {
        name: domainName,
        version: domainVersion,
        chainId: domainChainId,
        verifyingContract: domainVerifying,
      } as const;
      const TYPEHASH_META_CREATE = ethers.id(
        'MetaCreate(string marketSymbol,string metricUrl,uint256 settlementDate,uint256 startPrice,string dataSource,bytes32 tagsHash,address diamondOwner,bytes32 cutHash,address initFacet,address creator,uint256 nonce,uint256 deadline)'
      );
      const types = {
        MetaCreate: [
          { name: 'marketSymbol', type: 'string' },
          { name: 'metricUrl', type: 'string' },
          { name: 'settlementDate', type: 'uint256' },
          { name: 'startPrice', type: 'uint256' },
          { name: 'dataSource', type: 'string' },
          { name: 'tagsHash', type: 'bytes32' },
          { name: 'diamondOwner', type: 'address' },
          { name: 'cutHash', type: 'bytes32' },
          { name: 'initFacet', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      } as const;
      const message = {
        marketSymbol: symbol,
        metricUrl,
        settlementDate: settlementTs,
        startPrice: startPrice6.toString(),
        dataSource,
        tagsHash,
        diamondOwner: ownerAddress,
        cutHash,
        initFacet,
        creator,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
      };
      // Debug log to verify exact domain/message inputs used for signature
      try {
        // eslint-disable-next-line no-console
        console.log('[RELAYER_DEBUG_INPUTS]', JSON.stringify({
          factoryAddress,
          domainName: domain.name,
          domainVersion: domain.version,
          domainChainId: domain.chainId,
          domainVerifyingContract: domain.verifyingContract,
          tagsHash,
          cutHash,
          message,
        }, null, 2));
      } catch {}
      // Use the exact message values for the contract call to avoid any drift
      const callSymbol = message.marketSymbol;
      const callMetricUrl = message.metricUrl;
      const callSettlementDate = Number(message.settlementDate);
      const callStartPrice = BigInt(message.startPrice);
      const callTags = tags;
      try {
        const debug = {
          factory: factoryAddress,
          chainId: Number(net.chainId),
          domain,
          message,
        startPriceRaw: startPrice,
        startPrice6: startPrice6.toString(),
          creator,
          diamondOwner: ownerAddress,
          cutArgPreview: Array.isArray(cutArg)
            ? cutArg.map((c: any) => ({
              facetAddress: c?.[0],
              action: c?.[1],
              selectors: Array.isArray(c?.[2]) ? c[2].length : 0,
            }))
            : null,
          initFacet,
          tags,
        };
        // eslint-disable-next-line no-console
        console.log('[META_DEBUG]', JSON.stringify(debug, null, 2));
      } catch {}
      try {
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] creator', creator);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] factory', factoryAddress);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] chainId', Number(net.chainId));
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] domain', domain);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] hashes', { tagsHash, cutHash });
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] message', message);
        // eslint-disable-next-line no-console
        console.log('[SIGNCHECK][server] signature', signature);
        // Extra digest + signature dump for debugging BadSignature
        try {
          const structHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['bytes32','bytes32','bytes32','uint256','uint256','bytes32','bytes32','bytes32','address','address','uint256','uint256'],
              [
                TYPEHASH_META_CREATE,
                ethers.keccak256(ethers.toUtf8Bytes(symbol)),
                ethers.keccak256(ethers.toUtf8Bytes(metricUrl)),
                settlementTs,
                BigInt(startPrice6),
                ethers.keccak256(ethers.toUtf8Bytes(dataSource)),
                tagsHash,
                cutHash,
                initFacet,
                creator,
                BigInt(message.nonce),
                BigInt(message.deadline),
              ]
            )
          );
          const digest = ethers.TypedDataEncoder.hash(domain as any, {
            MetaCreate: [
              { name: 'marketSymbol', type: 'string' },
              { name: 'metricUrl', type: 'string' },
              { name: 'settlementDate', type: 'uint256' },
              { name: 'startPrice', type: 'uint256' },
              { name: 'dataSource', type: 'string' },
              { name: 'tagsHash', type: 'bytes32' },
              { name: 'diamondOwner', type: 'address' },
              { name: 'cutHash', type: 'bytes32' },
              { name: 'initFacet', type: 'address' },
              { name: 'creator', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          } as const, message as any);
          const sigDump = {
            structHash,
            digest,
            signature,
          };
          // eslint-disable-next-line no-console
          console.log('[META_SIGNATURE_DEBUG]', JSON.stringify(sigDump, null, 2));
        } catch (eDebug: any) {
          // eslint-disable-next-line no-console
          console.warn('[META_SIGNATURE_DEBUG] failed', eDebug?.message || String(eDebug));
        }
      } catch {}
      try {
        const recovered = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
        try {
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] recovered', recovered);
        } catch {}
        if (!recovered || recovered.toLowerCase() !== creator.toLowerCase()) {
          return NextResponse.json({ error: 'bad_sig', recovered, expected: creator }, { status: 400 });
        }
      } catch (e: any) {
        return NextResponse.json({ error: 'verify_failed', details: e?.message || String(e) }, { status: 400 });
      }
      try {
        const onchainNonce = await factory.metaCreateNonce(creator);
        try {
          // eslint-disable-next-line no-console
          console.log('[SIGNCHECK][server] nonce', { provided: String(nonce), onchain: String(onchainNonce) });
        } catch {}
        if (String(onchainNonce) !== String(nonce)) {
          return NextResponse.json({ error: 'bad_nonce', expected: String(onchainNonce), got: String(nonce) }, { status: 400 });
        }
      } catch {}

      // Static call for revert reasons
      logS('factory_static_call_meta', 'start');
      try {
        await factory.getFunction('metaCreateFuturesMarketDiamond').staticCall(
          callSymbol,
          callMetricUrl,
          callSettlementDate,
          callStartPrice,
          dataSource,
          callTags,
          ownerAddress,
          cutArg,
          initFacet,
          creator,
          nonce,
          deadline,
          signature
        );
        logS('factory_static_call_meta', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed (no reason)';
        const decoded = decodeRevert(factoryIface, e);
        const rawData =
          (typeof e?.data === 'string' && e.data) ||
          (typeof e?.error?.data === 'string' && e.error.data) ||
          (typeof decoded?.data === 'string' && decoded.data) ||
          null;
        const selector = rawData && rawData.startsWith('0x') ? rawData.slice(0, 10) : null;
        const mapped = selector ? ERROR_SELECTORS[selector] : null;
        const customError = decoded?.name || mapped || null;
        const hint =
          customError === 'BadSignature'
            ? 'Bad signature: signer/payload mismatch. Ensure symbol casing matches server, signer is intended creator, and factory/domain match.'
            : 'Static call reverted. Check create permissions and facet/init addresses.';
        const msg = `${raw}`;
        logS('factory_static_call_meta', 'error', { error: msg, code: e?.code, hint, customError, customErrorArgs: decoded?.args, rawData });
        return NextResponse.json({ error: msg, hint, customError, customErrorArgs: decoded?.args || null, rawData: rawData || null }, { status: 400 });
      }

      // Send tx (relayer pays gas)
      logS('factory_send_tx_meta', 'start');
      const overrides = await nonceMgr.nextOverrides();
      logS('factory_send_tx_meta_prep', 'success', { nonce: (overrides as any)?.nonce, ...('maxFeePerGas' in overrides ? { maxFeePerGas: (overrides as any).maxFeePerGas?.toString?.() } : {}), ...('maxPriorityFeePerGas' in overrides ? { maxPriorityFeePerGas: (overrides as any).maxPriorityFeePerGas?.toString?.() } : {}), ...('gasPrice' in overrides ? { gasPrice: (overrides as any).gasPrice?.toString?.() } : {}) });
      tx = await factory.getFunction('metaCreateFuturesMarketDiamond')(
        callSymbol,
        callMetricUrl,
        callSettlementDate,
        callStartPrice,
        dataSource,
        callTags,
        ownerAddress,
        cutArg,
        initFacet,
        creator,
        nonce,
        deadline,
        signature,
        overrides as any
      );
      logS('factory_send_tx_meta_sent', 'success', { hash: tx.hash, nonce: (tx as any)?.nonce });
      logS('factory_confirm_meta', 'start');
      receipt = await tx.wait();
      {
        const payer = (tx as any)?.from || (await (wallet as any).getAddress?.());
        const spend = await computeTxSpend(provider, payer, receipt);
        logS('factory_confirm_meta_mined', 'success', {
        hash: receipt?.hash || tx.hash,
        block: receipt?.blockNumber,
          ...spend,
        });
      }
    } else {
      // Legacy direct create (relayer submits and pays gas)
      // Static call for revert reasons
      logS('factory_static_call', 'start');
      try {
        await factory.getFunction('createFuturesMarketDiamond').staticCall(
          symbol,
          metricUrl,
          settlementTs,
          startPrice6,
          dataSource,
          tags,
          ownerAddress,
          cutArg,
          initFacet,
          '0x'
        );
        logS('factory_static_call', 'success');
      } catch (e: any) {
        const raw = e?.shortMessage || e?.reason || e?.message || 'static call failed (no reason)';
        const hint = 'Possible causes: public creation disabled; creation fee required without sufficient CoreVault balance for the Deployer; invalid facet/addresses; or network mismatch.';
        const decoded = decodeRevert(factoryIface, e);
        const msg = `${raw}`;
        logS('factory_static_call', 'error', { error: msg, code: e?.code, hint, customError: decoded?.name, customErrorArgs: decoded?.args, rawData: decoded?.data });
        return NextResponse.json({ error: msg, hint, customError: decoded?.name || null, customErrorArgs: decoded?.args || null, rawData: decoded?.data || null }, { status: 400 });
      }
      // Send tx
      logS('factory_send_tx', 'start');
      const overrides = await nonceMgr.nextOverrides();
      logS('factory_send_tx_prep', 'success', { nonce: (overrides as any)?.nonce, ...('maxFeePerGas' in overrides ? { maxFeePerGas: (overrides as any).maxFeePerGas?.toString?.() } : {}), ...('maxPriorityFeePerGas' in overrides ? { maxPriorityFeePerGas: (overrides as any).maxPriorityFeePerGas?.toString?.() } : {}), ...('gasPrice' in overrides ? { gasPrice: (overrides as any).gasPrice?.toString?.() } : {}) });
      tx = await factory.getFunction('createFuturesMarketDiamond')(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        ownerAddress,
        cutArg,
        initFacet,
        '0x',
        overrides as any
      );
      logS('factory_send_tx_sent', 'success', { hash: tx.hash, nonce: (tx as any)?.nonce });
      // Confirm
      logS('factory_confirm', 'start');
      receipt = await tx.wait();
      {
        const payer = (tx as any)?.from || (await (wallet as any).getAddress?.());
        const spend = await computeTxSpend(provider, payer, receipt);
        logS('factory_confirm_mined', 'success', {
        hash: receipt?.hash || tx.hash,
        block: receipt?.blockNumber,
          ...spend,
        });
      }
    }

    // Confirm
    logS('factory_confirm', 'start');
    // Parse event
    const iface = new ethers.Interface(factoryAbi);
    let orderBook: string | null = null;
    let marketId: string | null = null;
    for (const log of (receipt as any)?.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'FuturesMarketCreated') {
          orderBook = parsed.args?.orderBook as string;
          marketId = parsed.args?.marketId as string;
          break;
        }
      } catch {}
    }
    if (!orderBook || !marketId) return NextResponse.json({ error: 'Could not parse created market' }, { status: 500 });

  // Ensure required placement selectors exist on the Diamond (defensive)
  try {
    logS('ensure_selectors', 'start', { orderBook });
    const LoupeABI = ['function facetAddress(bytes4) view returns (address)'];
    const CutABI = [
      'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)',
    ];
    const loupe = new ethers.Contract(orderBook, LoupeABI, wallet);
    const diamondCut = new ethers.Contract(orderBook, CutABI, wallet);
    const placementSigs = [
      'placeLimitOrder(uint256,uint256,bool)',
      'placeMarginLimitOrder(uint256,uint256,bool)',
      'placeMarketOrder(uint256,bool)',
      'placeMarginMarketOrder(uint256,bool)',
      'placeMarketOrderWithSlippage(uint256,bool,uint256)',
      'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)',
      'cancelOrder(uint256)',
    ];
    const requiredSelectors = placementSigs.map((sig) => ethers.id(sig).slice(0, 10));
    const missing: string[] = [];
    for (const sel of requiredSelectors) {
      try {
        const addr: string = await loupe.facetAddress(sel);
        if (!addr || addr.toLowerCase() === '0x0000000000000000000000000000000000000000') {
          missing.push(sel);
        }
      } catch {
        missing.push(sel);
      }
    }
    if (missing.length > 0) {
      logS('ensure_selectors_missing', 'start', { missingCount: missing.length });
      const cut = [{ facetAddress: placementFacet, action: 0, functionSelectors: missing }];
      const ov = await nonceMgr.nextOverrides();
      const txCut = await diamondCut.diamondCut(cut as any, ethers.ZeroAddress, '0x', ov as any);
      logS('ensure_selectors_diamondCut_sent', 'success', { tx: txCut.hash });
      const rc = await txCut.wait();
      {
        const payer = (txCut as any)?.from || (await (wallet as any).getAddress?.());
        const spend = await computeTxSpend(provider, payer, rc);
        logS('ensure_selectors_diamondCut_mined', 'success', {
          ...spend,
        });
      }
    } else {
      logS('ensure_selectors', 'success', { message: 'All placement selectors present' });
    }
  } catch (e: any) {
    logS('ensure_selectors', 'error', { error: e?.message || String(e) });
  }

    // Allow new OrderBook on GlobalSessionRegistry and attach session registry for gasless
    try {
      const registryAddress =
        process.env.SESSION_REGISTRY_ADDRESS ||
        (process.env as any).NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS ||
        '';
      if (!registryAddress || !ethers.isAddress(registryAddress)) {
        logS('attach_session_registry', 'error', { error: 'Missing SESSION_REGISTRY_ADDRESS' });
      } else {
        // Use ADMIN_PRIVATE_KEY for session-registry operations (explicit user requirement).
        const registryPk = process.env.ADMIN_PRIVATE_KEY || null;
        // Since we require ADMIN_PRIVATE_KEY here, always use the route wallet/nonceMgr.
        const regWallet = wallet;
        try { logS('attach_session_registry', 'start', { registrySigner: await (regWallet as any).getAddress?.() }); } catch {}

        // 1) Ensure this OrderBook is allowed in the registry
        try {
          const regAbi = [
            'function allowedOrderbook(address) view returns (bool)',
            'function setAllowedOrderbook(address,bool) external',
          ];
          const registry = new ethers.Contract(registryAddress, regAbi, regWallet);
          const allowed: boolean = await registry.allowedOrderbook(orderBook);
          if (!allowed) {
            // Some RPCs require balance sufficient for block gas limit during estimateGas.
            // Provide a conservative gasLimit to bypass over-aggressive balance checks.
            const ovAllow = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
            const txAllow = await registry.setAllowedOrderbook(orderBook, true, ovAllow as any);
            logS('attach_session_registry_sent', 'success', { tx: txAllow.hash, action: 'allow_orderbook' });
            const rAllow = await txAllow.wait();
            {
              const payer = (txAllow as any)?.from || (await (regWallet as any).getAddress?.());
              const spend = await computeTxSpend(provider, payer, rAllow);
              logS('attach_session_registry_mined', 'success', {
                action: 'allow_orderbook',
                ...spend,
              });
            }
          } else {
            logS('attach_session_registry', 'success', { message: 'OrderBook already allowed', action: 'allow_orderbook' });
          }
        } catch (e: any) {
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'allow_orderbook' });
        }

        // 2) Attach session registry on MetaTradeFacet (if not set)
        try {
          logS('attach_session_registry', 'start', { orderBook, registry: registryAddress });
          // Use ADMIN_PRIVATE_KEY for setSessionRegistry() (explicit user requirement).
          const meta = new ethers.Contract(orderBook, (MetaTradeFacetArtifact as any).abi, wallet);
          const current = await meta.sessionRegistry();
          if (!current || String(current).toLowerCase() !== String(registryAddress).toLowerCase()) {
            // Also provide explicit gasLimit here to avoid estimateGas balance gating on some RPCs.
            const ov = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
            let txSet: ethers.TransactionResponse;
            try {
              txSet = await meta.setSessionRegistry(registryAddress, ov);
            } catch (err: any) {
              const raw = String(err?.info?.error?.message || err?.shortMessage || err?.message || '').toLowerCase();
              const isNonceIssue =
                err?.code === 'NONCE_EXPIRED' ||
                raw.includes('nonce too low') ||
                raw.includes('nonce has already been used');
              if (isNonceIssue) {
                // Re-sync nonce and retry once
                const fresh = await nonceMgr.resync();
                logS('attach_session_registry', 'start', { action: 'retry_resynced_nonce', freshNonce: fresh });
                const ovRetry = { ...(await nonceMgr.nextOverrides()), gasLimit: 300000n };
                txSet = await meta.setSessionRegistry(registryAddress, ovRetry);
              } else {
                throw err;
              }
            }
            logS('attach_session_registry_sent', 'success', { tx: txSet.hash, action: 'set_session_registry' });
            const rSet = await txSet.wait();
            {
              const payer = (txSet as any)?.from || (await (wallet as any).getAddress?.());
              const spend = await computeTxSpend(provider, payer, rSet);
              logS('attach_session_registry_mined', 'success', {
                action: 'set_session_registry',
                ...spend,
              });
            }
          } else {
            logS('attach_session_registry', 'success', { message: 'Session registry already set', action: 'set_session_registry' });
          }
        } catch (e: any) {
          logS('attach_session_registry', 'error', { error: e?.message || String(e), action: 'set_session_registry' });
        }
      }
    } catch (e: any) {
      logS('attach_session_registry', 'error', { error: e?.message || String(e) });
    }

    // Grant roles on CoreVault (ADMIN_PRIVATE_KEY signer)
    logS('grant_roles', 'start', { coreVault: coreVaultAddress, orderBook });
    const coreVault = new ethers.Contract(coreVaultAddress, CoreVaultABI as any, wallet);
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
    try {
      const bal = await provider.getBalance(await wallet.getAddress());
      const feeData = await provider.getFeeData();
      // eslint-disable-next-line no-console
      console.log('[grant_roles][balance]', {
        wallet: await wallet.getAddress(),
        balanceWei: bal.toString(),
        balanceEth: ethers.formatEther(bal),
        maxFeePerGas: feeData.maxFeePerGas?.toString?.(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString?.(),
        gasPrice: feeData.gasPrice?.toString?.(),
      });
      const ov1 = await nonceMgr.nextOverrides();
      let tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook, ov1);
      logS('grant_ORDERBOOK_ROLE_sent', 'success', { tx: tx1.hash, nonce: (tx1 as any)?.nonce });
      let r1 = await tx1.wait();
      {
        const payer1 = (tx1 as any)?.from || (await (wallet as any).getAddress?.());
        const spend1 = await computeTxSpend(provider, payer1, r1);
        logS('grant_ORDERBOOK_ROLE_mined', 'success', {
          tx: r1?.hash || tx1.hash,
          blockNumber: r1?.blockNumber,
          ...spend1,
        });
      }
      const ov2 = await nonceMgr.nextOverrides();
      let tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook, ov2);
      logS('grant_SETTLEMENT_ROLE_sent', 'success', { tx: tx2.hash, nonce: (tx2 as any)?.nonce });
      let r2 = await tx2.wait();
      {
        const payer2 = (tx2 as any)?.from || (await (wallet as any).getAddress?.());
        const spend2 = await computeTxSpend(provider, payer2, r2);
        logS('grant_SETTLEMENT_ROLE_mined', 'success', {
          tx: r2?.hash || tx2.hash,
          blockNumber: r2?.blockNumber,
          ...spend2,
        });
      }
      logS('grant_roles', 'success');
    } catch (e: any) {
      try {
        const bal = await provider.getBalance(await wallet.getAddress());
        // eslint-disable-next-line no-console
        console.log('[grant_roles][error][balance]', {
          wallet: await wallet.getAddress(),
          balanceWei: bal.toString(),
          balanceEth: ethers.formatEther(bal),
        });
      } catch {}
      logS('grant_roles', 'error', { error: extractError(e) });
      return NextResponse.json({ error: 'Admin role grant failed', details: extractError(e) }, { status: 500 });
    }

    // Removed: Immediate trading parameter updates to shorten deployment time

    // Final verification: Inspect GASless readiness (session registry + allowlist + selectors + roles)
    // Non-blocking per user requirement: continue save, but record status in Supabase
    let inspectReport: any | null = null;
    try {
      logS('inspect_gasless', 'start', { orderBook });
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const resp = await fetch(`${baseUrl}/api/markets/inspect-gasless`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderBook, pipelineId }),
        cache: 'no-store',
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        logS('inspect_gasless', 'error', { status: resp.status, error: err?.error || 'inspect failed' });
      } else {
        const report = await resp.json();
        inspectReport = report;
        const pass = Number(report?.summary?.pass || 0);
        const total = Number(report?.summary?.total || 0);
        const failed = Array.isArray(report?.checks) ? report.checks.filter((c: any) => !c?.pass).map((c: any) => c?.name) : [];
        if (pass !== total) {
          logS('inspect_gasless', 'error', { pass, total, failed });
        } else {
          logS('inspect_gasless', 'success', { pass, total });
        }
      }
    } catch (e: any) {
      logS('inspect_gasless', 'error', { error: e?.message || String(e) });
    }

    // Save to Supabase
    let archivedWaybackUrl: string | null = null;
    let archivedWaybackTs: string | null = null;
    logS('save_market', 'start');
    try {
      const supabase = getSupabase();
      if (!supabase) {
        logS('save_market', 'error', { error: 'Supabase not configured' });
        if (process.env.NODE_ENV === 'production') {
          return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
        }
        // In dev, allow pipeline to continue (best-effort)
      }
      // Attempt to archive the metric URL via SavePageNow (server-side, authenticated if keys exist)
      if (supabase) {
        const network = await provider.getNetwork();
        try {
          const access = process.env.WAYBACK_API_ACCESS_KEY as string | undefined;
          const secret = process.env.WAYBACK_API_SECRET as string | undefined;
          const authHeader = access && secret ? `LOW ${access}:${secret}` : undefined;
          const archiveRes = await archiveWithTimeout(metricUrl, {
            captureOutlinks: false,
            captureScreenshot: true,
            skipIfRecentlyArchived: true,
            headers: {
              ...(authHeader ? { Authorization: authHeader } : {}),
              'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'http://localhost:3000'})`,
            },
          }, 4500);
          if (archiveRes?.success && archiveRes.waybackUrl) {
            archivedWaybackUrl = String(archiveRes.waybackUrl);
            archivedWaybackTs = archiveRes.timestamp ? String(archiveRes.timestamp) : null;
          } else {
            try { console.warn('[markets/create] Wayback archive failed', archiveRes?.error); } catch {}
          }
        } catch (e: any) {
          try { console.warn('[markets/create] Wayback archive error', e?.message || String(e)); } catch {}
        }
        const derivedName = `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`;
        const networkNameRaw = String(process.env.NEXT_PUBLIC_NETWORK_NAME || process.env.NETWORK_NAME || '');
        const safeName =
          (providedName ? providedName : derivedName).slice(0, 100);
        const safeDescription =
          (providedDescription ? providedDescription : `OrderBook market for ${symbol}`).slice(0, 280);
        const insertPayload: any = {
          market_identifier: symbol,
          symbol,
          name: safeName,
          description: safeDescription,
          category: Array.isArray(tags) && tags.length ? tags : ['CUSTOM'],
          decimals: 6,
          minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
          tick_size: Number(process.env.DEFAULT_TICK_SIZE || 0.01),
          requires_kyc: false,
          settlement_date: new Date(settlementTs * 1000).toISOString(),
          trading_end_date: null,
          data_request_window_seconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
          auto_settle: true,
          oracle_provider: null,
          initial_order: { metricUrl, startPrice: String(startPrice), dataSource, tags, waybackUrl: archivedWaybackUrl || null, waybackTimestamp: archivedWaybackTs || null },
          market_config: {
            ...(aiSourceLocator ? { ai_source_locator: aiSourceLocator } : {}),
            wayback_snapshot: archivedWaybackUrl ? { url: archivedWaybackUrl, timestamp: archivedWaybackTs, source_url: metricUrl } : null,
          },
          chain_id: Number(network.chainId),
          // DB column `network` is varchar(50); keep it safe for local chain names.
          network: networkNameRaw.length > 50 ? networkNameRaw.slice(0, 50) : networkNameRaw,
          creator_wallet_address: creatorWalletAddress,
          banner_image_url: bannerImageUrl || iconImageUrl || null,
          icon_image_url: iconImageUrl,
          supporting_photo_urls: [],
          market_address: orderBook,
          market_id_bytes32: marketId,
          deployment_transaction_hash: receipt?.hash || tx.hash,
          deployment_block_number: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
          deployment_gas_used: (receipt as any)?.gasUsed ? Number((receipt as any).gasUsed) : null,
          deployment_status: 'DEPLOYED',
          market_status: 'ACTIVE',
          deployed_at: new Date().toISOString(),
        };
        // Idempotent save: allow safe retries on timeouts / client refresh.
        let { data: savedRow, error: saveErr } = await supabase
          .from('markets')
          .upsert([insertPayload], { onConflict: 'market_identifier' })
          .select('id')
          .limit(1)
          .maybeSingle();
        if (saveErr) {
          const rawMsg = String(saveErr?.message || saveErr || '');
          const isSettlementPastConstraint =
            rawMsg.includes('settlement_date_future_for_active') ||
            (rawMsg.includes('check constraint') && rawMsg.toLowerCase().includes('settlement_date') && rawMsg.toLowerCase().includes('active'));

          // If settlement time elapsed before DB save, persist as SETTLEMENT_REQUESTED instead of failing.
          if (isSettlementPastConstraint) {
            const nowIso = new Date().toISOString();
            const fallbackPayload: any = {
              ...insertPayload,
              market_status: 'SETTLEMENT_REQUESTED',
              proposed_settlement_at: nowIso,
              settlement_window_expires_at: nowIso,
              proposed_settlement_by: 'SYSTEM_BACKFILL',
              market_config: {
                ...(insertPayload.market_config || {}),
                settlement_scheduler: {
                  stage: 'window_started_backfill',
                  started_at: nowIso,
                  expires_at: nowIso,
                  reason: 'save_after_settlement_date_constraint',
                },
              },
              updated_at: nowIso,
            };

            const fallback = await supabase
              .from('markets')
              .upsert([fallbackPayload], { onConflict: 'market_identifier' })
              .select('id')
              .limit(1)
              .maybeSingle();

            if (fallback.error) {
              throw new Error(`primary save failed: ${rawMsg}; fallback save failed: ${String(fallback.error?.message || fallback.error)}`);
            }

            savedRow = fallback.data;
            saveErr = null;
            logS('save_market', 'success', {
              fallback: 'settlement_date_past_at_save',
              marketStatus: 'SETTLEMENT_REQUESTED',
            });
          } else {
            throw saveErr;
          }
        }

        // Ensure a ticker row exists immediately to prevent frontend 404 spam.
        const markPriceScaled = (() => {
          const n = Number(startPrice);
          if (!Number.isFinite(n) || Number.isNaN(n) || n <= 0) return 0;
          return Math.round(n * 1_000_000);
        })();
        try {
          if (savedRow?.id) {
            await supabase.from('market_tickers').upsert(
              [{ market_id: savedRow.id, mark_price: markPriceScaled, last_update: new Date().toISOString(), is_stale: true }],
              { onConflict: 'market_id' }
            );
          }
        } catch {}
      }
      logS('save_market', 'success');
    } catch (e: any) {
      logS('save_market', 'error', { error: e?.message || String(e) });
      return NextResponse.json({
        error: 'Save market failed',
        details: e?.message || String(e),
        // Include on-chain identifiers so a user can re-run /api/markets/save manually
        // without redeploying if the DB write fails.
        symbol,
        orderBook,
        marketId,
        transactionHash: receipt?.hash || tx.hash,
      }, { status: 500 });
    }

    // Respond
    return NextResponse.json({
      ok: true,
      symbol,
      orderBook,
      marketId,
      transactionHash: receipt?.hash || tx.hash,
      feeRecipient,
      waybackUrl: archivedWaybackUrl,
    });
  } catch (e: any) {
    logStep('unhandled_error', 'error', { error: e?.message || String(e) });
    return NextResponse.json({ error: e?.message || 'Failed to create market' }, { status: 500 });
  }
}


