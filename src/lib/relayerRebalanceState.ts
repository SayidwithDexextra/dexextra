import type { PoolName, RebalanceReport } from './relayerBalanceMonitor'

/**
 * In-memory observability for the relayer rebalancer.
 *
 * Both the cron route and the webhook route write here after every run, and
 * both `GET` endpoints read from here so the operator gets a "last activity"
 * summary at a glance — answering "is the self-contained loop actually
 * running?" without needing to dig through Vercel logs.
 *
 * Caveats
 *   - State is per-warm-instance. Cold starts wipe it. With Vercel cron
 *     hitting once per minute the warm container is kept alive, so the
 *     dashboard stays fresh in steady state. The first call after a cold
 *     start will show "lastRunAt: null"; the *next* cron tick fixes that.
 *   - For multi-region or hard durability guarantees swap this for a tiny
 *     Supabase row or Vercel KV — the public surface (recordRun /
 *     getLastRunByPool / getGlobalLastUpdated) is shaped for that pivot.
 *
 * NEVER LOG PRIVATE KEYS. We only ever store addresses + tx hashes here.
 */

export type RebalanceTrigger =
  | 'vercel-cron'
  | 'manual-post'
  | 'webhook-event'
  | 'unknown'

export interface PoolRunRecord {
  pool: PoolName
  timestampIso: string
  action: 'executed' | 'dry_run' | 'no_op'
  trigger: RebalanceTrigger
  planned: number
  executedOk: number
  executedFailed: number
  totalHypeSent: string
  errors?: string[]
}

const _byPool = new Map<PoolName, PoolRunRecord>()
let _lastUpdatedAtIso: string | null = null

/** Overwrite the per-pool record for `rec.pool`. */
export function recordRun(rec: PoolRunRecord): void {
  _byPool.set(rec.pool, rec)
  _lastUpdatedAtIso = new Date().toISOString()
}

export function getLastRunByPool(): Record<PoolName, PoolRunRecord | null> {
  return {
    small_trade: _byPool.get('small_trade') ?? null,
    big_trade: _byPool.get('big_trade') ?? null,
    deposit_withdrawal: _byPool.get('deposit_withdrawal') ?? null,
  }
}

export function getGlobalLastUpdated(): string | null {
  return _lastUpdatedAtIso
}

/**
 * Convenience helper: take a full RebalanceReport and write one
 * `PoolRunRecord` per pool the run targeted. Pools not touched by the run
 * are left alone.
 */
export function recordRunFromReport(report: RebalanceReport, trigger: RebalanceTrigger): void {
  const ts = new Date().toISOString()
  for (const pool of report.pools) {
    const planForPool = report.plan.filter((p) => p.pool === pool)
    const execForPool = report.executed.filter((e) => e.pool === pool)
    const okForPool = execForPool.filter((e) => e.ok)
    const failForPool = execForPool.filter((e) => !e.ok)
    const sentForPool = okForPool.reduce((s, e) => s + Number(e.amountHype || '0'), 0)

    let action: PoolRunRecord['action']
    if (execForPool.length > 0) {
      action = 'executed'
    } else if (planForPool.length > 0) {
      action = 'dry_run'
    } else {
      action = 'no_op'
    }

    const errors = failForPool
      .map((e) => e.error || '')
      .filter(Boolean)

    recordRun({
      pool,
      timestampIso: ts,
      action,
      trigger,
      planned: planForPool.length,
      executedOk: okForPool.length,
      executedFailed: failForPool.length,
      totalHypeSent: sentForPool.toFixed(8),
      errors: errors.length > 0 ? errors : undefined,
    })
  }
}
