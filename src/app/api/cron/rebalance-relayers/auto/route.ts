import { NextResponse } from 'next/server'
import { rebalanceRelayers } from '@/lib/relayerBalanceMonitor'
import { recordRunFromReport } from '@/lib/relayerRebalanceState'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

/**
 * /api/cron/rebalance-relayers/auto
 *
 * Always-on, self-contained trigger for the relayer rebalancer. This is the
 * endpoint Vercel Cron hits on the schedule registered in `vercel.json`.
 * Vercel Cron sends a GET with `Authorization: Bearer ${CRON_SECRET}` when
 * the `CRON_SECRET` env var is configured on the project, which is how this
 * handler verifies the call.
 *
 * Behavior
 *   - Verifies the bearer token (CRON_SECRET / ADMIN_API_KEY).
 *   - Runs `rebalanceRelayers()` with `useFunderFallback: true` and default
 *     thresholds. The engine itself short-circuits when the pool is healthy,
 *     so the steady-state cost of the cron is just one set of balance reads.
 *   - Records a `PoolRunRecord` per affected pool into the in-memory state
 *     module so the GET endpoints elsewhere can show "last activity" status.
 *
 * Why a separate sub-route
 *   Vercel Cron's `path` field can't include query strings, so we can't
 *   distinguish "cron-triggered execute" from "manual snapshot read" on the
 *   same URL. A dedicated path keeps the existing `/api/cron/rebalance-
 *   relayers` GET as a pure read-only snapshot and gives Vercel Cron a clean
 *   target.
 *
 * NEVER LOG PRIVATE KEYS.
 */

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isAuthorized(request: Request): boolean {
  const auth = String(request.headers.get('authorization') || '').trim()
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const presented = auth.slice(7).trim()
  const cronSecret = String(process.env.CRON_SECRET || '').trim()
  const adminKey = String(process.env.ADMIN_API_KEY || '').trim()
  if (cronSecret && constantTimeEqual(presented, cronSecret)) return true
  if (adminKey && constantTimeEqual(presented, adminKey)) return true
  return false
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'unauthorized',
        hint: 'Vercel Cron must run with CRON_SECRET set as a project env var; manual curl needs Authorization: Bearer ${CRON_SECRET}',
      },
      { status: 401 },
    )
  }

  const userAgent = String(request.headers.get('user-agent') || '')
  const trigger = userAgent.toLowerCase().includes('vercel-cron') ? 'vercel-cron' : 'manual-post'

  try {
    const report = await rebalanceRelayers({
      dryRun: false,
      useFunderFallback: true,
      // Defaults: min 0.05, target 0.10, max 0.30, maxTransfersPerRun 10.
    })

    recordRunFromReport(report, trigger)

    const succeeded = report.executed.filter((e) => e.ok).length
    const failed = report.executed.filter((e) => !e.ok).length
    const totalSent = report.executed
      .filter((e) => e.ok)
      .reduce((acc, e) => acc + Number(e.amountHype || '0'), 0)

    // One-line log so the Vercel cron history is immediately readable.
    console.log(
      `[rebalance-relayers/auto] trigger=${trigger} planned=${report.plan.length} ok=${succeeded} fail=${failed} sent=${totalSent.toFixed(6)} HYPE`,
    )

    return NextResponse.json({
      ok: true,
      trigger,
      timestamp: new Date().toISOString(),
      thresholds: report.thresholds,
      pools: report.pools,
      totalsByPool: report.totalsByPool,
      planned: report.plan.length,
      executed: { ok: succeeded, failed, totalHypeSent: totalSent.toFixed(8) },
      transfers: report.executed.map((e) => ({
        pool: e.pool,
        from: e.fromAddress,
        to: e.toAddress,
        hype: e.amountHype,
        source: e.source,
        ok: e.ok,
        txHash: e.txHash,
        blockNumber: e.blockNumber,
        error: e.error,
      })),
      warnings: report.warnings,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rebalance-relayers/auto] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg || 'Internal error' }, { status: 500 })
  }
}
