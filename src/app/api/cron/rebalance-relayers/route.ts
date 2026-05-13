import { NextResponse } from 'next/server'
import {
  getBalanceSnapshot,
  rebalanceRelayers,
  type PoolName,
  type RebalanceThresholds,
} from '@/lib/relayerBalanceMonitor'
import {
  getGlobalLastUpdated,
  getLastRunByPool,
  recordRunFromReport,
} from '@/lib/relayerRebalanceState'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

/**
 * /api/cron/rebalance-relayers
 *
 * Monitors HYPE balances of every configured relayer (small-trade pool,
 * big-trade pool, and the singleton deposit/withdrawal bridge wallet) and
 * automatically redistributes HYPE between peers in the SAME pool to keep
 * every wallet above a configurable minimum.
 *
 *   GET   → read-only balance snapshot. Auth optional (rate-limited).
 *   POST  → executes peer-to-peer rebalancing (and optional funder fallback).
 *           Requires `Authorization: Bearer ${CRON_SECRET}` (or x-admin-key
 *           with ADMIN_API_KEY).
 *
 * Schedule this with QStash / Upstash cron / Vercel cron at e.g. every 5
 * minutes (cron expression: every-5-minutes / star-slash-5 star star star star):
 *
 *   POST /api/cron/rebalance-relayers
 *   Authorization: Bearer ${CRON_SECRET}
 *   { "useFunderFallback": true, "dryRun": false }
 *
 * Body (POST, all optional):
 *   {
 *     "dryRun": boolean,                // default false
 *     "useFunderFallback": boolean,     // default true (top up from funder
 *                                       //   if peer redistribution can't
 *                                       //   cover a pool)
 *     "pools": ["small_trade","big_trade","deposit_withdrawal"],
 *     "minBalanceHype": number,         // default 0.05  - recipients sit below this
 *     "targetBalanceHype": number,      // default 0.10  (capped at 1.0)
 *                                       //   - both recipients (topped up TO)
 *                                       //     and donors (drained DOWN to)
 *                                       //     converge here
 *     "maxBalanceHype": number,         // default 0.30  (capped at 5.0)
 *                                       //   - informational only ('RICH'
 *                                       //     status); donor selection uses
 *                                       //     `target + small surplus`
 *     "maxTransfersPerRun": number      // default 10    (capped at 50)
 *   }
 *
 * Hard ceilings (server-side, non-overridable):
 *   target ≤ 1.0 HYPE per relayer
 *   max    ≤ 5.0 HYPE per relayer
 *   maxTransfersPerRun ≤ 50
 * — these are enforced inside relayerBalanceMonitor.ts so a stolen secret
 *   cannot be used to drain the funder.
 *
 * NEVER LOG PRIVATE KEYS. The reports returned only contain checksum addrs.
 */

const VALID_POOLS: PoolName[] = ['small_trade', 'big_trade', 'deposit_withdrawal']

