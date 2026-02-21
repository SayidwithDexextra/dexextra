import { WalletData, WalletProvider } from '@/types/wallet'
import { env } from '@/lib/env'
import { getReadProvider as getUnifiedReadProvider, getChainId as getConfiguredChainId, getRpcUrl as getConfiguredRpcUrl } from '@/lib/network'
import { getEip6963ProviderByUuid, getEip6963Providers, startEip6963Discovery } from '@/lib/eip6963'
import { ethers } from 'ethers'
// Removed networks import - smart contract functionality deleted

// Ethereum provider interface (EIP-1193-ish)
export interface EthereumProvider {
  isMetaMask?: boolean
  isCoinbaseWallet?: boolean
  isTrust?: boolean
  isZerion?: boolean
  isRabby?: boolean
  isBraveWallet?: boolean
  isFrame?: boolean
  disconnect?: () => Promise<void> | void
  request: (args: { method: string; params?: any[] }) => Promise<any>
  on: (event: string, callback: (...args: any[]) => void) => void
  removeListener: (event: string, callback: (...args: any[]) => void) => void
}

// In a multi-wallet environment, `window.ethereum` can be an aggregator.
// We keep track of the wallet the user explicitly chose so subsequent calls
// (balance, chainId, event listeners, tx signing, etc.) use the intended provider.
let activeEthereumProvider: EthereumProvider | null = null

// When a user explicitly logs out, we disable auto-reconnect on page load.
// This prevents "silent re-login" via `eth_accounts` even if the wallet remains authorized.
const AUTO_CONNECT_DISABLED_KEY = 'wallet:autoConnectDisabled'

export const isWalletAutoConnectDisabled = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AUTO_CONNECT_DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

export const clearWalletAutoConnectDisabled = (): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(AUTO_CONNECT_DISABLED_KEY)
  } catch {
    // ignore
  }
}

function setWalletAutoConnectDisabled(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTO_CONNECT_DISABLED_KEY, '1')
  } catch {
    // ignore
  }
}

export const getActiveEthereumProvider = (): EthereumProvider | null => activeEthereumProvider

function setActiveEthereumProvider(provider: EthereumProvider | null) {
  activeEthereumProvider = provider
}

function getInjectedProviders(): EthereumProvider[] {
  if (typeof window === 'undefined') return []
  const eth: any = (window as any).ethereum
  if (!eth) return []
  if (Array.isArray(eth.providers) && eth.providers.length > 0) return eth.providers
  return [eth as EthereumProvider]
}

function findInjectedProvider(predicate: (p: any) => boolean): EthereumProvider | null {
  const providers = getInjectedProviders()
  for (const p of providers) {
    try {
      if (predicate(p)) return p
    } catch {
      // ignore bad providers
    }
  }
  return null
}

function isAggregatorEthereum(eth: any): boolean {
  return !!(eth && Array.isArray(eth.providers) && eth.providers.length > 0)
}

