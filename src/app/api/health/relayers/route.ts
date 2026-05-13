import { NextRequest, NextResponse } from 'next/server'
import {
  getBalanceSnapshot,
  type PoolName,
  type RebalanceThresholds,
  type WalletStatus,
} from '@/lib/relayerBalanceMonitor'
import {
  getGlobalLastUpdated,
  getLastRunByPool,
} from '@/lib/relayerRebalanceState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/health/relayers
 *
 * Pingable health check for the relayer pools (small-trade / big-trade /
 * deposit-withdrawal) and the funder wallet. Reads balances live from the
 * RPC, classifies each wallet against the active rebalancer thresholds, and
 * rolls up to a single overall verdict so it slots cleanly into uptime
 * monitors (Pingdom, BetterStack, k8s probes, etc.).
 *
 * Verdicts (matches /api/health convention)
 *   healthy   = all wallets ≥ targetHype (rebalancer has nothing to do).
 *   degraded  = every wallet ≥ minHype, but at least one is below
 *               targetHype (rebalancer will top up on the next tick; gas
 *               txs are still safe).
 *   unhealthy = at least one wallet is below minHype (urgent — a relayer
 *               may fail its next gas tx). Returns HTTP 503 when ?strict=1.
 *
 * Query params
 *   ?pool=small_trade            Filter to one or more pools (repeatable).
 *   ?detailed=true               Include per-wallet rows in the response.
 *   ?format=text                 Plain-text one-screen summary, handy for
 *                                `curl ... | tee` and shell health pings.
 *   ?strict=1                    Return HTTP 503 when overall is unhealthy
 *                                (default: always 200 with status in body).
 *
 * Auth: none. Addresses and balances are already public on-chain, and
 * monitoring services need an unauthenticated endpoint to ping. Mutating
 * actions (rebalance, transfers) live behind their own bearer-auth routes.
 */

type Health = 'healthy' | 'degraded' | 'unhealthy'
const POOL_ORDER: PoolName[] = ['small_trade', 'big_trade', 'deposit_withdrawal']

function classifyWallet(w: WalletStatus, t: RebalanceThresholds): Health {
  const bal = parseFloat(w.balanceHype)
  if (!Number.isFinite(bal) || bal < t.minHype) return 'unhealthy'
  if (bal < t.targetHype) return 'degraded'
  return 'healthy'
}

function worst(...children: Health[]): Health {
  if (children.includes('unhealthy')) return 'unhealthy'
  if (children.includes('degraded')) return 'degraded'
  return 'healthy'
}