function isAuthorized(req: Request): boolean {
  const authHeader = String(req.headers.get('authorization') || '').trim()
  const adminHeader = String(req.headers.get('x-admin-key') || '').trim()

  const cronSecret = String(process.env.CRON_SECRET || '').trim()
  const adminKey = String(process.env.ADMIN_API_KEY || '').trim()

  // No secrets configured at all → fail closed.
  if (!cronSecret && !adminKey) return false

  const presented = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  // Constant-time-ish compare (length-aware) for both possible secrets.
  const match = (a: string, b: string) => {
    if (!a || !b || a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
  }

  if (presented && cronSecret && match(presented, cronSecret)) return true
  if (presented && adminKey && match(presented, adminKey)) return true
  if (adminHeader && adminKey && match(adminHeader, adminKey)) return true
  return false
}

function parsePools(input: unknown): PoolName[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: PoolName[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    if ((VALID_POOLS as string[]).includes(v) && !out.includes(v as PoolName)) {
      out.push(v as PoolName)
    }
  }
  return out.length > 0 ? out : undefined
}

function parseThresholds(body: Record<string, unknown>): Partial<RebalanceThresholds> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return {
    minHype: num(body.minBalanceHype),
    targetHype: num(body.targetBalanceHype),
    maxHype: num(body.maxBalanceHype),
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const poolsParam = url.searchParams.getAll('pool')
    const pools = parsePools(poolsParam)

    const thresholds: Partial<RebalanceThresholds> = {
      minHype: numFromQuery(url, 'min'),
      targetHype: numFromQuery(url, 'target'),
      maxHype: numFromQuery(url, 'max'),
    }

    const snapshot = await getBalanceSnapshot(thresholds, pools)

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      // The rebalancer runs autonomously on Vercel Cron. This block surfaces
      // the schedule + last activity so callers can sanity-check the loop is
      // healthy without leaving this response.
      selfContained: {
        mode: 'vercel-cron',
        cronEndpoint: '/api/cron/rebalance-relayers/auto',
        scheduleHint: 'Configured in vercel.json crons (default: every 1 minute)',
        lastRunAtAny: getGlobalLastUpdated(),
        lastRunByPool: getLastRunByPool(),
        notes: [
          'GET on this URL is read-only.',
          'POST or the /auto sub-route execute the rebalance.',
          'Last-run state is in-memory on the warm Vercel instance and is reset on cold start.',
        ],
      },
      thresholds: snapshot.thresholds,
      pools: snapshot.pools,
      totalsByPool: snapshot.totalsByPool,
      funder: snapshot.funderAddress
        ? { address: snapshot.funderAddress, balanceHype: snapshot.funderBalanceHype }
        : null,
      wallets: snapshot.wallets.map((w) => ({
        pool: w.pool,
        address: w.address,
        balanceHype: w.balanceHype,
        status: w.status,
      })),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rebalance-relayers GET] Error:', msg)
    return NextResponse.json({ ok: false, error: msg || 'Internal error' }, { status: 500 })
  }
}

function numFromQuery(url: URL, key: string): number | undefined {
  const v = url.searchParams.get(key)
  if (v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const dryRun = body.dryRun === true
  const useFunderFallback = body.useFunderFallback !== false // default true
  const pools = parsePools(body.pools)
  const thresholds = parseThresholds(body)
  const maxTransfersPerRun =
    typeof body.maxTransfersPerRun === 'number' && Number.isFinite(body.maxTransfersPerRun)
      ? body.maxTransfersPerRun
      : 10

  try {
    const report = await rebalanceRelayers({
      thresholds,
      useFunderFallback,
      dryRun,
      pools,
      maxTransfersPerRun,
    })

    const succeeded = report.executed.filter((e) => e.ok).length
    const failed = report.executed.filter((e) => !e.ok).length

    if (!dryRun) {
      const totalSent = report.executed
        .filter((e) => e.ok)
        .reduce((acc, e) => acc + Number(e.amountHype || '0'), 0)
      console.log(
        `[rebalance-relayers] planned=${report.plan.length} executed_ok=${succeeded} executed_fail=${failed} total_sent=${totalSent.toFixed(6)} HYPE`,
      )
    }

    // Surface manual runs in the same status feed the cron uses so the
    // dashboard view reflects whatever path triggered the rebalance.
    recordRunFromReport(report, 'manual-post')

    return NextResponse.json({
      ok: true,
      action: dryRun ? 'dry_run' : 'executed',
      timestamp: new Date().toISOString(),
      thresholds: report.thresholds,
      pools: report.pools,
      totalsByPool: report.totalsByPool,
      funder: report.funderAddress
        ? { address: report.funderAddress, balanceHype: report.funderBalanceHype }
        : null,
      planned: report.plan.length,
      executed: { ok: succeeded, failed },
      plan: report.plan,
      transfers: report.executed,
      walletsBefore: report.before.map((w) => ({
        pool: w.pool,
        address: w.address,
        balanceHype: w.balanceHype,
        status: w.status,
      })),
      walletsAfter: report.after?.map((w) => ({
        pool: w.pool,
        address: w.address,
        balanceHype: w.balanceHype,
        status: w.status,
      })),
      warnings: report.warnings,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rebalance-relayers POST] Error:', msg)
    return NextResponse.json({ ok: false, error: msg || 'Internal error' }, { status: 500 })
  }
}
