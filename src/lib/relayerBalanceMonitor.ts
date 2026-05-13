import { ethers } from 'ethers'
import {
  allocateRelayerNonce,
  bumpLocalNextNonce,
  markRelayerTxBroadcasted,
} from './relayerNonceAllocator'

/**
 * Relayer balance monitor + rebalancer.
 *
 * Responsibilities (no Next.js / no HTTP code lives here on purpose):
 *
 *   1. Resolve every configured relayer pool from env (small-trade, big-trade,
 *      and the singleton deposit/withdrawal bridge wallet).
 *   2. Read on-chain HYPE balances for every wallet.
 *   3. Plan a set of `from -> to` HYPE transfers that:
 *        a. Move funds from "rich" peers (> max) to "low" peers (< min) inside
 *           the SAME pool, until every wallet is at least at `min`.
 *        b. (Optional) If peer redistribution can't fully cover a pool, top up
 *           the remaining shortfall from a dedicated funder wallet
 *           (FUNDER_PRIVATE_KEY, falling back to ADMIN_PRIVATE_KEY).
 *   4. Optionally execute that plan, returning a structured report.
 *
 * Pools never share funds with each other:
 *   - Big-block relayers spend WAY more gas per tx than the small pool, so we
 *     don't want a single low small-relayer to siphon the big-pool buffer.
 *   - The deposit/withdrawal bridge wallet (RELAYER_PRIVATE_KEY) is single-
 *     purpose and security-sensitive; it must NEVER receive funds from a
 *     trade relayer or vice-versa.
 *
 * NEVER LOG PRIVATE KEYS. Plans and reports only carry checksum addresses.
 */

export type PoolName = 'small_trade' | 'big_trade' | 'deposit_withdrawal'

export interface RebalanceThresholds {
  /** Below this, the wallet is a recipient. HYPE (decimal). */
  minHype: number
  /** Recipients are funded up to this. Donors stop donating at this. HYPE. */
  targetHype: number
  /** Above this, the wallet is eligible to donate. HYPE. */
  maxHype: number
}

export interface RebalanceOptions {
  /**
   * Threshold inputs. Any missing field falls back to a safe default and is
   * clamped against server-side ceilings inside `rebalanceRelayers`.
   */
  thresholds?: Partial<RebalanceThresholds>
  /**
   * If true and a pool can't meet its target via peer redistribution alone,
   * top up the shortfall from a funder wallet (FUNDER_PRIVATE_KEY, falling
   * back to ADMIN_PRIVATE_KEY). Default: false.
   */
  useFunderFallback?: boolean
  /**
   * Hard cap on the number of transfers we'll execute in one run.
   * Defends against a runaway loop and/or a misconfigured threshold pair.
   * Default: 10. Clamped to <= 50.
   */
  maxTransfersPerRun?: number
  /** If true, plan only — don't broadcast. Default: true. */
  dryRun?: boolean
  /** Restrict to specific pools. Empty / undefined = all pools. */
  pools?: PoolName[]
}

export interface WalletStatus {
  pool: PoolName
  address: string
  balanceWei: bigint
  balanceHype: string
  status: 'OK' | 'LOW' | 'RICH' | 'EMPTY'
}

export interface PlannedTransfer {
  pool: PoolName
  fromAddress: string
  toAddress: string
  amountWei: bigint
  amountHype: string
  source: 'peer' | 'funder'
}

export interface ExecutedTransfer extends PlannedTransfer {
  txHash?: string
  blockNumber?: number
  ok: boolean
  error?: string
}

export interface RebalanceReport {
  thresholds: RebalanceThresholds
  pools: PoolName[]
  totalsByPool: Record<PoolName, {
    walletCount: number
    totalHype: string
    lowCount: number
    richCount: number
    emptyCount: number
    shortfallHype: string
  }>
  before: WalletStatus[]
  funderAddress?: string
  funderBalanceHype?: string
  plan: PlannedTransfer[]
  executed: ExecutedTransfer[]
  after?: WalletStatus[]
  warnings: string[]
}

