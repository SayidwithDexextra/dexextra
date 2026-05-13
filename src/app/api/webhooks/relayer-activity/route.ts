import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { ethers } from 'ethers'
import {
  getBalanceSnapshot,
  getPoolForAddress,
  getRelayerAddressPoolMap,
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
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/webhooks/relayer-activity
 *
 * Event-driven entry point that replaces the QStash/cron trigger for relayer
 * rebalancing. Designed to be called by Alchemy Notify ADDRESS_ACTIVITY (or
 * MINED_TRANSACTION / GRAPHQL custom) webhooks subscribed to every relayer
 * EOA. Whenever any relayer sends a tx (= burns HYPE gas), Alchemy POSTs us
 * the activity, this route detects which pool was affected, applies a smart
 * debounce + idempotency guard, and only then runs the rebalance engine.
 *
 *
 * Smart triggering rules
 * ----------------------
 *   (a) Cooldown per-pool: at most one rebalance attempt per
 *       REBALANCE_COOLDOWN_MS (default 60s).
 *   (b) Bypass cooldown if any wallet in the affected pool is below `min`
 *       on a fresh on-chain read (urgent path — the relayer just spent gas
 *       and is now empty).
 *   (c) Skip entirely if every peer in the affected pool is at or above
 *       `target` (no work, no transfers, fast path for 99% of webhooks).
 *   (d) In-flight set prevents two concurrent webhook deliveries from
 *       planning duplicate transfers from the same donor.
 *
 *
 * Auth (any one of):
 *   - Alchemy:   header `x-alchemy-signature` matching HMAC-SHA256 of body
 *                with key ALCHEMY_WEBHOOK_SIGNING_KEY (or
 *                RELAYER_WEBHOOK_SIGNING_KEY for a dedicated key).
 *   - Operator:  header `Authorization: Bearer ${CRON_SECRET}` for manual
 *                triggering (e.g. curl).
 *
 *
 * Accepted payloads
 * -----------------
 *   1. Alchemy ADDRESS_ACTIVITY (preferred):
 *        { type: "ADDRESS_ACTIVITY", event: { activity: [{ fromAddress, toAddress, ... }] } }
 *      We pull `fromAddress` of each activity (the relayer that spent gas).
 *
 *   2. Alchemy MINED_TRANSACTION:
 *        { type: "MINED_TRANSACTION", event: { transaction: { from, ... } } }
 *
 *   3. Alchemy GRAPHQL custom:
 *        { type: "GRAPHQL", event: { data: { block: { logs: [{ transaction: { from: { address } } }] } } } }
 *
 *   4. Generic / non-Alchemy:
 *        { addresses: ["0x..."], force?: boolean }
 *      Lets a non-Alchemy block stream / custom listener / curl drive the
 *      same logic. Auth via Bearer ${CRON_SECRET} required for this shape.
 *
 *
 * Recommended Alchemy webhook
 * ---------------------------
 *   POST https://dashboard.alchemy.com/api/create-webhook
 *   {
 *     "network": "<your-net>",
 *     "webhook_type": "ADDRESS_ACTIVITY",
 *     "webhook_url": "https://<app>/api/webhooks/relayer-activity",
 *     "addresses": [<all 17 relayer EOAs from this app's env>]
 *   }
 *
 * Hit GET /api/webhooks/relayer-activity to see the addresses you should
 * register, the last-rebalance-at per pool, and current cooldown state.
 *
 *
 * NEVER LOG PRIVATE KEYS. We only ever touch checksum addresses here.
 */

const REBALANCE_COOLDOWN_MS = Math.max(
  10_000,
  parseInt(process.env.RELAYER_REBALANCE_COOLDOWN_MS || '60000', 10) || 60_000,
)

// ── Module-level state (warm-instance only) ───────────────────────────────────
// Vercel Node functions persist module state across invocations of the same
// warm instance. Cold starts reset these — that's fine: the first webhook
// after a cold start runs a real check, and the engine itself is idempotent
// against the live on-chain state, so duplicate triggers can only waste reads
// (never broadcast duplicate transfers because a planned transfer requires
// donor balance > target, which decreases atomically each time we send).
//
// For multi-region deploys you'd want to back this with Supabase or Vercel
// KV. The interface below is shaped so swapping in a persistent backend is a
// localized change.
const lastRebalanceAt = new Map<PoolName, number>()
const inFlight = new Set<PoolName>()

// In-process dedupe for {tx, pool} so retried Alchemy deliveries don't kick
// off duplicate work for the same activity.
const recentTxKeys = new Map<string, number>()
const RECENT_TX_TTL_MS = 5 * 60_000

function pruneRecentTxKeys(now: number) {
  if (recentTxKeys.size < 1024) return
  for (const [k, ts] of recentTxKeys.entries()) {
    if (now - ts > RECENT_TX_TTL_MS) recentTxKeys.delete(k)
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function constantTimeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function verifyAlchemySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const signingKey =
    process.env.RELAYER_WEBHOOK_SIGNING_KEY ||
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ||
    ''
  if (!signingKey) return false
  try {
    const digest = createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex')
    return constantTimeEqualHex(signature, digest)
  } catch {
    return false
  }
}

function verifyBearer(req: NextRequest): boolean {
  const auth = String(req.headers.get('authorization') || '').trim()
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const presented = auth.slice(7).trim()
  const cronSecret = String(process.env.CRON_SECRET || '').trim()
  const adminKey = String(process.env.ADMIN_API_KEY || '').trim()
  return (
    (!!cronSecret && constantTimeEqualHex(presented, cronSecret)) ||
    (!!adminKey && constantTimeEqualHex(presented, adminKey))
  )
}

// ── Payload extraction ───────────────────────────────────────────────────────
interface ExtractedActivity {
  /** Relayer address that signed the tx (i.e. spent gas). */
  relayerAddress: string
  /** Tx hash if known (used for dedupe across redelivery). */
  txHash?: string
}

function extractActivities(body: unknown): ExtractedActivity[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const out: ExtractedActivity[] = []

  const pushIfAddress = (addr: unknown, txHash?: string) => {
    if (typeof addr !== 'string') return
    let checksum: string
    try {
      checksum = ethers.getAddress(addr)
    } catch {
      return
    }
    out.push({ relayerAddress: checksum, txHash: txHash ? String(txHash) : undefined })
  }

  // Generic shape: { addresses: ["0x..."] }
  if (Array.isArray((b as { addresses?: unknown[] }).addresses)) {
    for (const a of (b as { addresses: unknown[] }).addresses) pushIfAddress(a)
  }

  // Alchemy: { type, event: { ... } }
  const type = String(b.type || '').toUpperCase()
  const event = (b.event as Record<string, unknown>) || {}

  if (type === 'ADDRESS_ACTIVITY') {
    const acts = (event.activity as Array<Record<string, unknown>>) || []
    for (const act of acts) {
      const txHash = typeof act.hash === 'string' ? act.hash : undefined
      pushIfAddress(act.fromAddress, txHash)
    }
  } else if (type === 'MINED_TRANSACTION') {
    const tx = (event.transaction as Record<string, unknown>) || {}
    const txHash = typeof tx.hash === 'string' ? tx.hash : undefined
    pushIfAddress(tx.from, txHash)
  } else if (type === 'GRAPHQL') {
    const data = (event.data as Record<string, unknown>) || {}
    const block = (data.block as Record<string, unknown>) || {}
    const logs = (block.logs as Array<Record<string, unknown>>) || []
    for (const l of logs) {
      const tx = (l.transaction as Record<string, unknown>) || {}
      const fromObj = tx.from as Record<string, unknown> | undefined
      const fromAddr = typeof fromObj?.address === 'string' ? fromObj.address : (typeof tx.from === 'string' ? tx.from : undefined)
      const txHash = typeof tx.hash === 'string' ? tx.hash : undefined
      pushIfAddress(fromAddr, txHash)
    }
  }

  // Dedupe by (txHash + address) to be defensive against weird payloads.
  const seen = new Set<string>()
  return out.filter((a) => {
    const key = `${(a.txHash || '').toLowerCase()}:${a.relayerAddress.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Decision: should we trigger a rebalance for `pool`? ──────────────────────
async function decideAndRun(
  affectedPools: Set<PoolName>,
  forced: boolean,
): Promise<{
  trigger: 'forced' | 'urgent' | 'idle' | 'cooldown' | 'no_op' | 'in_flight'
  pool: PoolName | null
  reason: string
  result?: Awaited<ReturnType<typeof rebalanceRelayers>>
}[]> {
  const results: {
    trigger: 'forced' | 'urgent' | 'idle' | 'cooldown' | 'no_op' | 'in_flight'
    pool: PoolName | null
    reason: string
    result?: Awaited<ReturnType<typeof rebalanceRelayers>>
  }[] = []

  for (const pool of affectedPools) {
    const now = Date.now()
    const last = lastRebalanceAt.get(pool) || 0
    const cooldownLeft = REBALANCE_COOLDOWN_MS - (now - last)

    if (inFlight.has(pool)) {
      results.push({ trigger: 'in_flight', pool, reason: 'concurrent run already in progress for this pool' })
      continue
    }

    // Read a cheap snapshot of just this pool to decide.
    const snap = await getBalanceSnapshot(undefined, [pool])
    const stats = snap.totalsByPool[pool]
    const hasUrgentLow = stats.lowCount > 0 || stats.emptyCount > 0
    const targetWei = ethers.parseEther(snap.thresholds.targetHype.toString())
    const minWei = ethers.parseEther(snap.thresholds.minHype.toString())
    const anyBelowTarget = snap.wallets
      .filter((w) => w.pool === pool)
      .some((w) => w.balanceWei < targetWei)
    const anyBelowMin = snap.wallets
      .filter((w) => w.pool === pool)
      .some((w) => w.balanceWei < minWei)

    let trigger: 'forced' | 'urgent' | 'idle' | 'cooldown' | 'no_op' = 'no_op'
    let reason = ''

    if (forced) {
      trigger = 'forced'
      reason = 'forced=true on the request'
    } else if (anyBelowMin) {
      // Urgent: someone is genuinely below min — bypass cooldown.
      trigger = 'urgent'
      reason = `at least one wallet in pool=${pool} is below min`
    } else if (cooldownLeft > 0) {
      trigger = 'cooldown'
      reason = `cooldown active (${Math.ceil(cooldownLeft / 1000)}s remaining)`
    } else if (hasUrgentLow || anyBelowTarget) {
      trigger = 'idle'
      reason = `pool has wallets below target after cooldown elapsed`
    } else {
      trigger = 'no_op'
      reason = `pool=${pool} healthy: every wallet is at or above target`
    }

    if (trigger === 'cooldown' || trigger === 'no_op') {
      results.push({ trigger, pool, reason })
      continue
    }

    inFlight.add(pool)
    try {
      const result = await rebalanceRelayers({
        dryRun: false,
        useFunderFallback: true,
        pools: [pool],
        // Defaults handle thresholds / maxTransfersPerRun.
      })
      lastRebalanceAt.set(pool, Date.now())
      const sent = result.executed.filter((e) => e.ok).length
      const failed = result.executed.filter((e) => !e.ok).length
      console.log(
        `[relayer-activity] pool=${pool} trigger=${trigger} planned=${result.plan.length} sent_ok=${sent} failed=${failed}`,
      )
      recordRunFromReport(result, 'webhook-event')
      results.push({ trigger, pool, reason, result })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[relayer-activity] rebalance error for pool=${pool}:`, msg)
      results.push({ trigger, pool, reason: `${reason}; rebalance threw: ${msg}` })
    } finally {
      inFlight.delete(pool)
    }
  }

  return results
}

// ── Handlers ─────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ ok: false, error: 'failed to read body' }, { status: 400 })
  }

  const sig = request.headers.get('x-alchemy-signature')
  const alchemyOk = verifyAlchemySignature(rawBody, sig)
  const bearerOk = verifyBearer(request)

  // In production we require auth (either Alchemy HMAC or Bearer). In dev we
  // soften this so local curl tests work, matching the existing /webhooks/
  // alchemy convention.
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && !alchemyOk && !bearerOk) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const forced = !!(body && typeof body === 'object' && (body as { force?: unknown }).force === true)

  // Generic { addresses: [...] } body without a verifiable signature must use
  // the Bearer secret. (Alchemy webhooks don't use this shape.)
  const isGenericShape = !!(body && typeof body === 'object' && Array.isArray((body as { addresses?: unknown }).addresses))
  if (isGenericShape && isProd && !bearerOk) {
    return NextResponse.json({ ok: false, error: 'generic addresses payload requires Bearer auth' }, { status: 401 })
  }

  const activities = extractActivities(body)

  // Map activities → pools; ignore addresses that don't belong to any pool.
  const affectedPools = new Set<PoolName>()
  const ignored: string[] = []
  const deduped: Array<{ address: string; txHash?: string }> = []
  const matched: Array<{ address: string; pool: PoolName; txHash?: string }> = []
  const now = Date.now()
  pruneRecentTxKeys(now)

  for (const a of activities) {
    const pool = getPoolForAddress(a.relayerAddress)
    if (!pool) {
      ignored.push(a.relayerAddress)
      continue
    }
    // Tx-level dedupe across Alchemy redeliveries.
    const dedupeKey = `${(a.txHash || '').toLowerCase()}:${a.relayerAddress.toLowerCase()}`
    if (a.txHash) {
      if (recentTxKeys.has(dedupeKey)) {
        deduped.push({ address: a.relayerAddress, txHash: a.txHash })
        continue
      }
      recentTxKeys.set(dedupeKey, now)
    }
    matched.push({ address: a.relayerAddress, pool, txHash: a.txHash })
    affectedPools.add(pool)
  }

  // Nothing to do: either the activity is for an unrelated address (common
  // misconfiguration / pre-rotation address) or this is a redelivery we've
  // already processed.
  if (affectedPools.size === 0) {
    return NextResponse.json({
      ok: true,
      action: deduped.length > 0 ? 'duplicate_delivery' : 'no_matching_relayer',
      activities: activities.length,
      matched: 0,
      deduped: deduped.length,
      ignored,
    })
  }

  const decisions = await decideAndRun(affectedPools, forced)

  return NextResponse.json({
    ok: true,
    receivedActivities: activities.length,
    matched: matched.length,
    ignored: ignored.length,
    affectedPools: [...affectedPools],
    decisions: decisions.map((d) => ({
      pool: d.pool,
      trigger: d.trigger,
      reason: d.reason,
      planned: d.result?.plan.length ?? 0,
      sentOk: d.result?.executed.filter((e) => e.ok).length ?? 0,
      sentFailed: d.result?.executed.filter((e) => !e.ok).length ?? 0,
      transfers: d.result?.executed.map((e) => ({
        from: e.fromAddress,
        to: e.toAddress,
        hype: e.amountHype,
        ok: e.ok,
        txHash: e.txHash,
        error: e.error,
      })),
      warnings: d.result?.warnings,
    })),
  })
}