function parsePools(values: string[]): PoolName[] {
  if (values.length === 0) return POOL_ORDER
  const set = new Set<PoolName>()
  for (const v of values) {
    if ((POOL_ORDER as string[]).includes(v)) set.add(v as PoolName)
  }
  return set.size > 0 ? Array.from(set) : POOL_ORDER
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const detailed = url.searchParams.get('detailed') === 'true'
  const strict = ['1', 'true'].includes(String(url.searchParams.get('strict') || '').toLowerCase())
  const format = (url.searchParams.get('format') || 'json').toLowerCase()
  const pools = parsePools(url.searchParams.getAll('pool'))

  try {
    const snap = await getBalanceSnapshot(undefined, pools)

    const wallets = snap.wallets.map((w) => ({
      pool: w.pool,
      address: w.address,
      balanceHype: w.balanceHype,
      balanceStatus: w.status, // engine label: OK | LOW | RICH | EMPTY
      health: classifyWallet(w, snap.thresholds),
    }))

    const poolHealth: Record<PoolName, {
      status: Health
      wallets: number
      healthy: number
      degraded: number
      unhealthy: number
      totalHype: string
      minBalanceHype: string
      maxBalanceHype: string
    }> = {
      small_trade: emptyPoolReport(),
      big_trade: emptyPoolReport(),
      deposit_withdrawal: emptyPoolReport(),
    }

    for (const pool of pools) {
      const inPool = wallets.filter((x) => x.pool === pool)
      const h = inPool.filter((x) => x.health === 'healthy').length
      const d = inPool.filter((x) => x.health === 'degraded').length
      const u = inPool.filter((x) => x.health === 'unhealthy').length
      const balances = inPool.map((x) => Number(x.balanceHype) || 0)
      const total = balances.reduce((acc, n) => acc + n, 0)
      const min = balances.length > 0 ? Math.min(...balances) : 0
      const max = balances.length > 0 ? Math.max(...balances) : 0
      poolHealth[pool] = {
        status: u > 0 ? 'unhealthy' : d > 0 ? 'degraded' : 'healthy',
        wallets: inPool.length,
        healthy: h,
        degraded: d,
        unhealthy: u,
        totalHype: total.toFixed(8),
        minBalanceHype: min.toFixed(8),
        maxBalanceHype: max.toFixed(8),
      }
    }

    const overall = worst(...pools.map((p) => poolHealth[p].status))

    // Funder is informational only — peer redistribution can keep the system
    // healthy without it. We surface a warning when the funder is too thin
    // to be useful as a fallback (< minHype + small gas reserve).
    const funderBal = snap.funderBalanceHype ? Number(snap.funderBalanceHype) : null
    const funderUseful =
      snap.funderAddress != null &&
      funderBal != null &&
      funderBal >= snap.thresholds.minHype + 0.01
    const funder = {
      address: snap.funderAddress ?? null,
      balanceHype: snap.funderBalanceHype ?? null,
      usableForFallback: funderUseful,
      warning:
        snap.funderAddress && !funderUseful
          ? `Funder balance (${snap.funderBalanceHype ?? '?'} HYPE) is below the minimum top-up threshold; peer-redistribution still works but funder fallback is effectively disabled.`
          : null,
    }

    const lastRunByPool = getLastRunByPool()
    const responseTimeMs = Date.now() - startedAt

    if (format === 'text') {
      const lines: string[] = []
      lines.push(`relayer health: ${overall.toUpperCase()}`)
      lines.push(`thresholds: min=${snap.thresholds.minHype} target=${snap.thresholds.targetHype} max=${snap.thresholds.maxHype} HYPE`)
      lines.push('')
      for (const pool of pools) {
        const p = poolHealth[pool]
        const tag = p.status.toUpperCase().padEnd(9)
        lines.push(
          `${pool.padEnd(20)} ${tag} wallets=${p.wallets}  ok=${p.healthy}  low=${p.degraded}  critical=${p.unhealthy}  total=${p.totalHype} HYPE  min=${p.minBalanceHype}`,
        )
      }
      lines.push('')
      if (funder.address) {
        lines.push(`funder ${funder.address}  ${funder.balanceHype ?? '?'} HYPE  ${funder.usableForFallback ? 'usable' : 'unusable'}`)
        if (funder.warning) lines.push(`  warning: ${funder.warning}`)
      } else {
        lines.push('funder: (not configured)')
      }
      if (lastRunByPool) {
        const last = getGlobalLastUpdated()
        lines.push('')
        lines.push(`last rebalance run (any pool): ${last ?? 'never (since cold start)'}`)
        for (const pool of pools) {
          const r = lastRunByPool[pool]
          if (!r) continue
          lines.push(
            `  ${pool.padEnd(20)} ${r.timestampIso}  ${r.action}  trigger=${r.trigger}  planned=${r.planned}  ok=${r.executedOk}  fail=${r.executedFailed}  sent=${r.totalHypeSent} HYPE`,
          )
        }
      }
      lines.push('')
      lines.push(`response_time_ms=${responseTimeMs}`)
      return new NextResponse(lines.join('\n') + '\n', {
        status: strict && overall === 'unhealthy' ? 503 : 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    const body: Record<string, unknown> = {
      ok: true,
      status: overall,
      timestamp: new Date().toISOString(),
      responseTimeMs,
      thresholds: snap.thresholds,
      summary: {
        totalWallets: wallets.length,
        healthy: wallets.filter((w) => w.health === 'healthy').length,
        degraded: wallets.filter((w) => w.health === 'degraded').length,
        unhealthy: wallets.filter((w) => w.health === 'unhealthy').length,
      },
      pools: pools.reduce<Record<string, unknown>>((acc, p) => {
        acc[p] = poolHealth[p]
        return acc
      }, {}),
      funder,
      rebalancer: {
        lastRunAtAny: getGlobalLastUpdated(),
        lastRunByPool,
      },
    }

    if (detailed) body.wallets = wallets

    return NextResponse.json(body, {
      status: strict && overall === 'unhealthy' ? 503 : 200,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[health/relayers] error:', msg)
    return NextResponse.json(
      {
        ok: false,
        status: 'unhealthy',
        error: msg || 'health check failed',
        timestamp: new Date().toISOString(),
        responseTimeMs: Date.now() - startedAt,
      },
      { status: 503 },
    )
  }
}

function emptyPoolReport() {
  return {
    status: 'healthy' as Health,
    wallets: 0,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    totalHype: '0.00000000',
    minBalanceHype: '0.00000000',
    maxBalanceHype: '0.00000000',
  }
}