// ── Hard server-side ceilings ─────────────────────────────────────────────────
// These cap user-supplied thresholds so a stolen CRON_SECRET / ADMIN_API_KEY
// can't be used to drain the funder wallet by setting target=999.
const MAX_TARGET_HYPE = 1.0
const MAX_MAX_HYPE = 5.0
const MAX_TRANSFERS_PER_RUN_CEILING = 50
const GAS_RESERVE_HYPE = 0.01 // never let a donor go below this after sending
// Minimum surplus above `target` before we consider a peer-to-peer transfer.
// Prevents flapping: a peer at 0.105 HYPE doesn't shuttle 0.005 HYPE around
// while paying 21k gas to do it.
const PEER_DONATION_MIN_SURPLUS_HYPE = 0.02

const DEFAULT_THRESHOLDS: RebalanceThresholds = {
  minHype: 0.05,
  targetHype: 0.1,
  maxHype: 0.3,
}

// ── Env helpers ──────────────────────────────────────────────────────────────
function normalizePrivateKey(pk: string): string {
  const raw = String(pk || '').trim()
  if (!raw) return ''
  const v = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return ''
  return v
}

function parseJsonKeysEnv(envValue: string | undefined): string[] {
  if (!envValue) return []
  try {
    const cleaned = envValue.replace(/,\s*\]/g, ']')
    const arr = JSON.parse(cleaned)
    if (!Array.isArray(arr)) return []
    return arr.map((v) => normalizePrivateKey(String(v))).filter(Boolean)
  } catch {
    return []
  }
}

function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const pk of keys) {
    const norm = normalizePrivateKey(pk)
    if (!norm) continue
    const lc = norm.toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    out.push(norm)
  }
  return out
}

export interface ResolvedWallet {
  pool: PoolName
  address: string
  /** 0x-prefixed private key. NEVER LOG. Strip before serializing. */
  privateKey: string
}

/**
 * Build a checksum-address → pool map from the configured env. Cached so an
 * event-driven hot path (webhook handler) can do O(1) address → pool lookup
 * without re-parsing JSON env vars on every delivery.
 *
 * The cache only keeps `address → pool`; never private keys.
 */
let _addrPoolCache:
  | { stamp: number; map: Map<string, PoolName>; addresses: string[] }
  | null = null

const ADDR_POOL_CACHE_TTL_MS = 60_000

export function getRelayerAddressPoolMap(): { map: Map<string, PoolName>; addresses: string[] } {
  const now = Date.now()
  if (_addrPoolCache && now - _addrPoolCache.stamp < ADDR_POOL_CACHE_TTL_MS) {
    return { map: _addrPoolCache.map, addresses: _addrPoolCache.addresses }
  }
  const wallets = resolveAllRelayers()
  const map = new Map<string, PoolName>()
  for (const w of wallets) map.set(w.address.toLowerCase(), w.pool)
  const addresses = wallets.map((w) => w.address)
  _addrPoolCache = { stamp: now, map, addresses }
  return { map, addresses }
}

/**
 * Returns the pool a relayer address belongs to, or `undefined` if the
 * address is not one of our relayers. Address comparison is case-insensitive.
 */
export function getPoolForAddress(address: string): PoolName | undefined {
  if (!address) return undefined
  const { map } = getRelayerAddressPoolMap()
  return map.get(address.toLowerCase())
}

/**
 * Resolve every relayer wallet across all pools. Each wallet is tagged with
 * the pool that owns it, so we never cross-pool transfer.
 *
 * If the same address appears in multiple pools (e.g. small + global legacy),
 * it is assigned to the FIRST pool we resolve here. Order matters:
 *   small_trade -> big_trade -> deposit_withdrawal
 *
 * In production the small pool already covers the legacy global pool (they
 * share the same JSON keys), so this happens in practice.
 */