/**
 * Health / status endpoint — also tells the operator which addresses to
 * subscribe in their Alchemy webhook config.
 */
export async function GET() {
  const { addresses, map } = getRelayerAddressPoolMap()
  const cooldownByPool: Record<string, { lastRebalanceAt: string | null; cooldownLeftMs: number; inFlight: boolean }> = {}
  const now = Date.now()
  for (const pool of ['small_trade', 'big_trade', 'deposit_withdrawal'] as PoolName[]) {
    const last = lastRebalanceAt.get(pool) || 0
    cooldownByPool[pool] = {
      lastRebalanceAt: last ? new Date(last).toISOString() : null,
      cooldownLeftMs: Math.max(0, REBALANCE_COOLDOWN_MS - (now - last)),
      inFlight: inFlight.has(pool),
    }
  }
  const eventDrivenConfigured = !!(
    process.env.RELAYER_WEBHOOK_SIGNING_KEY || process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
  )
  const eventDrivenEverFired =
    Object.values(getLastRunByPool()).some((r) => r?.trigger === 'webhook-event')

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    // Always-on, no-commands-required trigger. This block exists so a single
    // GET on this URL answers "is the loop healthy?" without leaving the
    // response.
    selfContained: {
      mode: 'vercel-cron',
      cronEndpoint: '/api/cron/rebalance-relayers/auto',
      scheduleHint: 'Configured in vercel.json crons (default: every 1 minute)',
      lastRunAtAny: getGlobalLastUpdated(),
      lastRunByPool: getLastRunByPool(),
      eventDriven: {
        signingKeyConfigured: eventDrivenConfigured,
        receivedSinceWarmStart: eventDrivenEverFired,
        note:
          'This webhook endpoint is the optional fast path. The always-on safety net is Vercel Cron — see /api/cron/rebalance-relayers/auto and vercel.json.',
      },
    },
    cooldownMs: REBALANCE_COOLDOWN_MS,
    relayerCount: addresses.length,
    addressesByPool: groupAddressesByPool(map),
    cooldownByPool,
    signing: {
      alchemyKeyConfigured: eventDrivenConfigured,
      bearerKeyConfigured: !!(process.env.CRON_SECRET || process.env.ADMIN_API_KEY),
    },
  })
}

function groupAddressesByPool(map: Map<string, PoolName>): Record<PoolName, string[]> {
  const out: Record<PoolName, string[]> = {
    small_trade: [],
    big_trade: [],
    deposit_withdrawal: [],
  }
  for (const [lcAddr, pool] of map.entries()) {
    out[pool].push(ethers.getAddress(lcAddr))
  }
  return out
}

// Make the explicit re-export of types tree-shakeable if unused.
export type { PoolName, RebalanceThresholds }
