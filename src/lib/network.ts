import { ethers } from 'ethers'
import { env } from './env'

// Single source of truth for network configuration and provider/signer creation

export function getRpcUrl(): string {
  return env.RPC_URL
}

export function getBackupRpcUrls(): string[] {
  const urls: string[] = []
  if (env.RPC_URL_BACKUP) urls.push(env.RPC_URL_BACKUP)
  if (env.RPC_URLS) {
    urls.push(
      ...env.RPC_URLS.split(',')
        .map(s => s.trim())
        .filter(Boolean)
    )
  }
  // De-dup against primary
  return Array.from(new Set(urls.filter(u => u && u !== env.RPC_URL)))
}

export function getWsRpcUrl(): string {
  return env.WS_RPC_URL
}

export function getBackupWsRpcUrl(): string | null {
  return env.WS_RPC_URL_BACKUP || null
}

export function getChainId(): number {
  return env.CHAIN_ID
}

function getExpectedChainId(): number {
  const id = getChainId()
  if (!Number.isFinite(id)) {
    throw new Error('Invalid CHAIN_ID configuration')
  }
  return id
}

// Cache providers to ensure a single long-lived instance is reused
let cachedHttpProvider: ethers.Provider | null = null
let cachedWsProvider: ethers.WebSocketProvider | null = null

export function getReadProvider(): ethers.Provider {
  if (cachedHttpProvider) return cachedHttpProvider

  const primary = new ethers.JsonRpcProvider(getRpcUrl(), getChainId())
  const backups = getBackupRpcUrls().map(url => new ethers.JsonRpcProvider(url, getChainId()))

  // If no backups configured, return primary
  if (backups.length === 0) {
    cachedHttpProvider = primary
    return cachedHttpProvider
  }

  // Create a FallbackProvider with quorum 1 (any successful)
  // Use small stallTimeout to bump slow providers quickly
  const configs = [primary, ...backups].map((p, idx) => ({
    provider: p as any,
    priority: idx + 1,
    stallTimeout: 400,
    weight: 1,
  })) as any

  cachedHttpProvider = new ethers.FallbackProvider(configs, getChainId(), { quorum: 1 }) as unknown as ethers.Provider
  return cachedHttpProvider
}

export function getWsProvider(): ethers.WebSocketProvider | null {
  try {
    if (cachedWsProvider) return cachedWsProvider
    const url = getWsRpcUrl()
    if (!url) return null
    // Try primary, fall back to backup only if initial connect fails
    try {
      cachedWsProvider = new ethers.WebSocketProvider(url, getChainId())
      return cachedWsProvider
    } catch {
      const backup = getBackupWsRpcUrl()
      if (backup) {
        cachedWsProvider = new ethers.WebSocketProvider(backup, getChainId())
        return cachedWsProvider
      }
      throw new Error('WS connect failed')
    }
  } catch {
    return null
  }
}

export async function getInjectedSignerIfOnCorrectChain(): Promise<ethers.Signer | null> {
  if (typeof window === 'undefined' || !(window as any).ethereum) return null
  try {
    const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
    const net = await browserProvider.getNetwork()
    if (Number(net.chainId) !== getChainId()) return null
    return await browserProvider.getSigner()
  } catch {
    return null
  }
}

export async function getRunner(): Promise<ethers.Provider | ethers.Signer> {
  const signer = await getInjectedSignerIfOnCorrectChain()
  return signer || getReadProvider()
}

export async function ensureHyperliquidWallet(): Promise<ethers.Signer> {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    throw new Error('No wallet provider available')
  }

  const ethereum = (window as any).ethereum
  const expectedChainId = getExpectedChainId()
  const expectedChainHex = `0x${expectedChainId.toString(16)}`

  const readInjectedChainId = async (): Promise<number> => {
    try {
      const chainHex = await ethereum.request({ method: 'eth_chainId' })
      if (typeof chainHex === 'string') {
        return parseInt(chainHex, 16)
      }
    } catch {
      // Fall back to ethers network lookup below
    }
    const browserProvider = new ethers.BrowserProvider(ethereum)
    const net = await browserProvider.getNetwork()
    return Number(net.chainId)
  }

  const trySwitch = async () => {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedChainHex }]
    })
  }

  const tryAddAndSwitch = async () => {
    if (!env.RPC_URL) return
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: expectedChainHex,
        chainName: 'Hyperliquid',
        nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
        rpcUrls: [env.RPC_URL],
        blockExplorerUrls: env.APP_URL ? [env.APP_URL] : []
      }]
    })
    await trySwitch()
  }

  let currentChainId = await readInjectedChainId()
  if (currentChainId !== expectedChainId) {
    try {
      await trySwitch()
    } catch (switchErr: any) {
      const userRejected = switchErr?.code === 4001
      const chainMissing = switchErr?.code === 4902

      if (chainMissing) {
        try {
          await tryAddAndSwitch()
        } catch (addErr: any) {
          const addRejected = addErr?.code === 4001
          throw new Error(
            addRejected
              ? 'Please approve adding the Hyperliquid network, then retry.'
              : `Unable to add or switch networks automatically. Open your wallet and select chainId ${expectedChainId} (hex ${expectedChainHex}).`
          )
        }
      } else if (userRejected) {
        throw new Error(`You rejected the network switch. Please accept the prompt to use chainId ${expectedChainId}.`)
      } else {
        throw new Error(`We couldn't switch networks automatically. Select chainId ${expectedChainId} (hex ${expectedChainHex}) in your wallet and retry.`)
      }
    }

    currentChainId = await readInjectedChainId()
    if (currentChainId !== expectedChainId) {
      throw new Error(`Network mismatch. Wallet shows chainId ${currentChainId}, expected ${expectedChainId}. Please switch in your wallet and retry.`)
    }
  }

  const freshProvider = new ethers.BrowserProvider(ethereum)
  return freshProvider.getSigner()
}

export function isOnCorrectChain(chainId?: number | bigint): boolean {
  const expected = BigInt(getChainId())
  if (chainId === undefined) return true
  try {
    return BigInt(chainId) === expected
  } catch {
    return false
  }
}

// Get a snapshot block number to ensure consistent multi-call reads
// If preferFinalized is true, subtract confirmation depth from head
export async function getSnapshotBlockNumber(preferFinalized = false): Promise<number> {
  const provider = getReadProvider()
  const head = await provider.getBlockNumber()
  if (!preferFinalized) return head
  const depth = Math.max(0, (env.CONFIRMATION_DEPTH || 0) - 1)
  return Math.max(0, head - depth)
}