export function resolveAllRelayers(): ResolvedWallet[] {
  const out: ResolvedWallet[] = []
  const claimedAddrs = new Set<string>()

  const claim = (pool: PoolName, pk: string) => {
    const norm = normalizePrivateKey(pk)
    if (!norm) return
    let addr: string
    try {
      addr = ethers.getAddress(new ethers.Wallet(norm).address)
    } catch {
      return
    }
    const lc = addr.toLowerCase()
    if (claimedAddrs.has(lc)) return
    claimedAddrs.add(lc)
    out.push({ pool, address: addr, privateKey: norm })
  }

  // 1. Small-trade pool (preferred env, then legacy global).
  const smallKeys = dedupeKeys([
    ...parseJsonKeysEnv(process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON),
    ...parseJsonKeysEnv(process.env.RELAYER_PRIVATE_KEYS_JSON),
  ])
  for (const pk of smallKeys) claim('small_trade', pk)

  // 2. Big-trade pool.
  const bigKeys = dedupeKeys(parseJsonKeysEnv(process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON))
  for (const pk of bigKeys) claim('big_trade', pk)

  // 3. Singleton deposit/withdrawal bridge relayer.
  const dwKey =
    normalizePrivateKey(String(process.env.DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY || '')) ||
    normalizePrivateKey(String(process.env.RELAYER_PRIVATE_KEY || ''))
  if (dwKey) claim('deposit_withdrawal', dwKey)

  return out
}

/**
 * Resolve the funder wallet used for the optional top-up fallback.
 * Resolution order: FUNDER_PRIVATE_KEY -> ADMIN_PRIVATE_KEY.
 *
 * Important: we never log or return the private key — only the address.
 */
function resolveFunderKey(): string {
  const funder = normalizePrivateKey(String(process.env.FUNDER_PRIVATE_KEY || ''))
  if (funder) return funder
  return normalizePrivateKey(String(process.env.ADMIN_PRIVATE_KEY || ''))
}

// ── Threshold sanitization ───────────────────────────────────────────────────
function sanitizeThresholds(t: Partial<RebalanceThresholds> | undefined): RebalanceThresholds {
  const min = Number.isFinite(t?.minHype) ? Math.max(0, Number(t!.minHype)) : DEFAULT_THRESHOLDS.minHype
  let target = Number.isFinite(t?.targetHype)
    ? Math.max(min, Number(t!.targetHype))
    : Math.max(min, DEFAULT_THRESHOLDS.targetHype)
  if (target > MAX_TARGET_HYPE) target = MAX_TARGET_HYPE
  let max = Number.isFinite(t?.maxHype)
    ? Math.max(target, Number(t!.maxHype))
    : Math.max(target, DEFAULT_THRESHOLDS.maxHype)
  if (max > MAX_MAX_HYPE) max = MAX_MAX_HYPE
  return { minHype: min, targetHype: target, maxHype: max }
}

// ── Provider ─────────────────────────────────────────────────────────────────
function makeProvider(): ethers.JsonRpcProvider {
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.HYPERLIQUID_RPC_URL ||
    'https://rpc.hyperliquid.xyz/evm'
  const chainId = parseInt(process.env.CHAIN_ID || '999', 10)
  return new ethers.JsonRpcProvider(rpcUrl, chainId)
}

// ── Public: read-only status ─────────────────────────────────────────────────
export interface BalanceSnapshot {
  pools: PoolName[]
  wallets: WalletStatus[]
  funderAddress?: string
  funderBalanceHype?: string
  thresholds: RebalanceThresholds
  totalsByPool: RebalanceReport['totalsByPool']
}

