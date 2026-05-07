import { ethers } from 'ethers'

export type RelayerKey = {
  /** Stable ID within the pool (e.g. hub_trade:0) */
  id: string
  /** Pool name (e.g. hub_trade) */
  pool: string
  /** EOA address derived from the private key */
  address: string
  /** 0x-prefixed 32-byte private key. Never log this. */
  privateKey: string
}

function normalizePrivateKey(pk: string): string {
  const raw = String(pk || '').trim()
  if (!raw) return ''
  const v = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return ''
  return v
}

/**
 * Resolve the dedicated deposit/withdrawal bridge relayer private key.
 *
 * This is the address granted RELAYER_ROLE / WITHDRAW_*_ROLE / BRIDGE_ENDPOINT_ROLE
 * on the hub + spoke contracts (in production: 0x0258eDbF16cD01537Fde74a57D49fb10500Ee4b7).
 *
 * Resolution order:
 *   1. DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY (preferred — makes intent explicit)
 *   2. RELAYER_PRIVATE_KEY (back-compat — keeps existing prod env working)
 *
 * Returns the normalized 0x-prefixed key, or '' if neither env var is set.
 */
export function getDepositWithdrawalRelayerKey(): string {
  const preferred = normalizePrivateKey(String(process.env.DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY || ''))
  if (preferred) return preferred
  return normalizePrivateKey(String(process.env.RELAYER_PRIVATE_KEY || ''))
}

/** True iff the legacy RELAYER_PRIVATE_KEY is being used as the bridge key. */
export function isUsingLegacyDepositWithdrawalRelayerEnv(): boolean {
  const explicit = normalizePrivateKey(String(process.env.DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY || ''))
  if (explicit) return false
  return !!normalizePrivateKey(String(process.env.RELAYER_PRIVATE_KEY || ''))
}

