import { ethers } from 'ethers'
import { loadRelayerPoolFromEnv, type RelayerKey, type RelayerPoolConfig } from './relayerKeys'
import { getSupabaseServer } from './supabase-server'

export type RelayerPoolName =
  | 'hub_trade'
  | 'hub_inbox'
  | 'spoke_outbox_arbitrum'
  | 'spoke_inbox_arbitrum'
  | 'spoke_outbox_polygon'
  | 'spoke_inbox_polygon'

const POOLS: Record<RelayerPoolName, RelayerPoolConfig> = {
  hub_trade: {
    pool: 'hub_trade',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_TRADE_',
    allowFallbackSingleKey: true,
  },
  hub_inbox: {
    pool: 'hub_inbox',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_HUB_INBOX_',
    allowFallbackSingleKey: true,
  },
  spoke_outbox_arbitrum: {
    pool: 'spoke_outbox_arbitrum',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_ARBITRUM_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_ARBITRUM_',
    allowFallbackSingleKey: true,
  },
  spoke_inbox_arbitrum: {
    pool: 'spoke_inbox_arbitrum',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_SPOKE_INBOX_ARBITRUM_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_SPOKE_INBOX_ARBITRUM_',
    allowFallbackSingleKey: true,
  },
  spoke_outbox_polygon: {
    pool: 'spoke_outbox_polygon',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_POLYGON_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_POLYGON_',
    allowFallbackSingleKey: true,
  },
  spoke_inbox_polygon: {
    pool: 'spoke_inbox_polygon',
    jsonEnv: 'RELAYER_PRIVATE_KEYS_SPOKE_INBOX_POLYGON_JSON',
    indexedPrefix: 'RELAYER_PRIVATE_KEY_SPOKE_INBOX_POLYGON_',
    allowFallbackSingleKey: true,
  },
}

const poolCache = new Map<RelayerPoolName, RelayerKey[]>()
const rrCounter = new Map<RelayerPoolName, number>()

// Per-address in-process serialization chain
const sendChains = new Map<string, Promise<unknown>>()

function runExclusive<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const prev = sendChains.get(address) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // Keep chain alive even if errors happen
  sendChains.set(address, next.catch(() => undefined))
  return next
}

function loadPool(name: RelayerPoolName): RelayerKey[] {
  if (poolCache.has(name)) return poolCache.get(name)!
  const keys = loadRelayerPoolFromEnv(POOLS[name])
  poolCache.set(name, keys)
  return keys
}

function pickRoundRobin(name: RelayerPoolName, keys: RelayerKey[]): RelayerKey {
  const n = keys.length
  if (n === 0) throw new Error(`No relayer keys configured for pool: ${name}`)
  const cur = rrCounter.get(name) ?? 0
  rrCounter.set(name, cur + 1)
  return keys[cur % n]
}

function pickByHash(name: RelayerPoolName, keys: RelayerKey[], sticky: string): RelayerKey {
  const n = keys.length
  if (n === 0) throw new Error(`No relayer keys configured for pool: ${name}`)
  const h = ethers.keccak256(ethers.toUtf8Bytes(String(sticky).toLowerCase()))
  const idx = Number(BigInt(h) % BigInt(n))
  return keys[idx]
}

function pickByAddress(keys: RelayerKey[], requiredAddress: string): RelayerKey | null {
  try {
    const want = ethers.getAddress(requiredAddress)
    return keys.find((k) => ethers.getAddress(k.address) === want) ?? null
  } catch {
    return null
  }
}

export type WithRelayerOptions = {
  pool: RelayerPoolName
  provider: ethers.Provider
  /**
   * When set, route deterministically within a pool. Useful for sessions to reduce key churn.
   * This is a routing hint and does not replace a shared nonce allocator.
   */
  stickyKey?: string
  /**
   * When set, requires a specific relayer address from the pool (hard constraint).
   * Used when the on-chain session requires a specific relayer address.
   */
  requireAddress?: string
  action: (wallet: ethers.Wallet, meta: { key: RelayerKey }) => Promise<unknown>
}