export async function getBalanceSnapshot(
  rawThresholds?: Partial<RebalanceThresholds>,
  poolsFilter?: PoolName[],
): Promise<BalanceSnapshot> {
  const thresholds = sanitizeThresholds(rawThresholds)
  const provider = makeProvider()
  const allWallets = resolveAllRelayers()
  const filtered = poolsFilter && poolsFilter.length > 0
    ? allWallets.filter((w) => poolsFilter.includes(w.pool))
    : allWallets

  const balances = await Promise.all(filtered.map((w) => provider.getBalance(w.address)))
  const wallets: WalletStatus[] = filtered.map((w, i) => buildStatus(w.pool, w.address, balances[i], thresholds))

  const funderPk = resolveFunderKey()
  let funderAddress: string | undefined
  let funderBalanceHype: string | undefined
  if (funderPk) {
    try {
      funderAddress = ethers.getAddress(new ethers.Wallet(funderPk).address)
      const bal = await provider.getBalance(funderAddress)
      funderBalanceHype = ethers.formatEther(bal)
    } catch {
      // funderAddress remains undefined
    }
  }

  const totalsByPool = summarizeByPool(wallets, thresholds)

  return {
    pools: poolsFilter && poolsFilter.length > 0 ? poolsFilter : (['small_trade', 'big_trade', 'deposit_withdrawal'] as PoolName[]),
    wallets,
    funderAddress,
    funderBalanceHype,
    thresholds,
    totalsByPool,
  }
}

function buildStatus(
  pool: PoolName,
  address: string,
  balanceWei: bigint,
  t: RebalanceThresholds,
): WalletStatus {
  const balHype = parseFloat(ethers.formatEther(balanceWei))
  let status: WalletStatus['status']
  if (balHype <= 0.0001) status = 'EMPTY'
  else if (balHype < t.minHype) status = 'LOW'
  else if (balHype > t.maxHype) status = 'RICH'
  else status = 'OK'
  return {
    pool,
    address,
    balanceWei,
    balanceHype: ethers.formatEther(balanceWei),
    status,
  }
}

function summarizeByPool(wallets: WalletStatus[], t: RebalanceThresholds) {
  type Acc = { walletCount: number; totalWei: bigint; lowCount: number; richCount: number; emptyCount: number; shortfallWei: bigint }
  const accs: Record<PoolName, Acc> = {
    small_trade: emptyAcc(),
    big_trade: emptyAcc(),
    deposit_withdrawal: emptyAcc(),
  }
  const targetWei = ethers.parseEther(t.targetHype.toString())
  const minWei = ethers.parseEther(t.minHype.toString())
  for (const w of wallets) {
    const a = accs[w.pool]
    a.walletCount += 1
    a.totalWei += w.balanceWei
    if (w.status === 'EMPTY') a.emptyCount += 1
    if (w.status === 'LOW') a.lowCount += 1
    if (w.status === 'RICH') a.richCount += 1
    if (w.balanceWei < minWei) {
      const need = targetWei - w.balanceWei
      if (need > 0n) a.shortfallWei += need
    }
  }
  const totals: RebalanceReport['totalsByPool'] = {
    small_trade: finalize(accs.small_trade),
    big_trade: finalize(accs.big_trade),
    deposit_withdrawal: finalize(accs.deposit_withdrawal),
  }
  return totals
}

function emptyAcc() {
  return {
    walletCount: 0,
    totalWei: 0n,
    lowCount: 0,
    richCount: 0,
    emptyCount: 0,
    shortfallWei: 0n,
  }
}

function finalize(a: { walletCount: number; totalWei: bigint; lowCount: number; richCount: number; emptyCount: number; shortfallWei: bigint }) {
  return {
    walletCount: a.walletCount,
    totalHype: ethers.formatEther(a.totalWei),
    lowCount: a.lowCount,
    richCount: a.richCount,
    emptyCount: a.emptyCount,
    shortfallHype: ethers.formatEther(a.shortfallWei),
  }
}

function emptyTotals(): RebalanceReport['totalsByPool'][PoolName] {
  return finalize(emptyAcc())
}

// ── Plan ─────────────────────────────────────────────────────────────────────
interface MutableWallet {
  pool: PoolName
  address: string
  privateKey: string
  balanceWei: bigint
}

interface NormalizedOptions {
  thresholds: RebalanceThresholds
  useFunderFallback: boolean
  maxTransfersPerRun: number
  dryRun: boolean
  pools?: PoolName[]
}

interface PlanContext {
  thresholds: RebalanceThresholds
  options: NormalizedOptions
  funderAddress?: string
  funderBalanceWei?: bigint
}