function resolveProviderForWallet(walletName: string): EthereumProvider | null {
  if (typeof window === 'undefined') return null
  const win: any = window as any
  const eth: any = win.ethereum
  const isAgg = isAggregatorEthereum(eth)

  console.log(`[resolveProviderForWallet] Resolving provider for: ${walletName}`)
  console.log(`[resolveProviderForWallet] window.ethereum exists:`, !!eth)
  console.log(`[resolveProviderForWallet] isAggregator:`, isAgg)
  console.log(`[resolveProviderForWallet] window.ethereum.providers:`, eth?.providers)
  console.log(`[resolveProviderForWallet] window.ethereum.providerMap:`, eth?.providerMap)
  
  // Some wallets use providerMap instead of providers array
  if (eth?.providerMap) {
    console.log(`[resolveProviderForWallet] providerMap entries:`)
    try {
      if (eth.providerMap instanceof Map) {
        eth.providerMap.forEach((v: any, k: string) => {
          console.log(`  ${k}:`, { isMetaMask: v?.isMetaMask, isBraveWallet: v?.isBraveWallet, isTrust: v?.isTrust })
        })
      } else {
        Object.entries(eth.providerMap).forEach(([k, v]: [string, any]) => {
          console.log(`  ${k}:`, { isMetaMask: v?.isMetaMask, isBraveWallet: v?.isBraveWallet, isTrust: v?.isTrust })
        })
      }
    } catch (e) {
      console.log(`  Error reading providerMap:`, e)
    }
  }
  
  if (isAgg) {
    console.log(`[resolveProviderForWallet] providers array length:`, eth.providers?.length)
    eth.providers?.forEach((p: any, i: number) => {
      console.log(`[resolveProviderForWallet] provider[${i}]:`, {
        isMetaMask: p?.isMetaMask,
        isBraveWallet: p?.isBraveWallet,
        isCoinbaseWallet: p?.isCoinbaseWallet,
        isTrust: p?.isTrust,
        isTrustWallet: p?.isTrustWallet,
        isZerion: p?.isZerion,
        isRabby: p?.isRabby,
        _metamask: !!p?._metamask,
      })
    })
  } else if (eth) {
    console.log(`[resolveProviderForWallet] single provider flags:`, {
      isMetaMask: eth?.isMetaMask,
      isBraveWallet: eth?.isBraveWallet,
      isCoinbaseWallet: eth?.isCoinbaseWallet,
      isTrust: eth?.isTrust,
      isTrustWallet: eth?.isTrustWallet,
      isZerion: eth?.isZerion,
      isRabby: eth?.isRabby,
      _metamask: !!eth?._metamask,
    })
  }
  
  // Log other potential MetaMask injection points
  console.log(`[resolveProviderForWallet] Other MetaMask locations:`, {
    'window.MetaMask': !!win.MetaMask,
    'window.metamask': !!win.metamask,
    'window.ethereum._metamask': !!eth?._metamask,
  })

  // Helper to check if a provider is genuinely MetaMask (not another wallet pretending to be MetaMask)
  const isGenuineMetaMask = (p: any): boolean => {
    if (!p?.isMetaMask) {
      console.log(`[isGenuineMetaMask] Provider does not have isMetaMask flag`)
      return false
    }
    // Trust Wallet, Rabby, and others set isMetaMask=true for compatibility
    // We need to exclude them by checking their own flags
    if (p.isTrust || p.isTrustWallet) {
      console.log(`[isGenuineMetaMask] Rejecting: Trust Wallet masquerading as MetaMask`)
      return false
    }
    if (p.isRabby) {
      console.log(`[isGenuineMetaMask] Rejecting: Rabby masquerading as MetaMask`)
      return false
    }
    if (p.isBraveWallet) {
      console.log(`[isGenuineMetaMask] Rejecting: Brave Wallet masquerading as MetaMask`)
      return false
    }
    if (p.isCoinbaseWallet) {
      console.log(`[isGenuineMetaMask] Rejecting: Coinbase Wallet masquerading as MetaMask`)
      return false
    }
    if (p.isZerion) {
      console.log(`[isGenuineMetaMask] Rejecting: Zerion masquerading as MetaMask`)
      return false
    }
    if (p.isRainbow) {
      console.log(`[isGenuineMetaMask] Rejecting: Rainbow masquerading as MetaMask`)
      return false
    }
    if (p.isPhantom) {
      console.log(`[isGenuineMetaMask] Rejecting: Phantom masquerading as MetaMask`)
      return false
    }
    if (p.isFrame) {
      console.log(`[isGenuineMetaMask] Rejecting: Frame masquerading as MetaMask`)
      return false
    }
    if (p.isOKExWallet) {
      console.log(`[isGenuineMetaMask] Rejecting: OKX Wallet masquerading as MetaMask`)
      return false
    }
    // Additional check: MetaMask typically has _metamask object
    // But don't require it since some versions may not have it
    console.log(`[isGenuineMetaMask] Found genuine MetaMask provider`)
    return true
  }

  switch (walletName) {
    case 'MetaMask':
      {
        // Check providerMap first (some aggregators use this)
        if (eth?.providerMap) {
          try {
            let mmProvider: EthereumProvider | null = null
            if (eth.providerMap instanceof Map) {
              mmProvider = eth.providerMap.get('MetaMask') || eth.providerMap.get('metamask')
            } else if (typeof eth.providerMap === 'object') {
              mmProvider = eth.providerMap['MetaMask'] || eth.providerMap['metamask']
            }
            if (mmProvider && isGenuineMetaMask(mmProvider)) {
              console.log(`[resolveProviderForWallet] MetaMask found in providerMap`)
              return mmProvider
            }
          } catch (e) {
            console.log(`[resolveProviderForWallet] Error checking providerMap:`, e)
          }
        }

        // Priority: providers array first (multi-wallet case)
        const fromProvidersArray = findInjectedProvider(isGenuineMetaMask)
        if (fromProvidersArray) {
          console.log(`[resolveProviderForWallet] MetaMask found in providers array (genuine)`)
          return fromProvidersArray
        }

        // Secondary check: Look for provider with _metamask property in providers array
        // This catches MetaMask even if isGenuineMetaMask fails due to flag pollution
        const fromProvidersWithMetamaskObj = findInjectedProvider((p) => {
          // Must have _metamask object (real MetaMask internal)
          if (!p?._metamask || typeof p._metamask !== 'object') return false
          // Must NOT be Brave Wallet
          if (p?.isBraveWallet) return false
          console.log(`[resolveProviderForWallet] Found provider with _metamask object (likely real MetaMask)`)
          return true
        })
        if (fromProvidersWithMetamaskObj) {
          console.log(`[resolveProviderForWallet] MetaMask found in providers array via _metamask property`)
          return fromProvidersWithMetamaskObj
        }

        // Check if window.ethereum itself is genuine MetaMask
        if (!isAgg && isGenuineMetaMask(eth)) {
          console.log(`[resolveProviderForWallet] MetaMask is window.ethereum directly (genuine)`)
          return eth as EthereumProvider
        }

        // Check legacy MetaMask injection points
        if (win.MetaMask && isGenuineMetaMask(win.MetaMask)) {
          console.log(`[resolveProviderForWallet] MetaMask found via window.MetaMask`)
          return win.MetaMask as EthereumProvider
        }

        if (win.metamask && isGenuineMetaMask(win.metamask)) {
          console.log(`[resolveProviderForWallet] MetaMask found via window.metamask`)
          return win.metamask as EthereumProvider
        }

        // Last resort: Check if eth has _metamask property (MetaMask internal)
        // Even if another wallet set isMetaMask, real MetaMask has _metamask object
        // BUT we must ensure it's not Brave Wallet pretending to be MetaMask
        if (eth?._metamask && typeof eth._metamask === 'object' && !eth?.isBraveWallet) {
          console.log(`[resolveProviderForWallet] MetaMask found via _metamask property (real MetaMask despite other flags)`)
          return eth as EthereumProvider
        }

        console.log(`[resolveProviderForWallet] MetaMask not found (no genuine MetaMask provider)`)
        return null
      }

    case 'Coinbase Wallet':
      return (
        findInjectedProvider((p) => p?.isCoinbaseWallet) ||
        (!isAgg && eth?.isCoinbaseWallet ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'Trust Wallet':
      return (
        (win.trustWallet as EthereumProvider) ||
        findInjectedProvider((p) => p?.isTrust || p?.isTrustWallet) ||
        (!isAgg && (eth?.isTrust || eth?.isTrustWallet) ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'Zerion':
      return (
        (win.zerion as EthereumProvider) ||
        findInjectedProvider((p) => p?.isZerion) ||
        (!isAgg && eth?.isZerion ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'Rabby':
      return (
        (win.rabby as EthereumProvider) ||
        findInjectedProvider((p) => p?.isRabby) ||
        (!isAgg && eth?.isRabby ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'Rainbow':
      return (
        findInjectedProvider((p) => p?.isRainbow) ||
        (!isAgg && eth?.isRainbow ? (eth as EthereumProvider) : null) ||
        null
      )


    case 'Frame':
      return (
        findInjectedProvider((p) => p?.isFrame) ||
        (!isAgg && eth?.isFrame ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'OKX Wallet':
      // OKX may inject `window.okxwallet` and/or appear in the providers array
      return (
        (win.okxwallet as EthereumProvider) ||
        findInjectedProvider((p) => p?.isOKExWallet) ||
        (!isAgg && eth?.isOKExWallet ? (eth as EthereumProvider) : null) ||
        null
      )

    case 'Phantom':
      return (win.phantom?.ethereum as EthereumProvider) || null

    case 'Talisman':
      return (win.talisman?.ethereum as EthereumProvider) || null

    case 'SubWallet':
      return (win.SubWallet as EthereumProvider) || null

    case 'Binance Wallet':
      return (win.BinanceChain as EthereumProvider) || null

    default:
      return null
  }
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
    web3?: any
    trustWallet?: EthereumProvider
    zerion?: EthereumProvider
    rabby?: EthereumProvider
    phantom?: {
      ethereum?: EthereumProvider
      solana?: any
    }
    talisman?: {
      ethereum?: EthereumProvider
    }
    SubWallet?: EthereumProvider
    okxwallet?: EthereumProvider
    BinanceChain?: EthereumProvider
    solana?: any
  }
}

// Utility functions
export const formatAddress = (address: string): string => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const formatBalance = (balance: string): string => {
  if (!balance) return '$0.00'
  const num = parseFloat(balance)
  if (num === 0) return '$0.00'
  if (num < 0.01) return '<$0.01'
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const generateAvatar = (address: string): string => {
  if (!address) return '👤'
  
  // Generate deterministic emoji/avatar based on address
  const emojis = ['🦊', '🚀', '💎', '⚡', '🌟', '🔥', '💰', '🎯', '🌈', '🦄', '🏆', '💫']
  const index = parseInt(address.slice(-2), 16) % emojis.length
  return emojis[index]
}

// Lightweight fallback provider factory using validated env
function getReadOnlyProvider(): ethers.JsonRpcProvider | null {
  try {
    return getUnifiedReadProvider()
  } catch {
    return null
  }
}

async function fetchBalanceViaRpc(address: string): Promise<string> {
  const provider = getReadOnlyProvider()
  if (!provider) return '0'
  try {
    const wei = await provider.getBalance(address)
    const eth = Number(ethers.formatEther(wei))
    if (!Number.isFinite(eth) || eth < 0) return '0'
    return eth.toFixed(6)
  } catch (e) {
    console.error('Fallback RPC balance fetch failed', e)
    return '0'
  }
}

// Enhanced wallet detection utilities with robust MetaMask detection
const isWalletInstalled = (walletName: string): boolean => {
  if (typeof window === 'undefined') return false
  
  switch (walletName) {
    case 'MetaMask':
      return !!resolveProviderForWallet('MetaMask')
    
    case 'Coinbase Wallet':
      return !!resolveProviderForWallet('Coinbase Wallet')
    
    case 'Trust Wallet':
      return !!resolveProviderForWallet('Trust Wallet')
    
    case 'Zerion':
      return !!resolveProviderForWallet('Zerion')
    
    case 'Rabby':
      return !!resolveProviderForWallet('Rabby')
    
    case 'Rainbow':
      return !!resolveProviderForWallet('Rainbow')
    
    case 'Phantom':
      return !!resolveProviderForWallet('Phantom')
    
    
    case 'Frame':
      return !!resolveProviderForWallet('Frame')
    
    case 'Talisman':
      return !!resolveProviderForWallet('Talisman')
    
    case 'SubWallet':
      return !!resolveProviderForWallet('SubWallet')
    
    case 'OKX Wallet':
      return !!resolveProviderForWallet('OKX Wallet')
    
    case 'Binance Wallet':
      return !!resolveProviderForWallet('Binance Wallet')
    
    default:
      return false
  }
}



// Enhanced debug function to help with wallet detection issues
export const debugWalletDetection = (): void => {
  if (typeof window === 'undefined') {
    console.log('🔍 Wallet Detection Debug: Running in SSR environment')
    return
  }
  
  const win = window as any
  console.log('🔍 Comprehensive Wallet Detection Debug:')
  console.log('=====================================')
  
  // Basic ethereum object check
  console.log('📟 Basic Detection:')
  console.log('  ethereum exists:', !!win.ethereum)
  console.log('  ethereum type:', typeof win.ethereum)
  
  if (win.ethereum) {
    console.log('\n🦊 MetaMask Detection:')
    console.log('  ethereum.isMetaMask:', win.ethereum.isMetaMask)
    console.log('  ethereum._metamask:', !!win.ethereum._metamask)
    console.log('  window.MetaMask:', !!win.MetaMask)
    console.log('  window.metamask:', !!win.metamask)
    console.log('  has request method:', typeof win.ethereum.request === 'function')
    
    console.log('\n🔵 Other Wallet Flags:')
    console.log('  ethereum.isCoinbaseWallet:', win.ethereum.isCoinbaseWallet)
    console.log('  ethereum.isBraveWallet:', win.ethereum.isBraveWallet)
    console.log('  ethereum.isRainbow:', win.ethereum.isRainbow)
    console.log('  ethereum.isFrame:', win.ethereum.isFrame)
    console.log('  ethereum.isTrust:', win.ethereum.isTrust)
    console.log('  ethereum.isTrustWallet:', win.ethereum.isTrustWallet)
    console.log('  ethereum.isZerion:', win.ethereum.isZerion)
    console.log('  ethereum.isRabby:', win.ethereum.isRabby)
    console.log('  ethereum.isOKExWallet:', win.ethereum.isOKExWallet)
    
    console.log('\n📦 Providers Array:')
    if (win.ethereum.providers) {
      console.log('  providers length:', win.ethereum.providers.length)
      win.ethereum.providers.forEach((provider: any, index: number) => {
        console.log(`  Provider ${index}:`, {
          isMetaMask: provider.isMetaMask,
          isCoinbaseWallet: provider.isCoinbaseWallet,
          isRabby: provider.isRabby,
          isBraveWallet: provider.isBraveWallet,
        })
      })
    } else {
      console.log('  No providers array found')
    }
    
    console.log('\n🔍 MetaMask Specific Detection Results:')
    console.log('  MetaMask detected by enhanced logic:', isWalletInstalled('MetaMask'))
  }
  
  console.log('\n🌐 Other Wallet Objects:')
  console.log('  window.trustWallet:', !!win.trustWallet)
  console.log('  window.zerion:', !!win.zerion)
  console.log('  window.rabby:', !!win.rabby)
  console.log('  window.phantom:', !!win.phantom)
  console.log('  window.talisman:', !!win.talisman)
  console.log('  window.SubWallet:', !!win.SubWallet)
  console.log('  window.okxwallet:', !!win.okxwallet)
  console.log('  window.BinanceChain:', !!win.BinanceChain)
  
  console.log('\n📊 All Wallet Detection Results:')
  const walletNames = ['MetaMask', 'Coinbase Wallet', 'Trust Wallet', 'Zerion', 'Rabby', 'Rainbow', 'Phantom', 'Frame', 'Talisman', 'SubWallet', 'OKX Wallet', 'Binance Wallet']
  walletNames.forEach(name => {
    console.log(`  ${name}:`, isWalletInstalled(name))
  })
  
  console.log('=====================================')
  
  // Get all window properties that might be wallet-related
  const walletProps = Object.keys(win).filter(key => 
    key.toLowerCase().includes('wallet') ||
    key.toLowerCase().includes('metamask') ||
    key.toLowerCase().includes('ethereum') ||
    key.toLowerCase().includes('web3') ||
    key.toLowerCase().includes('coinbase') ||
    key.toLowerCase().includes('trust') ||
    key.toLowerCase().includes('rabby') ||
    key.toLowerCase().includes('phantom')
  )
  
  if (walletProps.length > 0) {
    console.log('🔍 Wallet-related window properties:', walletProps)
  }
}

// Detect available wallet providers
export const detectWalletProviders = (): WalletProvider[] => {
  const providers: WalletProvider[] = []
  
  if (typeof window === 'undefined') {
    // Return default providers for SSR
    return getDefaultWalletList()
  }

  // Start EIP-6963 discovery (multi injected providers).
  // This populates a cache asynchronously; subsequent calls will pick up newly announced wallets.
  startEip6963Discovery()

  const eip6963 = getEip6963Providers()

  if (eip6963.length > 0) {
    // If multiple wallets announce the same display name, disambiguate with rdns.
    const nameCounts = new Map<string, number>()
    for (const { info } of eip6963) {
      nameCounts.set(info.name, (nameCounts.get(info.name) ?? 0) + 1)
    }

    for (const { info } of eip6963) {
      const displayName =
        (nameCounts.get(info.name) ?? 0) > 1 ? `${info.name} (${info.rdns})` : info.name

      providers.push({
        id: `eip6963:${info.uuid}`,
        name: displayName,
        icon: '🧩',
        iconUrl: info.icon,
        rdns: info.rdns,
        kind: 'injected',
        isInstalled: true,
        connect: () => connectEip6963Injected(info.uuid),
        disconnect: () => disconnect(),
      })
    }

    // Fallback for wallets that don't implement EIP-6963 but still inject `window.ethereum`.
    if ((window as any).ethereum) {
      providers.push({
        id: 'legacy:injected',
        name: 'Browser Wallet (Legacy)',
        icon: '🧩',
        kind: 'static',
        isInstalled: true,
        connect: () => connectGeneric(),
        disconnect: () => disconnect(),
      })
    }
  } else {
    // Fallback to heuristic-based static wallet detection when EIP-6963 is not available.
  
    // Define all possible wallets (Trust Wallet removed due to provider conflicts)
    const walletConfigs = [
      { id: 'static:metamask', name: 'MetaMask', icon: '🦊', connect: connectMetaMask },
      { id: 'static:coinbase', name: 'Coinbase Wallet', icon: '🔵', connect: connectCoinbase },
      { id: 'static:phantom', name: 'Phantom', icon: '👻', connect: connectPhantom },
      { id: 'static:zerion', name: 'Zerion', icon: '⚡', connect: connectZerion },
      { id: 'static:rabby', name: 'Rabby', icon: '🐰', connect: connectRabby },
      { id: 'static:rainbow', name: 'Rainbow', icon: '🌈', connect: connectRainbow },
      { id: 'static:frame', name: 'Frame', icon: '🖼️', connect: connectFrame },
      { id: 'static:talisman', name: 'Talisman', icon: '🔮', connect: connectTalisman },
      { id: 'static:subwallet', name: 'SubWallet', icon: '🌊', connect: connectSubWallet },
      { id: 'static:okx', name: 'OKX Wallet', icon: '⭕', connect: connectOKX },
      { id: 'static:binance', name: 'Binance Wallet', icon: '🟡', connect: connectBinance },
    ]

    // Check each wallet
    walletConfigs.forEach(wallet => {
      const isInstalled = isWalletInstalled(wallet.name)
      
      providers.push({
        id: wallet.id,
        name: wallet.name,
        icon: wallet.icon,
        kind: 'static',
        isInstalled,
        connect: isInstalled ? wallet.connect : () => Promise.reject(new Error(`${wallet.name} not installed`)),
        disconnect: () => disconnect(),
      })
    })
  }
  
  // Add WalletConnect (always available as it's web-based)
  providers.push({
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: '🔗',
    kind: 'walletconnect',
    isInstalled: true,
    connect: () => connectWalletConnect(),
    disconnect: () => disconnect(),
  })
  
  // Sort providers: installed first, then by popularity
  const popularOrder = [
    'MetaMask', 'Coinbase Wallet', 'Phantom', 'Zerion', 'Rainbow', 
    'Rabby', 'WalletConnect', 'Frame', 
    'Talisman', 'SubWallet', 'OKX Wallet', 'Binance Wallet'
  ]
  
  return providers.sort((a, b) => {
    // Installed wallets first
    if (a.isInstalled && !b.isInstalled) return -1
    if (!a.isInstalled && b.isInstalled) return 1
    
    // Then by popularity order
    const baseA = a.name.replace(/\s*\([^)]+\)\s*$/, '')
    const baseB = b.name.replace(/\s*\([^)]+\)\s*$/, '')
    const aIndex = popularOrder.indexOf(baseA)
    const bIndex = popularOrder.indexOf(baseB)
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex
    return safeA - safeB
  })
}

// Fallback wallet list for SSR
const getDefaultWalletList = (): WalletProvider[] => {
  const defaultWallets = [
    { name: 'MetaMask', icon: '🦊' },
    { name: 'Coinbase Wallet', icon: '🔵' },
    { name: 'Phantom', icon: '👻' },
    { name: 'Zerion', icon: '⚡' },
    { name: 'Rainbow', icon: '🌈' },
    { name: 'WalletConnect', icon: '🔗' },
    { name: 'Rabby', icon: '🐰' },
  ]
  
  return defaultWallets.map(wallet => ({
    id: `ssr:${wallet.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: wallet.name,
    icon: wallet.icon,
    kind: 'static',
    isInstalled: false,
    connect: () => Promise.reject(new Error(`${wallet.name} not available in SSR`)),
    disconnect: () => Promise.resolve(),
  }))
}

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((val) => {
        clearTimeout(t)
        resolve(val)
      })
      .catch((err) => {
        clearTimeout(t)
        reject(err)
      })
  })
}

const connectEip6963Injected = async (uuid: string): Promise<WalletData> => {
  if (typeof window === 'undefined') {
    throw new Error('Window object not available')
  }

  const detail = getEip6963ProviderByUuid(uuid)
  if (!detail) {
    throw new Error('Injected wallet not detected. Refresh the page and try again.')
  }

  const provider = detail.provider as any as EthereumProvider
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('Selected wallet provider does not support EIP-1193 requests')
  }

  const previousProvider = getActiveEthereumProvider()
  setActiveEthereumProvider(provider)

  try {
    // If accounts already connected, short-circuit without prompting
    try {
      const existingAccounts = await provider.request({ method: 'eth_accounts' })
      if (Array.isArray(existingAccounts) && existingAccounts.length > 0) {
        const address = existingAccounts[0]
        const balance = await getBalance(address, provider)
        const chainId = await getChainId(provider)
        return {
          address,
          balance,
          isConnected: true,
          isConnecting: false,
          chainId,
          avatar: generateAvatar(address),
        }
      }
    } catch {
      // continue to request accounts
    }

    const accounts = await withTimeout(
      provider.request({ method: 'eth_requestAccounts' }),
      12000,
      'Timed out waiting for the wallet. Open the extension and approve the request.'
    )

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No accounts found or user rejected the request')
    }

    const address = accounts[0]
    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      throw new Error('Invalid address format received from wallet')
    }

    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)

    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    setActiveEthereumProvider(previousProvider)

    if (error?.code === 4001) {
      throw new Error('User rejected the connection request')
    }
    if (error?.code === -32002) {
      throw new Error('Wallet is already processing a request. Open the extension and complete the approval.')
    }
    if (/timed out/i.test(String(error?.message))) {
      throw error
    }
    throw new Error(`Failed to connect to wallet: ${error?.message || 'Unknown error'}`)
  }
}

// Enhanced MetaMask connection with improved provider handling
export const connectMetaMask = async (): Promise<WalletData> => {
  if (typeof window === 'undefined') {
    throw new Error('Window object not available')
  }

  console.log('[connectMetaMask] Starting MetaMask connection...')
  
  const provider = resolveProviderForWallet('MetaMask')

  console.log('[connectMetaMask] Resolved provider:', provider)
  console.log('[connectMetaMask] Provider isMetaMask:', (provider as any)?.isMetaMask)
  console.log('[connectMetaMask] Provider _metamask:', !!(provider as any)?._metamask)
  
  if (!provider) {
    throw new Error('MetaMask not installed or not detected')
  }

  const previousProvider = getActiveEthereumProvider()
  setActiveEthereumProvider(provider)
  
  try {
    // If accounts already connected, short-circuit without prompting
    try {
      console.log('[connectMetaMask] Checking for existing accounts...')
      const existingAccounts = await provider.request({ method: 'eth_accounts' })
      console.log('[connectMetaMask] Existing accounts:', existingAccounts)
      if (Array.isArray(existingAccounts) && existingAccounts.length > 0) {
        const address = existingAccounts[0]
        const balance = await getBalance(address, provider)
        const chainId = await getChainId(provider)
        console.log('[connectMetaMask] Using existing account:', address)
        return {
          address,
          balance,
          isConnected: true,
          isConnecting: false,
          chainId,
          avatar: generateAvatar(address),
        }
      }
    } catch (existingError) {
      console.log('[connectMetaMask] Error checking existing accounts:', existingError)
    }

    // Use the specific MetaMask provider
    console.log('[connectMetaMask] Requesting accounts via eth_requestAccounts...')
    let accounts: string[] | undefined
    try {
      accounts = await withTimeout(
        provider.request({ method: 'eth_requestAccounts' }),
        12000
        ,
        'Timed out waiting for MetaMask. Open the extension and approve the request.'
      )
      console.log('[connectMetaMask] eth_requestAccounts returned:', accounts)
    } catch (primaryError: any) {
      console.log('[connectMetaMask] eth_requestAccounts error:', primaryError)
      console.log('[connectMetaMask] Error code:', primaryError?.code)
      console.log('[connectMetaMask] Error message:', primaryError?.message)
      
      // If already processing or no prompt surfaced, try permissions flow once
      if (primaryError?.code === -32002 || /timed out/i.test(String(primaryError?.message))) {
        console.log('[connectMetaMask] Trying wallet_requestPermissions fallback...')
        try {
          await withTimeout(
            provider.request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }],
            }),
            12000
            ,
            'Timed out waiting for MetaMask. Open the extension and approve the request.'
          )
          accounts = await provider.request({ method: 'eth_accounts' })
          console.log('[connectMetaMask] wallet_requestPermissions returned accounts:', accounts)
        } catch (permError) {
          console.log('[connectMetaMask] wallet_requestPermissions also failed:', permError)
          throw primaryError
        }
      } else {
        throw primaryError
      }
    }
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found or user rejected the request')
    }
    
    const address = accounts[0]
    
    // Validate the address format
    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      throw new Error('Invalid address format received from MetaMask')
    }
    
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    // If the connection fails, revert active provider to the previous one.
    setActiveEthereumProvider(previousProvider)

    // Provide more specific error messages
    if (error.code === 4001) {
      throw new Error('User rejected the connection request')
    } else if (error.code === -32002) {
      throw new Error('MetaMask is already processing a request. Please open the MetaMask extension and complete the approval.')
    } else if (error.message?.includes('User rejected')) {
      throw new Error('User rejected the connection request')
    } else if (/timed out/i.test(String(error.message))) {
      throw new Error('Timed out waiting for MetaMask. Please open the MetaMask extension and approve the connection request.')
    } else {
      throw new Error(`Failed to connect to MetaMask: ${error.message || 'Unknown error'}`)
    }
  }
}

// Connect to Coinbase Wallet
export const connectCoinbase = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Coinbase Wallet')
  if (!provider) {
    throw new Error('Coinbase Wallet not installed')
  }

  const previousProvider = getActiveEthereumProvider()
  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    setActiveEthereumProvider(previousProvider)
    throw new Error(`Failed to connect to Coinbase Wallet: ${error.message}`)
  }
}

// Connect to Trust Wallet
export const connectTrustWallet = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Trust Wallet')
  if (!provider) {
    throw new Error('Trust Wallet not installed')
  }

  const previousProvider = getActiveEthereumProvider()
  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    setActiveEthereumProvider(previousProvider)
    throw new Error(`Failed to connect to Trust Wallet: ${error.message}`)
  }
}

// Connect to Zerion
export const connectZerion = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Zerion')
  if (!provider) {
    throw new Error('Zerion not installed')
  }

  const previousProvider = getActiveEthereumProvider()
  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    setActiveEthereumProvider(previousProvider)
    throw new Error(`Failed to connect to Zerion: ${error.message}`)
  }
}

// Connect to Rabby
export const connectRabby = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Rabby')
  if (!provider) {
    throw new Error('Rabby not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Rabby: ${error.message}`)
  }
}

// Connect to Rainbow
export const connectRainbow = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Rainbow')
  if (!provider) {
    throw new Error('Rainbow not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Rainbow: ${error.message}`)
  }
}

// Connect to Phantom
export const connectPhantom = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Phantom')
  if (!provider) {
    throw new Error('Phantom not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Phantom: ${error.message}`)
  }
}


// Connect to Frame
export const connectFrame = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Frame')
  if (!provider) {
    throw new Error('Frame not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Frame: ${error.message}`)
  }
}

// Connect to Talisman
export const connectTalisman = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Talisman')
  if (!provider) {
    throw new Error('Talisman not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Talisman: ${error.message}`)
  }
}

// Connect to SubWallet
export const connectSubWallet = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('SubWallet')
  if (!provider) {
    throw new Error('SubWallet not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to SubWallet: ${error.message}`)
  }
}

// Connect to OKX Wallet
export const connectOKX = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('OKX Wallet')
  if (!provider) {
    throw new Error('OKX Wallet not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to OKX Wallet: ${error.message}`)
  }
}

// Connect to Binance Wallet
export const connectBinance = async (): Promise<WalletData> => {
  const provider = resolveProviderForWallet('Binance Wallet')
  if (!provider) {
    throw new Error('Binance Wallet not installed')
  }

  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Binance Wallet: ${error.message}`)
  }
}

// Connect via WalletConnect
export const connectWalletConnect = async (): Promise<WalletData> => {
  if (typeof window === 'undefined') {
    throw new Error('Window object not available')
  }

  const projectId = env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  if (!projectId) {
    throw new Error('WalletConnect project ID missing (set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)')
  }

  const previousProvider = getActiveEthereumProvider()

  try {
    const mod = await import('@walletconnect/ethereum-provider')
    const EthereumProviderCtor =
      (mod as any).EthereumProvider ?? (mod as any).default ?? (mod as any)

    const chainId = getConfiguredChainId()
    const rpcUrl = getConfiguredRpcUrl()

    const metadata = {
      name: 'Dexetera',
      description: 'DeFi Unlocked - Advanced DeFi Trading Platform',
      url: window.location.origin,
      icons: ['https://dexetera.win/Dexicon/LOGO-Dexetera-03.png'],
    }

    const wcProvider = (await EthereumProviderCtor.init({
      projectId,
      metadata,
      showQrModal: true,
      optionalChains: [chainId],
      rpcMap: rpcUrl ? { [chainId]: rpcUrl } : undefined,
    })) as EthereumProvider & { enable?: () => Promise<string[]> }

    // WalletConnect provider isn't injected, so we must make it the active provider.
    setActiveEthereumProvider(wcProvider)

    // Trigger account access request (opens QR modal).
    const accounts =
      (await wcProvider.enable?.()) ??
      (await wcProvider.request({ method: 'eth_requestAccounts' }))

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No accounts returned from WalletConnect')
    }

    const address = accounts[0]
    const balance = await getBalance(address, wcProvider)
    const connectedChainId = await getChainId(wcProvider)

    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId: connectedChainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    setActiveEthereumProvider(previousProvider)
    throw new Error(`WalletConnect connection failed: ${error?.message || 'Unknown error'}`)
  }
}

// Connect to generic Web3 provider
export const connectGeneric = async (): Promise<WalletData> => {
  if (!window.ethereum) {
    throw new Error('No Web3 provider found')
  }

  // Generic connect should prefer whichever provider is currently active,
  // otherwise it will use `window.ethereum`.
  const provider = activeEthereumProvider ?? window.ethereum
  setActiveEthereumProvider(provider)
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address, provider)
    const chainId = await getChainId(provider)
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to wallet: ${error.message}`)
  }
}

// Disconnect wallet
export const disconnect = async (): Promise<void> => {
  // Attempt to close WalletConnect sessions, if that's the active provider.
  try {
    const p = activeEthereumProvider as any
    if (p && typeof p.disconnect === 'function') {
      await p.disconnect()
    }
  } catch (e) {
    console.warn('Wallet disconnect cleanup failed:', e)
  }

  // Clear any stored wallet data
  if (typeof window !== 'undefined') {
    localStorage.removeItem('walletAddress')
    localStorage.removeItem('walletProvider')
  }

  setActiveEthereumProvider(null)
}

// Hard logout clears all local/session storage and disables auto-reconnect.
// Use this when the user clicks "Logout" in the UI.
export const hardLogout = async (): Promise<void> => {
  try {
    await disconnect()
  } finally {
    if (typeof window !== 'undefined') {
      try {
        // Clear all cached UI/app state on this origin.
        window.localStorage.clear()
      } catch {}
      try {
        window.sessionStorage.clear()
      } catch {}

      // Keep a single flag to prevent silent auto-login on reload.
      setWalletAutoConnectDisabled()
    }
  }
}

// Get account balance (mock implementation - replace with actual Web3 calls)
export const getBalance = async (address: string, ethereumProvider?: EthereumProvider): Promise<string> => {
  const provider = ethereumProvider ?? activeEthereumProvider ?? window.ethereum
  if (!provider) {
    console.error('No ethereum provider available; not retrying via fallback', {
      attemptedRpcUrl: getConfiguredRpcUrl(),
      configuredChainId: getConfiguredChainId(),
      address,
    })
    return '0'
  }
  
  if (!address || typeof address !== 'string') {
    console.error('Invalid address provided to getBalance:', address)
    return '0'
  }
  
  try {
     console.log('Fetching balance for address:', address)
    
    // Check if the provider supports eth_getBalance
    if (typeof provider.request !== 'function') {
      console.error('Provider does not support request method; not retrying via fallback', {
        attemptedRpcUrl: getConfiguredRpcUrl(),
        configuredChainId: getConfiguredChainId(),
        address,
      })
      return '0'
    }
    
    // Get ETH balance
    const balance = await provider.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })
    
     console.log('Raw balance response:', balance)
    
    if (!balance) {
      console.warn('No balance returned from provider')
      return '0'
    }
    
    // Convert from wei to ETH
    const ethBalance = parseInt(balance, 16) / Math.pow(10, 18)
    
    if (isNaN(ethBalance) || ethBalance < 0) {
      console.error('Invalid balance conversion:', balance, 'converted to:', ethBalance)
      return '0'
    }
    
     console.log('ETH balance:', ethBalance)
    
    // For now, return ETH balance directly instead of USD conversion
    // This avoids issues with external price APIs
    return ethBalance.toFixed(6)
    
  } catch (error: any) {
    console.error('Error fetching balance:', {
      error,
      errorMessage: error?.message,
      errorCode: error?.code,
      address,
      providerAvailable: !!provider,
      requestMethodAvailable: typeof provider?.request === 'function'
    })
    
    // Provide more specific error messages
    if (error?.code === 4001) {
      console.error('User rejected the balance request')
    } else if (error?.code === -32603) {
      console.error('Internal RPC error - not retrying via fallback', {
        attemptedRpcUrl: getConfiguredRpcUrl(),
        configuredChainId: getConfiguredChainId(),
        address,
      })
      return '0'
    } else if (error?.code === -32602) {
      console.error('Invalid method parameters')
    } else if (error?.message?.includes('network')) {
      console.error('Network connectivity issue; not retrying via fallback', {
        attemptedRpcUrl: getConfiguredRpcUrl(),
        configuredChainId: getConfiguredChainId(),
        address,
      })
      return '0'
    } else if (error?.message?.includes('timeout')) {
      console.error('Request timeout; not retrying via fallback', {
        attemptedRpcUrl: getConfiguredRpcUrl(),
        configuredChainId: getConfiguredChainId(),
        address,
      })
      return '0'
    }

    console.error('Unhandled balance error; not retrying via fallback', {
      attemptedRpcUrl: getConfiguredRpcUrl(),
      configuredChainId: getConfiguredChainId(),
      address,
    })
    return '0'
  }
}

// Get current chain ID
export const getChainId = async (ethereumProvider?: EthereumProvider): Promise<number> => {
  const provider = ethereumProvider ?? activeEthereumProvider ?? window.ethereum
  if (!provider) {
    console.warn('No ethereum provider available for chain ID; using configured chainId')
    return getConfiguredChainId()
  }
  
  try {
     console.log('Fetching chain ID...')
    
    if (typeof provider.request !== 'function') {
      console.error('Provider does not support request method for chain ID; using configured chainId')
      return getConfiguredChainId()
    }
    
    const chainId = await provider.request({
      method: 'eth_chainId',
    })
    
     console.log('Raw chain ID response:', chainId)
    
    if (!chainId) {
      console.warn('No chain ID returned from provider; using configured chainId')
      return getConfiguredChainId()
    }
    
    const parsedChainId = parseInt(chainId, 16)
    
    if (isNaN(parsedChainId) || parsedChainId <= 0) {
      console.error('Invalid chain ID:', chainId, 'parsed as:', parsedChainId, '; using configured chainId')
      return getConfiguredChainId()
    }
    
     console.log('Chain ID:', parsedChainId)
    return parsedChainId
    
  } catch (error: any) {
    console.error('Error fetching chain ID:', {
      error,
      errorMessage: error?.message,
      errorCode: error?.code,
      providerAvailable: !!provider,
      requestMethodAvailable: typeof provider?.request === 'function'
    })
    
    // Provide specific error messages
    if (error?.code === 4001) {
      console.error('User rejected the chain ID request')
    } else if (error?.code === -32603) {
      console.error('Internal RPC error when fetching chain ID')
    } else if (error?.message?.includes('network')) {
      console.error('Network issue when fetching chain ID')
    }

    return getConfiguredChainId()
  }
}

// Check if wallet is already connected
export const checkConnection = async (): Promise<WalletData | null> => {
  // If the user explicitly logged out, do not silently reconnect on page load.
  if (isWalletAutoConnectDisabled()) {
    return null
  }

  const candidates: EthereumProvider[] = []
  if (activeEthereumProvider) candidates.push(activeEthereumProvider)

  // Prefer explicit EIP-6963 discovered providers when available.
  try {
    startEip6963Discovery()
    for (const d of getEip6963Providers()) {
      if (d?.provider) candidates.push(d.provider as any as EthereumProvider)
    }
  } catch {
    // ignore
  }

  candidates.push(...getInjectedProviders())

  // Deduplicate by reference
  const uniqueCandidates = Array.from(new Set(candidates))

  if (uniqueCandidates.length === 0) {
     console.log('No ethereum provider available for connection check')
    return null
  }
  
  try {
     console.log('Checking wallet connection...')
    
    for (const provider of uniqueCandidates) {
      if (!provider || typeof provider.request !== 'function') continue

      let accounts: any
      try {
        accounts = await provider.request({ method: 'eth_accounts' })
      } catch {
        continue
      }

      console.log('Accounts found:', accounts?.length || 0)
      if (!accounts || accounts.length === 0) continue

      const address = accounts[0]
      console.log('Connected account:', address)
      setActiveEthereumProvider(provider)
    
      // Get balance and chain ID with error handling
      let balance = '0'
      let chainId = 1
    
      try {
        balance = await getBalance(address, provider)
      } catch (balanceError) {
        console.warn('Failed to get balance during connection check:', balanceError)
      }
    
      try {
        chainId = await getChainId(provider)
      } catch (chainError) {
        console.warn('Failed to get chain ID during connection check:', chainError)
      }
    
      const walletData: WalletData = {
        address,
        balance,
        isConnected: true,
        isConnecting: false,
        chainId,
        avatar: generateAvatar(address),
      }
    
      console.log('Connection check successful:', walletData)
      return walletData
    }

    console.log('No connected accounts found')
    return null
    
  } catch (error: any) {
    console.error('Error checking connection:', {
      error,
      errorMessage: error?.message,
      errorCode: error?.code,
      providerAvailable: uniqueCandidates.length > 0,
      requestMethodAvailable: uniqueCandidates.some(p => typeof p?.request === 'function')
    })
    
    // Don't throw, just return null to indicate no connection
    return null
  }
}

// Listen for account changes
export const onAccountsChanged = (callback: (accounts: string[]) => void) => {
  const provider = activeEthereumProvider ?? window.ethereum
  if (provider) provider.on('accountsChanged', callback)
}

// Listen for chain changes
export const onChainChanged = (callback: (chainId: string) => void) => {
  const provider = activeEthereumProvider ?? window.ethereum
  if (provider) provider.on('chainChanged', callback)
}

// Remove event listeners
export const removeListeners = () => {
  const provider = activeEthereumProvider ?? window.ethereum
  if (!provider) return
  provider.removeListener('accountsChanged', () => {})
  provider.removeListener('chainChanged', () => {})
}

// Diagnostic function to help debug wallet issues
export const diagnoseWalletIssues = async (): Promise<void> => {
   console.log('🔍 Running wallet diagnostics...')
  
  // Check browser environment
   console.log('Browser environment:', {
    userAgent: navigator.userAgent,
    isSecureContext: window.isSecureContext,
    protocol: window.location.protocol,
  })
  
  // Check ethereum provider
   console.log('Ethereum provider check:', {
    windowEthereumExists: !!window.ethereum,
    isMetaMask: window.ethereum?.isMetaMask,
    isCoinbaseWallet: window.ethereum?.isCoinbaseWallet,
    requestMethodExists: typeof window.ethereum?.request === 'function',
    onMethodExists: typeof window.ethereum?.on === 'function',
  })
  
  if (!window.ethereum) {
    console.error('❌ No ethereum provider found. Please install a wallet extension.')
    return
  }
  
  try {
    // Test basic provider functionality
     console.log('Testing provider methods...')
    
    // Test accounts method
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
       console.log('✅ eth_accounts works:', accounts?.length || 0, 'accounts')
    } catch (accountsError) {
      console.error('❌ eth_accounts failed:', accountsError)
    }
    
    // Test chain ID method
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' })
       console.log('✅ eth_chainId works:', chainId)
    } catch (chainError) {
      console.error('❌ eth_chainId failed:', chainError)
    }
    
    // Test balance method (if we have an account)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      if (accounts && accounts.length > 0) {
        const balance = await window.ethereum.request({
          method: 'eth_getBalance',
          params: [accounts[0], 'latest']
        })
         console.log('✅ eth_getBalance works:', balance)
      } else {
         console.log('⏭️ Skipping eth_getBalance (no connected accounts)')
      }
    } catch (balanceError) {
      console.error('❌ eth_getBalance failed:', balanceError)
    }
    
    // Test network connectivity
    try {
      const networkVersion = await window.ethereum.request({ method: 'net_version' })
       console.log('✅ Network version:', networkVersion)
    } catch (networkError) {
      console.error('❌ Network connectivity issue:', networkError)
    }
    
  } catch (error) {
    console.error('❌ Provider diagnostics failed:', error)
  }
  
   console.log('🔍 Wallet diagnostics complete')
}

// Network switching functionality
// Lightweight NetworkConfig for switching helpers
type NetworkConfig = {
  chainId: number
  displayName: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrl: string
  blockExplorer: string
}

const formatChainIdForMetaMask = (chainId: number): `0x${string}` => {
  return `0x${chainId.toString(16)}` as `0x${string}`
}

const NETWORKS: Record<string, NetworkConfig> = {
  polygon: { chainId: 137, displayName: 'Polygon', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrl: env.RPC_URL, blockExplorer: 'https://polygonscan.com' },
  mumbai: { chainId: 80001, displayName: 'Polygon Mumbai', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrl: env.RPC_URL, blockExplorer: 'https://mumbai.polygonscan.com' },
  ethereum: { chainId: 1, displayName: 'Ethereum', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrl: env.RPC_URL, blockExplorer: 'https://etherscan.io' },
  hardhat: { chainId: 31337, displayName: 'Hardhat', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrl: env.RPC_URL, blockExplorer: 'http://localhost:8545' },
}

const getNetworkByChainId = (chainId: number): NetworkConfig | undefined => {
  return Object.values(NETWORKS).find(n => n.chainId === chainId)
}

export const switchNetwork = async (network: NetworkConfig): Promise<boolean> => {
  const provider = activeEthereumProvider ?? window.ethereum
  if (!provider) {
    throw new Error('No ethereum provider found')
  }

  const chainIdHex = formatChainIdForMetaMask(network.chainId)
  
  try {
     console.log(`🔀 Switching to ${network.displayName} (Chain ID: ${network.chainId})`)
    
    // Try to switch to the network
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
    
     console.log(`✅ Successfully switched to ${network.displayName}`)
    return true
    
  } catch (switchError: any) {
     console.log('Switch error:', switchError)
    
    // If the network doesn't exist, add it
    if (switchError.code === 4902) {
       console.log(`📝 Network not found, adding ${network.displayName} to wallet...`)
      
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: network.displayName,
              nativeCurrency: network.nativeCurrency,
              rpcUrls: [network.rpcUrl],
              blockExplorerUrls: [network.blockExplorer],
            },
          ],
        })
        
         console.log(`✅ Successfully added and switched to ${network.displayName}`)
        return true
        
      } catch (addError: any) {
        console.error(`❌ Failed to add ${network.displayName}:`, addError)
        throw new Error(`Failed to add ${network.displayName}: ${addError.message}`)
      }
    } else {
      console.error(`❌ Failed to switch to ${network.displayName}:`, switchError)
      throw new Error(`Failed to switch to ${network.displayName}: ${switchError.message}`)
    }
  }
}

