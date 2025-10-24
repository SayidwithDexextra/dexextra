import { CHAIN_CONFIG } from './contractConfig'
import { env } from './env'

// HyperLiquid mainnet chain id from deployments
const HYPERLIQUID_CHAIN_ID = 999

export function isHyperLiquid(): boolean {
  try {
    const id = Number(CHAIN_CONFIG?.chainId)
    return Number.isFinite(id) && id === HYPERLIQUID_CHAIN_ID
  } catch {
    return false
  }
}

// Conservative default gas limit for complex flows on HyperLiquid mainnet
export const DEFAULT_HYPER_GAS_LIMIT: bigint = BigInt(env.DEFAULT_GAS_LIMIT || 12_000_000)

function clampGasLimit(value: bigint): bigint {
  const min = BigInt(env.MIN_GAS_LIMIT || 0)
  const max = BigInt(env.MAX_GAS_LIMIT || 0)
  let out = value
  if (min > 0n && out < min) out = min
  if (max > 0n && out > max) out = max
  return out
}

export function getEthersFallbackOverrides() {
  if (!isHyperLiquid()) return {}
  return { gasLimit: clampGasLimit(DEFAULT_HYPER_GAS_LIMIT) }
}

export function getBufferedGasLimit(estimated: bigint, bufferPercent?: number): bigint {
  const percent = typeof bufferPercent === 'number' ? bufferPercent : (env.GAS_BUFFER_PERCENT ?? 80)
  const bp = BigInt(Math.max(0, Math.min(500, Math.floor(percent))))
  const buffered = (estimated * (100n + bp)) / 100n
  return clampGasLimit(buffered)
}

// For viem-based writers
export function getViemGasOverrides(): Record<string, unknown> {
  if (!isHyperLiquid()) return {}
  // viem uses `gas` for the gas limit field
  return { gas: clampGasLimit(DEFAULT_HYPER_GAS_LIMIT) }
}