function planForPool(
  pool: PoolName,
  walletsInPool: MutableWallet[],
  ctx: PlanContext,
): PlannedTransfer[] {
  const { thresholds } = ctx
  const minWei = ethers.parseEther(thresholds.minHype.toString())
  const targetWei = ethers.parseEther(thresholds.targetHype.toString())
  const reserveWei = ethers.parseEther(GAS_RESERVE_HYPE.toString())
  const peerDonationFloorWei = targetWei + ethers.parseEther(PEER_DONATION_MIN_SURPLUS_HYPE.toString())

  const out: PlannedTransfer[] = []

  // 1. Peer-to-peer redistribution within the same pool.
  // Donor   : balance > target + PEER_DONATION_MIN_SURPLUS  (donate down to target)
  // Recipient: balance < min                                 (top up to target)
  //
  // The "max" threshold is intentionally NOT used here — it only powers the
  // 'RICH' status display in reports. If a peer happens to be sitting on
  // surplus above target, we'd rather move it to drained peers right now than
  // wait for the wallet to cross max first. Otherwise an unbalanced pool
  // (e.g. one big donor at 0.24 HYPE while ten peers are EMPTY) just sits
  // there indefinitely.
  //
  // PEER_DONATION_MIN_SURPLUS provides anti-flap so we don't shuttle dust at
  // the cost of 21k gas per transfer.
  while (true) {
    const donors = walletsInPool
      .filter((w) => w.balanceWei > peerDonationFloorWei)
      .sort((a, b) => (b.balanceWei < a.balanceWei ? -1 : b.balanceWei > a.balanceWei ? 1 : 0))
    const recipients = walletsInPool
      .filter((w) => w.balanceWei < minWei)
      .sort((a, b) => (a.balanceWei < b.balanceWei ? -1 : a.balanceWei > b.balanceWei ? 1 : 0))

    if (donors.length === 0 || recipients.length === 0) break

    const donor = donors[0]
    const recipient = recipients[0]
    if (donor.address.toLowerCase() === recipient.address.toLowerCase()) break

    const donorAvailable = donor.balanceWei - targetWei // donate down to target
    const recipientNeed = targetWei - recipient.balanceWei
    let amount = donorAvailable < recipientNeed ? donorAvailable : recipientNeed
    if (amount <= 0n) break

    // Keep donor above gas reserve.
    if (donor.balanceWei - amount < reserveWei) {
      amount = donor.balanceWei - reserveWei
      if (amount <= 0n) break
    }

    out.push({
      pool,
      fromAddress: donor.address,
      toAddress: recipient.address,
      amountWei: amount,
      amountHype: ethers.formatEther(amount),
      source: 'peer',
    })

    donor.balanceWei -= amount
    recipient.balanceWei += amount

    if (out.length >= ctx.options.maxTransfersPerRun) return out
  }

  // 2. Funder fallback for any remaining shortfall.
  if (ctx.options.useFunderFallback && ctx.funderAddress && ctx.funderBalanceWei !== undefined) {
    let funderAvailable = ctx.funderBalanceWei - reserveWei
    for (const recipient of walletsInPool) {
      if (recipient.balanceWei >= minWei) continue
      if (recipient.address.toLowerCase() === ctx.funderAddress.toLowerCase()) continue
      const need = targetWei - recipient.balanceWei
      const amount = funderAvailable < need ? funderAvailable : need
      if (amount <= 0n) break
      out.push({
        pool,
        fromAddress: ctx.funderAddress,
        toAddress: recipient.address,
        amountWei: amount,
        amountHype: ethers.formatEther(amount),
        source: 'funder',
      })
      funderAvailable -= amount
      recipient.balanceWei += amount
      if (out.length >= ctx.options.maxTransfersPerRun) break
    }
    // Persist funderBalanceWei mutation across pools so the next pool sees the
    // already-spent amount.
    ctx.funderBalanceWei = funderAvailable + reserveWei
  }

  return out
}