// Switch to Polygon Mainnet specifically
export const switchToPolygon = async (): Promise<boolean> => {
  return switchNetwork(NETWORKS.polygon)
}

// Switch to Polygon Mumbai testnet
export const switchToMumbai = async (): Promise<boolean> => {
  return switchNetwork(NETWORKS.mumbai)
}

// Switch to Ethereum Mainnet
export const switchToEthereum = async (): Promise<boolean> => {
  return switchNetwork(NETWORKS.ethereum)
}

// Switch to Hardhat (local development)
export const switchToHardhat = async (): Promise<boolean> => {
  return switchNetwork(NETWORKS.hardhat)
}

// Get current network info
export const getCurrentNetwork = async (): Promise<NetworkConfig | null> => {
  try {
    const chainId = await getChainId()
    const network = getNetworkByChainId(chainId)
    
    if (!network) {
      console.warn(`Unknown network with chain ID: ${chainId}`)
      return null
    }
    
    return network
  } catch (error) {
    console.error('Error getting current network:', error)
    return null
  }
}

// Check if current network is supported
export const isNetworkSupported = async (): Promise<boolean> => {
  try {
    const chainId = await getChainId()
    return getNetworkByChainId(chainId) !== undefined
  } catch (error) {
    console.error('Error checking network support:', error)
    return false
  }
}

// Get network-specific contract addresses
export const getNetworkContracts = async (): Promise<{ [contractName: string]: string } | null> => {
  try {
    const network = await getCurrentNetwork()
    if (!network) return null
    
    // This would typically come from your deployed contract addresses
    // For now, return empty object as contracts need to be deployed per network
    return {}
  } catch (error) {
    console.error('Error getting network contracts:', error)
    return null
  }
} 