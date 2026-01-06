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
   * If the pool is empty and this is set, we will include RELAYER_PRIVATE_KEY as pool[0].
   */
  allowFallbackSingleKey?: boolean
}

export function loadRelayerPoolFromEnv(cfg: RelayerPoolConfig): RelayerKey[] {
  const keysRaw: string[] = []

  if (cfg.jsonEnv) {
    const j = String(process.env[cfg.jsonEnv] || '').trim()
    if (j) keysRaw.push(...parseJsonKeys(j))
  }

  // Global fallback: allow one env var to define the relayer set for all pools.
  // This lets you avoid “slots” while still keeping the code’s pool abstraction.
  if (keysRaw.length === 0) {
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
    const v = String(process.env.RELAYER_PRIVATE_KEY || '').trim()
    if (v) keysRaw.push(v)
  }

  const out: RelayerKey[] = []
  for (let i = 0; i < keysRaw.length; i++) {
    const pk = normalizePrivateKey(keysRaw[i])
    if (!pk) continue
    const address = new ethers.Wallet(pk).address
    out.push({
      id: `${cfg.pool}:${i}`,
      pool: cfg.pool,
      address: ethers.getAddress(address),
      privateKey: pk,
    })
  }
  return out
}

export function redactRelayerKeys(keys: RelayerKey[]) {
  return keys.map((k) => ({ id: k.id, pool: k.pool, address: k.address }))
}