// ── Public: full rebalance ───────────────────────────────────────────────────
export async function rebalanceRelayers(rawOptions: RebalanceOptions = {}): Promise<RebalanceReport> {
  const rawMax = rawOptions.maxTransfersPerRun
  const options: NormalizedOptions = {
    thresholds: sanitizeThresholds(rawOptions.thresholds),
    useFunderFallback: rawOptions.useFunderFallback ?? false,
    maxTransfersPerRun: Math.min(
      MAX_TRANSFERS_PER_RUN_CEILING,
      Math.max(1, typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : 10),
    ),
    dryRun: rawOptions.dryRun ?? true,
    pools: rawOptions.pools,
  }

  const provider = makeProvider()
  const warnings: string[] = []

  const allWallets = resolveAllRelayers()
  const filteredWallets = options.pools && options.pools.length > 0
    ? allWallets.filter((w) => options.pools!.includes(w.pool))
    : allWallets

  if (filteredWallets.length === 0) {
    return {
      thresholds: options.thresholds,
      pools: options.pools && options.pools.length > 0 ? options.pools : (['small_trade', 'big_trade', 'deposit_withdrawal'] as PoolName[]),
      totalsByPool: { small_trade: emptyTotals(), big_trade: emptyTotals(), deposit_withdrawal: emptyTotals() },
      before: [],
      plan: [],
      executed: [],
      warnings: ['No relayer keys configured for the selected pools.'],
    }
  }

  const balances = await Promise.all(filteredWallets.map((w) => provider.getBalance(w.address)))
  const before: WalletStatus[] = filteredWallets.map((w, i) =>
    buildStatus(w.pool, w.address, balances[i], options.thresholds),
  )

  // Mutable working copy used for planning. Same wallet identity stays in sync
  // across all pools so the funder shortfall accounting is consistent.
  const mutableByAddr = new Map<string, MutableWallet>()
  for (let i = 0; i < filteredWallets.length; i++) {
    mutableByAddr.set(filteredWallets[i].address.toLowerCase(), {
      pool: filteredWallets[i].pool,
      address: filteredWallets[i].address,
      privateKey: filteredWallets[i].privateKey,
      balanceWei: balances[i],
    })
  }

  // Funder
  const funderPk = resolveFunderKey()
  let funderAddress: string | undefined
  let funderBalanceWei: bigint | undefined
  if (funderPk) {
    try {
      funderAddress = ethers.getAddress(new ethers.Wallet(funderPk).address)
      funderBalanceWei = await provider.getBalance(funderAddress)
      if (options.useFunderFallback) {
        const reserveWei = ethers.parseEther(GAS_RESERVE_HYPE.toString())
        const minTopupWei = ethers.parseEther(options.thresholds.minHype.toString())
        if (funderBalanceWei <= reserveWei) {
          warnings.push(
            `Funder ${funderAddress} balance ${ethers.formatEther(funderBalanceWei)} HYPE is below gas reserve. Funder fallback effectively disabled.`,
          )
        } else if (funderBalanceWei < minTopupWei + reserveWei) {
          warnings.push(
            `Funder ${funderAddress} balance ${ethers.formatEther(funderBalanceWei)} HYPE can fund at most a partial top-up. Refill the funder wallet.`,
          )
        }
      }
    } catch {
      warnings.push('Failed to derive funder address from configured private key.')
    }
  } else if (options.useFunderFallback) {
    warnings.push('useFunderFallback=true but neither FUNDER_PRIVATE_KEY nor ADMIN_PRIVATE_KEY is set. Skipping fallback.')
  }

  // Build pool buckets and plan per pool.
  const poolsToProcess: PoolName[] = options.pools && options.pools.length > 0
    ? options.pools
    : (['small_trade', 'big_trade', 'deposit_withdrawal'] as PoolName[])

  const ctx: PlanContext = {
    thresholds: options.thresholds,
    options,
    funderAddress,
    funderBalanceWei,
  }

  const plan: PlannedTransfer[] = []
  for (const pool of poolsToProcess) {
    const walletsInPool: MutableWallet[] = []
    for (const w of mutableByAddr.values()) {
      if (w.pool === pool) walletsInPool.push(w)
    }
    if (walletsInPool.length === 0) continue
    const poolPlan = planForPool(pool, walletsInPool, ctx)
    plan.push(...poolPlan)
    if (plan.length >= options.maxTransfersPerRun) break
  }

  const report: RebalanceReport = {
    thresholds: options.thresholds,
    pools: poolsToProcess,
    totalsByPool: summarizeByPool(before, options.thresholds),
    before,
    funderAddress,
    funderBalanceHype: funderBalanceWei !== undefined ? ethers.formatEther(funderBalanceWei) : undefined,
    plan,
    executed: [],
    warnings,
  }

  if (options.dryRun || plan.length === 0) {
    return report
  }

  // ── Execute ─────────────────────────────────────────────────────────────
  // Group transfers by sender so we can reuse a single nonce stream per wallet.
  const bySender = new Map<string, PlannedTransfer[]>()
  for (const p of plan) {
    const k = p.fromAddress.toLowerCase()
    const arr = bySender.get(k) || []
    arr.push(p)
    bySender.set(k, arr)
  }

  // Map sender address (lower) -> private key. For peers we know the key from
  // mutableByAddr; for the funder we use funderPk.
  const senderKeyByAddr = new Map<string, string>()
  for (const w of mutableByAddr.values()) {
    senderKeyByAddr.set(w.address.toLowerCase(), w.privateKey)
  }
  if (funderAddress && funderPk) {
    senderKeyByAddr.set(funderAddress.toLowerCase(), funderPk)
  }

  // Resolve chain id once so every allocator call is consistent. Falls back
  // to 0n if the provider can't tell us — the allocator stores chain id as
  // a string and treats 0 as "unspecified".
  let chainId: bigint = 0n
  try {
    const net = await provider.getNetwork()
    chainId = BigInt(net.chainId)
  } catch {
    chainId = 0n
  }

  const executed: ExecutedTransfer[] = []
  for (const [senderLc, transfers] of bySender.entries()) {
    const pk = senderKeyByAddr.get(senderLc)
    if (!pk) {
      for (const t of transfers) {
        executed.push({ ...t, ok: false, error: 'No private key available for sender (bug?)' })
      }
      continue
    }
    const wallet = new ethers.Wallet(pk, provider)

    for (const t of transfers) {
      // Allocate per-transfer through the shared Supabase-backed allocator
      // (same RPC the trade-flow router uses). This prevents a rebalance tx
      // from racing the trade router for the same nonce on the same wallet.
      let allocatedNonce: bigint
      try {
        allocatedNonce = await allocateRelayerNonce({
          provider,
          address: wallet.address,
          chainId,
          label: `rebalance:${t.pool}`,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        executed.push({ ...t, ok: false, error: `Failed to allocate nonce: ${msg}` })
        continue
      }

      try {
        const tx = await wallet.sendTransaction({
          to: t.toAddress,
          value: t.amountWei,
          gasLimit: 21000n,
          nonce: Number(allocatedNonce),
        })
        // Bump the in-process hint so the next iteration (and any in-flight
        // trade-flow call in the same warm container) sees the new floor.
        bumpLocalNextNonce(wallet.address, chainId, allocatedNonce + 1n)
        const receipt = await tx.wait()
        // Best-effort audit row for the allocator; never throws.
        await markRelayerTxBroadcasted({
          address: wallet.address,
          chainId,
          nonce: allocatedNonce,
          txHash: tx.hash,
        })
        executed.push({
          ...t,
          ok: true,
          txHash: tx.hash,
          blockNumber: receipt?.blockNumber,
        })
      } catch (e: unknown) {
        const err = e as { shortMessage?: string; message?: string }
        // Don't bump the local cache — the next allocator call will fetch
        // fresh on-chain pending. The next cron tick retries idempotently.
        executed.push({ ...t, ok: false, error: err?.shortMessage || err?.message || String(e) })
      }
    }
  }

  // Re-read final balances for the report.
  const after: WalletStatus[] = await Promise.all(
    filteredWallets.map(async (w) => {
      const bal = await provider.getBalance(w.address)
      return buildStatus(w.pool, w.address, bal, options.thresholds)
    }),
  )

  report.executed = executed
  report.after = after
  return report
}