export async function withRelayer<T>(opts: Omit<WithRelayerOptions, 'action'> & { action: (wallet: ethers.Wallet, meta: { key: RelayerKey }) => Promise<T> }): Promise<T> {
  const keys = loadPool(opts.pool)
  let key: RelayerKey | null = null

  if (opts.requireAddress) {
    key = pickByAddress(keys, opts.requireAddress)
    if (!key) {
      throw new Error(
        `Required relayer address ${opts.requireAddress} is not present in pool ${opts.pool}. ` +
          `Add it via env (RELAYER_PRIVATE_KEY_*), or recreate the session/permit for an available relayer.`
      )
    }
  } else if (opts.stickyKey) {
    key = pickByHash(opts.pool, keys, opts.stickyKey)
  } else {
    key = pickRoundRobin(opts.pool, keys)
  }

  const wallet = new ethers.Wallet(key.privateKey, opts.provider)

  return await runExclusive(wallet.address, async () => {
    return await opts.action(wallet, { key })
  })
}

export async function sendWithNonceRetry<T extends ethers.Contract>(
  params: {
    provider: ethers.Provider
    wallet: ethers.Wallet
    contract: T
    method: string
    args: any[]
    overrides?: Record<string, any>
    attempts?: number
    label?: string
  }
): Promise<ethers.TransactionResponse> {
  const attempts = params.attempts ?? 4
  const label = params.label ?? `${params.method}`

  let chainId: bigint = 0n
  try {
    const net = await params.provider.getNetwork()
    chainId = BigInt(net.chainId)
  } catch {
    chainId = 0n
  }

  let lastErr: any = null
  for (let i = 0; i < attempts; i++) {
    const observedPending = await (params.provider as any).getTransactionCount(params.wallet.address, 'pending')
    let nonce: bigint = BigInt(observedPending)

    // Optional Supabase-backed allocator (prevents cross-instance nonce collisions).
    // Enabled automatically when service-role env is present, unless RELAYER_NONCE_ALLOCATOR=disabled.
    try {
      const mode = String(process.env.RELAYER_NONCE_ALLOCATOR || '').trim().toLowerCase()
      const enabled = mode !== 'disabled' && mode !== 'off'
      if (enabled) {
        const sb = getSupabaseServer()
        if (sb) {
          const { data, error } = await sb.rpc('allocate_relayer_nonce', {
            p_relayer_address: params.wallet.address,
            p_chain_id: chainId.toString(),
            p_observed_pending_nonce: nonce.toString(),
            p_label: label,
          } as any)
          if (error) throw error
          // data is a bigint-like number in JSON; normalize to bigint
          nonce = BigInt(data as any)
        }
      }
    } catch (e: any) {
      // Fall back to observed pending nonce; do not block tx sending if allocator is down/misconfigured.
      if (process.env.NODE_ENV !== 'production') {
        const msg = String(e?.message || e)
        console.warn(`[relayer][nonce-allocator] allocator unavailable, falling back: ${msg}`)
      }
    }
    try {
      const fn = (params.contract as any)[params.method]
      if (typeof fn !== 'function') throw new Error(`Contract missing method: ${params.method}`)
      const tx: ethers.TransactionResponse = await fn(...params.args, {
        ...(params.overrides || {}),
        nonce,
      })

      // Best-effort mark broadcasted for observability
      try {
        const mode = String(process.env.RELAYER_NONCE_ALLOCATOR || '').trim().toLowerCase()
        const enabled = mode !== 'disabled' && mode !== 'off'
        if (enabled) {
          const sb = getSupabaseServer()
          if (sb) {
            await sb.rpc('mark_relayer_tx_broadcasted', {
              p_relayer_address: params.wallet.address,
              p_chain_id: chainId.toString(),
              p_nonce: nonce.toString(),
              p_tx_hash: tx.hash,
            } as any)
          }
        }
      } catch {
        // ignore
      }

      return tx
    } catch (e: any) {
      lastErr = e
      const msg = String(e?.reason || e?.shortMessage || e?.message || e)
      const m = msg.toLowerCase()
      const nonceish =
        m.includes('nonce has already been used') ||
        m.includes('nonce too low') ||
        m.includes('already known') ||
        m.includes('known transaction') ||
        m.includes('replacement transaction underpriced')
      if (!nonceish) throw e
      // brief delay before retry to let provider/mempool catch up
      await new Promise((r) => setTimeout(r, 600))
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[relayer][nonce-retry] ${label} attempt ${i + 1}/${attempts} failed: ${msg}`)
      }
    }
  }
  throw lastErr
}