function parseJsonKeys(json: string): string[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return v.map((x) => String(x || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

export type RelayerPoolConfig = {
  /** Logical pool name used for routing */
  pool: string
  /** Optional JSON env var containing an array of keys */
  jsonEnv?: string
  /**
   * Optional global JSON env var containing an array of keys.
   * If set and the pool-specific envs are empty, we will use this as a fallback.
   *
   * Default (when omitted): RELAYER_PRIVATE_KEYS_JSON.
   */
  globalJsonEnv?: string
  /** Optional indexed env var prefix, e.g. RELAYER_PRIVATE_KEY_HUB_TRADE_ */
  indexedPrefix?: string
  /** Max indexed keys to scan to avoid infinite loops */
  maxIndexed?: number
  /**
   * Backward-compatible fallback.
   * If the pool is empty and this is set, we will include the deposit-withdrawal
   * relayer key (DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY, falling back to
   * RELAYER_PRIVATE_KEY) as pool[0].
   */
  allowFallbackSingleKey?: boolean
  /**
   * Optional JSON env var(s) containing keys that should be EXCLUDED from this pool.
   * Any private key appearing in these env vars will never be returned for this pool.
   * This prevents overlapping keys (e.g. "big" relayers) from being used for session signing.
   */
  excludeJsonEnvs?: string[]
  /**
   * When true, this pool will NOT fall back to the global RELAYER_PRIVATE_KEYS_JSON
   * (or any env named by `globalJsonEnv`). Use this for sensitive single-purpose
   * pools (e.g. deposit/withdrawal bridge relayer) so they cannot silently inherit
   * unrelated keysets like the gasless trade relayers.
   *
   * Resolution becomes: pool-specific jsonEnv → indexed env vars →
   * (allowFallbackSingleKey ? deposit-withdrawal relayer key : empty).
   */
  disableGlobalFallback?: boolean
}

export function loadRelayerPoolFromEnv(cfg: RelayerPoolConfig): RelayerKey[] {
  const keysRaw: string[] = []

  if (cfg.jsonEnv) {
    const j = String(process.env[cfg.jsonEnv] || '').trim()
    if (j) keysRaw.push(...parseJsonKeys(j))
  }

  // Global fallback: allow one env var to define the relayer set for all pools.
  // This lets you avoid “slots” while still keeping the code’s pool abstraction.
  // Pools that opt in to disableGlobalFallback (e.g. bridge deposit/withdrawal)
  // skip this step so they cannot inherit unrelated keysets like trade relayers.
  if (keysRaw.length === 0 && !cfg.disableGlobalFallback) {
    const globalEnv = cfg.globalJsonEnv || 'RELAYER_PRIVATE_KEYS_JSON'
    const j = String(process.env[globalEnv] || '').trim()
    if (j) keysRaw.push(...parseJsonKeys(j))
  }

  if (cfg.indexedPrefix) {
    const max = Number.isFinite(cfg.maxIndexed) ? (cfg.maxIndexed as number) : 50
    for (let i = 0; i < max; i++) {
      const name = `${cfg.indexedPrefix}${i}`
      const v = String(process.env[name] || '').trim()
      if (!v) continue
      keysRaw.push(v)
    }
  }

  if (cfg.allowFallbackSingleKey && keysRaw.length === 0) {
    const v = getDepositWithdrawalRelayerKey()
    if (v) keysRaw.push(v)
  }

  // Build exclusion set from excludeJsonEnvs (normalized private keys)
  const excludedKeys = new Set<string>()
  if (cfg.excludeJsonEnvs && cfg.excludeJsonEnvs.length > 0) {
    for (const envName of cfg.excludeJsonEnvs) {
      const j = String(process.env[envName] || '').trim()
      if (!j) continue
      const parsed = parseJsonKeys(j)
      for (const rawPk of parsed) {
        const normPk = normalizePrivateKey(rawPk)
        if (normPk) excludedKeys.add(normPk.toLowerCase())
      }
    }
  }

  const out: RelayerKey[] = []
  let idx = 0
  for (const rawPk of keysRaw) {
    const pk = normalizePrivateKey(rawPk)
    if (!pk) continue
    // Skip keys that are in the exclusion set
    if (excludedKeys.has(pk.toLowerCase())) continue
    const address = new ethers.Wallet(pk).address
    out.push({
      id: `${cfg.pool}:${idx}`,
      pool: cfg.pool,
      address: ethers.getAddress(address),
      privateKey: pk,
    })
    idx++
  }
  return out
}

export function redactRelayerKeys(keys: RelayerKey[]) {
  return keys.map((k) => ({ id: k.id, pool: k.pool, address: k.address }))
}

/**
 * Returns the full set of relayer addresses that any session permit must
 * authorize via its `relayerSetRoot`.
 *
 * The trade router (src/app/api/gasless/trade/route.ts) can route to either
 * the small pool OR the big pool depending on gas estimate. If the big pool's
 * addresses are NOT in the session's Merkle root, `chargeSession` reverts
 * with "session: bad relayer" the moment a big-block trade escalates.
 *
 * To keep root construction and proof construction consistent, every site
 * that builds either a Merkle root or a Merkle proof for a session MUST use
 * this helper. Sources merged (deduped by checksum address):
 *   - RELAYER_PRIVATE_KEYS_JSON         (global / legacy small-trade pool)
 *   - RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON
 *   - RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON
 *   - RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON   (legacy hub_trade pool)
 *   - DEPOSIT_WITHDRAWAL_RELAYER_PRIVATE_KEY / RELAYER_PRIVATE_KEY (only if
 *     none of the above are populated, to preserve dev/single-key fallback)
 *
 * NOTE: The deposit/withdrawal bridge relayer is intentionally NOT added by
 * default — it's a sensitive single-purpose key that should not be in trade
 * sessions. It is only used as a last-resort fallback when no trade keys are
 * present (e.g. local dev).
 */
export function loadAllSessionRelayerAddresses(): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const pushAddrsFromJsonEnv = (envName: string) => {
    const raw = String(process.env[envName] || '').trim()
    if (!raw) return
    for (const rawPk of parseJsonKeys(raw)) {
      const pk = normalizePrivateKey(rawPk)
      if (!pk) continue
      let addr: string
      try {
        addr = ethers.getAddress(new ethers.Wallet(pk).address)
      } catch {
        continue
      }
      const key = addr.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(addr)
    }
  }

  pushAddrsFromJsonEnv('RELAYER_PRIVATE_KEYS_JSON')
  pushAddrsFromJsonEnv('RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON')
  pushAddrsFromJsonEnv('RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON')
  pushAddrsFromJsonEnv('RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON')

  // Indexed-env fallback (RELAYER_PRIVATE_KEY_HUB_TRADE_*, etc.) — covered for
  // parity with loadRelayerPoolFromEnv. Only scan a bounded range.
  const indexedPrefixes = [
    'RELAYER_PRIVATE_KEY_HUB_TRADE_',
    'RELAYER_PRIVATE_KEY_HUB_TRADE_SMALL_',
    'RELAYER_PRIVATE_KEY_HUB_TRADE_BIG_',
  ]
  for (const prefix of indexedPrefixes) {
    for (let i = 0; i < 50; i++) {
      const v = String(process.env[`${prefix}${i}`] || '').trim()
      if (!v) continue
      const pk = normalizePrivateKey(v)
      if (!pk) continue
      let addr: string
      try {
        addr = ethers.getAddress(new ethers.Wallet(pk).address)
      } catch {
        continue
      }
      const key = addr.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(addr)
    }
  }

  // Last-resort single-key fallback for dev so a local one-key setup still works.
  if (out.length === 0) {
    const pk = getDepositWithdrawalRelayerKey()
    if (pk) {
      try {
        const addr = ethers.getAddress(new ethers.Wallet(pk).address)
        out.push(addr)
      } catch {
        // ignore
      }
    }
  }

  return out
}


