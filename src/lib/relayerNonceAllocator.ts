import { ethers } from 'ethers'
import { getSupabaseServer } from './supabase-server'

/**
 * Shared nonce allocator for relayer wallets.
 *
 * Why this exists
 *   The trade-relayer router (src/lib/relayerRouter.ts → sendWithNonceRetry)
 *   and the relayer rebalancer (src/lib/relayerBalanceMonitor.ts) both submit
 *   transactions from the same EOAs. If they pick nonces independently
 *   from `provider.getTransactionCount(addr,'pending')` they can race and
 *   collide — the loser's tx fails with "nonce too low" or "replacement
 *   underpriced".
 *
 *   This module wraps the Postgres function `allocate_relayer_nonce` (and
 *   its companion `mark_relayer_tx_broadcasted`) that the router already
 *   uses, so the rebalancer can share the exact same atomically-allocated
 *   nonce stream. Across Vercel instances the Supabase RPC is the source of
 *   truth; a per-process `localNextNonce` cache avoids redundant DB lookups
 *   in the hot path.
 *
 * Behavior
 *   - When `RELAYER_NONCE_ALLOCATOR=disabled` (or `off`), or when Supabase
 *     env vars are missing, this gracefully falls back to bare on-chain
 *     pending nonce + local cache. That mirrors the router's behavior so
 *     no existing deployment breaks if the allocator is intentionally
 *     turned off.
 *   - Failures inside the allocator (DB hiccup) are logged and we fall
 *     back to the bare candidate nonce — never throw upward.
 *
 * NEVER LOG PRIVATE KEYS. Only addresses, chain ids, nonces, tx hashes.
 */

const localNextNonce = new Map<string, bigint>()

function nonceCacheKey(address: string, chainId: bigint): string {
  return `${chainId.toString()}:${String(address).toLowerCase()}`
}

export function isAllocatorEnabled(): boolean {
  const mode = String(process.env.RELAYER_NONCE_ALLOCATOR || '').trim().toLowerCase()
  return mode !== 'disabled' && mode !== 'off'
}

export interface AllocateNonceParams {
  provider: ethers.Provider
  address: string
  chainId: bigint
  /** Free-form label written to the allocator audit row (e.g. 'rebalance', 'placeOrder'). */
  label: string
}

/**
 * Resolve the next nonce for `address` on `chainId`.
 *
 * Order of preference:
 *   1. Supabase allocator RPC (cluster-safe, atomic).
 *   2. max(local cache hint, on-chain pending) — best-effort fallback when
 *      the allocator is unavailable or disabled.
 */
export async function allocateRelayerNonce(opts: AllocateNonceParams): Promise<bigint> {
  const { provider, address, chainId, label } = opts

  const observedPendingRaw = await (provider as { getTransactionCount: (a: string, t: string) => Promise<number | bigint> })
    .getTransactionCount(address, 'pending')
  const observedPending = BigInt(observedPendingRaw)

  const cached = localNextNonce.get(nonceCacheKey(address, chainId))
  let candidate: bigint = cached !== undefined && cached > observedPending ? cached : observedPending

  if (!isAllocatorEnabled()) return candidate

  try {
    const sb = getSupabaseServer()
    if (!sb) return candidate
    const { data, error } = await sb.rpc('allocate_relayer_nonce', {
      p_relayer_address: address,
      p_chain_id: chainId.toString(),
      p_observed_pending_nonce: candidate.toString(),
      p_label: label,
    } as Record<string, unknown>)
    if (error) throw error
    candidate = BigInt(data as string | number | bigint)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[nonce-allocator] allocate failed for ${label}@${address}: ${msg}`)
  }

  return candidate
}

/**
 * Best-effort observability: tell Postgres which tx hash claimed which
 * nonce. Mirrors the call the trade router makes after a successful
 * broadcast. Never throws.
 */
export async function markRelayerTxBroadcasted(opts: {
  address: string
  chainId: bigint
  nonce: bigint
  txHash: string
}): Promise<void> {
  if (!isAllocatorEnabled()) return
  try {
    const sb = getSupabaseServer()
    if (!sb) return
    await sb.rpc('mark_relayer_tx_broadcasted', {
      p_relayer_address: opts.address,
      p_chain_id: opts.chainId.toString(),
      p_nonce: opts.nonce.toString(),
      p_tx_hash: opts.txHash,
    } as Record<string, unknown>)
  } catch {
    // observability call only; never propagate
  }
}

export function bumpLocalNextNonce(address: string, chainId: bigint, nextHint: bigint): void {
  const key = nonceCacheKey(address, chainId)
  const cur = localNextNonce.get(key)
  if (cur === undefined || nextHint > cur) localNextNonce.set(key, nextHint)
}
