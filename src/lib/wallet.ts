import { WalletData, WalletProvider } from '@/types/wallet'
import { env } from '@/lib/env'
import { ethers } from 'ethers'
// Removed networks import - smart contract functionality deleted

// Ethereum provider interface
interface EthereumProvider {
  isMetaMask?: boolean
  isCoinbaseWallet?: boolean
  isTrust?: boolean
  isZerion?: boolean
  isRabby?: boolean
  isBraveWallet?: boolean
  isFrame?: boolean
  request: (args: { method: string; params?: any[] }) => Promise<any>
  on: (event: string, callback: (...args: any[]) => void) => void
  removeListener: (event: string, callback: (...args: any[]) => void) => void
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
    if (!env?.RPC_URL) return null
    return new ethers.JsonRpcProvider(env.RPC_URL)
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
  
  const win = window as any
  
  switch (walletName) {
    case 'MetaMask':
      // Enhanced MetaMask detection - check multiple scenarios
      if (win.ethereum?.isMetaMask) return true
      
      // Check if ethereum exists and providers array contains MetaMask
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isMetaMask)
      }
      
      // Check if MetaMask object exists directly
      if (win.MetaMask || win.metamask) return true
      
      // Check for ethereum with MetaMask properties but no isMetaMask flag
      if (win.ethereum && !win.ethereum.isMetaMask) {
        // Sometimes MetaMask is available but the flag isn't set immediately
        // Check for MetaMask-specific methods
        const hasMetaMaskMethods = win.ethereum.request && 
          typeof win.ethereum.request === 'function' &&
          win.ethereum._metamask
        if (hasMetaMaskMethods) return true
      }
      
      return false
    
    case 'Coinbase Wallet':
      if (win.ethereum?.isCoinbaseWallet) return true
      if (win.ethereum?.selectedProvider?.isCoinbaseWallet) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isCoinbaseWallet)
      }
      return false
    
    case 'Trust Wallet':
      if (win.trustWallet) return true
      if (win.ethereum?.isTrust || win.ethereum?.isTrustWallet) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isTrust || provider.isTrustWallet)
      }
      return false
    
    case 'Zerion':
      if (win.zerion) return true
      if (win.ethereum?.isZerion) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isZerion)
      }
      return false
    
    case 'Rabby':
      if (win.rabby) return true
      if (win.ethereum?.isRabby) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isRabby)
      }
      return false
    
    case 'Rainbow':
      if (win.ethereum?.isRainbow) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isRainbow)
      }
      return false
    
    case 'Phantom':
      return !!(win.phantom?.ethereum || win.solana?.isPhantom)
    
    case 'Brave Wallet':
      if (win.ethereum?.isBraveWallet) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isBraveWallet)
      }
      return false
    
    case 'Frame':
      if (win.ethereum?.isFrame) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isFrame)
      }
      return false
    
    case 'Talisman':
      return !!(win.talisman)
    
    case 'SubWallet':
      return !!(win.SubWallet)
    
    case 'OKX Wallet':
      if (win.okxwallet) return true
      if (win.ethereum?.isOKExWallet) return true
      if (win.ethereum?.providers) {
        return win.ethereum.providers.some((provider: any) => provider.isOKExWallet)
      }
      return false
    
    case 'Binance Wallet':
      return !!(win.BinanceChain)
    
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
  const walletNames = ['MetaMask', 'Coinbase Wallet', 'Trust Wallet', 'Zerion', 'Rabby', 'Rainbow', 'Phantom', 'Brave Wallet', 'Frame', 'Talisman', 'SubWallet', 'OKX Wallet', 'Binance Wallet']
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
  
  // Define all possible wallets
  const walletConfigs = [
    { name: 'MetaMask', icon: '🦊', connect: connectMetaMask },
    { name: 'Coinbase Wallet', icon: '🔵', connect: connectCoinbase },
    { name: 'Trust Wallet', icon: '🛡️', connect: connectTrustWallet },
    { name: 'Zerion', icon: '⚡', connect: connectZerion },
    { name: 'Rabby', icon: '🐰', connect: connectRabby },
    { name: 'Rainbow', icon: '🌈', connect: connectRainbow },
    { name: 'Phantom', icon: '👻', connect: connectPhantom },
    { name: 'Brave Wallet', icon: '🦁', connect: connectBrave },
    { name: 'Frame', icon: '🖼️', connect: connectFrame },
    { name: 'Talisman', icon: '🔮', connect: connectTalisman },
    { name: 'SubWallet', icon: '🌊', connect: connectSubWallet },
    { name: 'OKX Wallet', icon: '⭕', connect: connectOKX },
    { name: 'Binance Wallet', icon: '🟡', connect: connectBinance },
  ]
  
  // Check each wallet
  walletConfigs.forEach(wallet => {
    const isInstalled = isWalletInstalled(wallet.name)
    
    providers.push({
      name: wallet.name,
      icon: wallet.icon,
      isInstalled,
      connect: isInstalled ? wallet.connect : () => Promise.reject(new Error(`${wallet.name} not installed`)),
      disconnect: () => disconnect(),
    })
  })
  
  // Add WalletConnect (always available as it's web-based)
  providers.push({
    name: 'WalletConnect',
    icon: '🔗',
    isInstalled: true,
    connect: () => connectWalletConnect(),
    disconnect: () => disconnect(),
  })
  
  // Sort providers: installed first, then by popularity
  const popularOrder = [
    'MetaMask', 'Coinbase Wallet', 'Trust Wallet', 'Zerion', 'Rainbow', 
    'Phantom', 'Rabby', 'WalletConnect', 'Brave Wallet', 'Frame', 
    'Talisman', 'SubWallet', 'OKX Wallet', 'Binance Wallet'
  ]
  
  return providers.sort((a, b) => {
    // Installed wallets first
    if (a.isInstalled && !b.isInstalled) return -1
    if (!a.isInstalled && b.isInstalled) return 1
    
    // Then by popularity order
    const aIndex = popularOrder.indexOf(a.name)
    const bIndex = popularOrder.indexOf(b.name)
    return aIndex - bIndex
  })
}

// Fallback wallet list for SSR
const getDefaultWalletList = (): WalletProvider[] => {
  const defaultWallets = [
    { name: 'MetaMask', icon: '🦊' },
    { name: 'Coinbase Wallet', icon: '🔵' },
    { name: 'Trust Wallet', icon: '🛡️' },
    { name: 'Zerion', icon: '⚡' },
    { name: 'Rainbow', icon: '🌈' },
    { name: 'Phantom', icon: '👻' },
    { name: 'WalletConnect', icon: '🔗' },
    { name: 'Rabby', icon: '🐰' },
  ]
  
  return defaultWallets.map(wallet => ({
    name: wallet.name,
    icon: wallet.icon,
    isInstalled: false,
    connect: () => Promise.reject(new Error(`${wallet.name} not available in SSR`)),
    disconnect: () => Promise.resolve(),
  }))
}

// Enhanced MetaMask connection with improved provider handling
export const connectMetaMask = async (): Promise<WalletData> => {
  if (typeof window === 'undefined') {
    throw new Error('Window object not available')
  }
  
  const win = window as any
  let provider = null
  
  // Find MetaMask provider using enhanced detection
  if (win.ethereum?.isMetaMask) {
    provider = win.ethereum
  } else if (win.ethereum?.providers) {
    // Find MetaMask in providers array
    provider = win.ethereum.providers.find((p: any) => p.isMetaMask)
  } else if (win.MetaMask || win.metamask) {
    provider = win.MetaMask || win.metamask
  }
  
  if (!provider) {
    throw new Error('MetaMask not installed or not detected')
  }
  
  try {
    // Use the specific MetaMask provider
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found or user rejected the request')
    }
    
    const address = accounts[0]
    
    // Validate the address format
    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      throw new Error('Invalid address format received from MetaMask')
    }
    
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    // Provide more specific error messages
    if (error.code === 4001) {
      throw new Error('User rejected the connection request')
    } else if (error.code === -32002) {
      throw new Error('MetaMask is already processing a request. Please check MetaMask.')
    } else if (error.message?.includes('User rejected')) {
      throw new Error('User rejected the connection request')
    } else {
      throw new Error(`Failed to connect to MetaMask: ${error.message || 'Unknown error'}`)
    }
  }
}

// Connect to Coinbase Wallet
export const connectCoinbase = async (): Promise<WalletData> => {
  if (!window.ethereum?.isCoinbaseWallet) {
    throw new Error('Coinbase Wallet not installed')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Coinbase Wallet: ${error.message}`)
  }
}

// Connect to Trust Wallet
export const connectTrustWallet = async (): Promise<WalletData> => {
  const provider = window.trustWallet || window.ethereum
  
  if (!provider) {
    throw new Error('Trust Wallet not installed')
  }
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Trust Wallet: ${error.message}`)
  }
}

// Connect to Zerion
export const connectZerion = async (): Promise<WalletData> => {
  const provider = window.zerion || window.ethereum
  
  if (!provider) {
    throw new Error('Zerion not installed')
  }
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Zerion: ${error.message}`)
  }
}

// Connect to Rabby
export const connectRabby = async (): Promise<WalletData> => {
  const provider = window.rabby || window.ethereum
  
  if (!provider) {
    throw new Error('Rabby not installed')
  }
  
  try {
    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  if (!window.ethereum || !(window.ethereum as any).isRainbow) {
    throw new Error('Rainbow not installed')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  const phantom = (window as any).phantom?.ethereum
  
  if (!phantom) {
    throw new Error('Phantom not installed')
  }
  
  try {
    const accounts = await phantom.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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

// Connect to Brave Wallet
export const connectBrave = async (): Promise<WalletData> => {
  if (!window.ethereum?.isBraveWallet) {
    throw new Error('Brave Wallet not installed')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
    return {
      address,
      balance,
      isConnected: true,
      isConnecting: false,
      chainId,
      avatar: generateAvatar(address),
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to Brave Wallet: ${error.message}`)
  }
}

// Connect to Frame
export const connectFrame = async (): Promise<WalletData> => {
  if (!window.ethereum?.isFrame) {
    throw new Error('Frame not installed')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  const talisman = (window as any).talisman
  
  if (!talisman) {
    throw new Error('Talisman not installed')
  }
  
  try {
    const accounts = await talisman.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  const subwallet = (window as any).SubWallet
  
  if (!subwallet) {
    throw new Error('SubWallet not installed')
  }
  
  try {
    const accounts = await subwallet.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  const okx = (window as any).okxwallet || window.ethereum
  
  if (!okx || !(window.ethereum as any)?.isOKExWallet) {
    throw new Error('OKX Wallet not installed')
  }
  
  try {
    const accounts = await okx.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  const binance = (window as any).BinanceChain
  
  if (!binance) {
    throw new Error('Binance Wallet not installed')
  }
  
  try {
    const accounts = await binance.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  try {
    // This is a simplified implementation
    // In a real app, you'd use the WalletConnect SDK
    alert('WalletConnect integration would require installing @walletconnect/web3-provider package. For now, please use a browser extension wallet.')
    throw new Error('WalletConnect integration not implemented yet')
  } catch (error: any) {
    throw new Error(`WalletConnect connection failed: ${error.message}`)
  }
}

// Connect to generic Web3 provider
export const connectGeneric = async (): Promise<WalletData> => {
  if (!window.ethereum) {
    throw new Error('No Web3 provider found')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    const address = accounts[0]
    const balance = await getBalance(address)
    const chainId = await getChainId()
    
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
  // Clear any stored wallet data
  if (typeof window !== 'undefined') {
    localStorage.removeItem('walletAddress')
    localStorage.removeItem('walletProvider')
  }
}

// Get account balance (mock implementation - replace with actual Web3 calls)
export const getBalance = async (address: string): Promise<string> => {
  if (!window.ethereum) {
    console.warn('No ethereum provider available; using read-only RPC fallback')
    return fetchBalanceViaRpc(address)
  }
  
  if (!address || typeof address !== 'string') {
    console.error('Invalid address provided to getBalance:', address)
    return '0'
  }
  
  try {
     console.log('Fetching balance for address:', address)
    
    // Check if the provider supports eth_getBalance
    if (typeof window.ethereum.request !== 'function') {
      console.error('Provider does not support request method; using fallback')
      return fetchBalanceViaRpc(address)
    }
    
    // Get ETH balance
    const balance = await window.ethereum.request({
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
      providerAvailable: !!window.ethereum,
      requestMethodAvailable: typeof window.ethereum?.request === 'function'
    })
    
    // Provide more specific error messages
    if (error?.code === 4001) {
      console.error('User rejected the balance request')
    } else if (error?.code === -32603) {
      console.error('Internal RPC error - possibly network issue; retrying via fallback RPC')
      return fetchBalanceViaRpc(address)
    } else if (error?.code === -32602) {
      console.error('Invalid method parameters')
    } else if (error?.message?.includes('network')) {
      console.error('Network connectivity issue; using fallback RPC')
      return fetchBalanceViaRpc(address)
    } else if (error?.message?.includes('timeout')) {
      console.error('Request timeout; using fallback RPC')
      return fetchBalanceViaRpc(address)
    }
    
    return fetchBalanceViaRpc(address)
  }
}

// Get current chain ID
export const getChainId = async (): Promise<number> => {
  if (!window.ethereum) {
    console.warn('No ethereum provider available for chain ID')
    return 1 // Default to Ethereum mainnet
  }
  
  try {
     console.log('Fetching chain ID...')
    
    if (typeof window.ethereum.request !== 'function') {
      console.error('Provider does not support request method for chain ID')
      return 1
    }
    
    const chainId = await window.ethereum.request({
      method: 'eth_chainId',
    })
    
     console.log('Raw chain ID response:', chainId)
    
    if (!chainId) {
      console.warn('No chain ID returned from provider')
      return 1
    }
    
    const parsedChainId = parseInt(chainId, 16)
    
    if (isNaN(parsedChainId) || parsedChainId <= 0) {
      console.error('Invalid chain ID:', chainId, 'parsed as:', parsedChainId)
      return 1
    }
    
     console.log('Chain ID:', parsedChainId)
    return parsedChainId
    
  } catch (error: any) {
    console.error('Error fetching chain ID:', {
      error,
      errorMessage: error?.message,
      errorCode: error?.code,
      providerAvailable: !!window.ethereum,
      requestMethodAvailable: typeof window.ethereum?.request === 'function'
    })
    
    // Provide specific error messages
    if (error?.code === 4001) {
      console.error('User rejected the chain ID request')
    } else if (error?.code === -32603) {
      console.error('Internal RPC error when fetching chain ID')
    } else if (error?.message?.includes('network')) {
      console.error('Network issue when fetching chain ID')
    }
    
    return 1
  }
}

// Check if wallet is already connected
export const checkConnection = async (): Promise<WalletData | null> => {
  if (!window.ethereum) {
     console.log('No ethereum provider available for connection check')
    return null
  }
  
  try {
     console.log('Checking wallet connection...')
    
    if (typeof window.ethereum.request !== 'function') {
      console.error('Provider does not support request method for connection check')
      return null
    }
    
    const accounts = await window.ethereum.request({
      method: 'eth_accounts',
    })
    
     console.log('Accounts found:', accounts?.length || 0)
    
    if (!accounts || accounts.length === 0) {
       console.log('No connected accounts found')
      return null
    }
    
    const address = accounts[0]
     console.log('Connected account:', address)
    
    // Get balance and chain ID with error handling
    let balance = '0'
    let chainId = 1
    
    try {
      balance = await getBalance(address)
    } catch (balanceError) {
      console.warn('Failed to get balance during connection check:', balanceError)
    }
    
    try {
      chainId = await getChainId()
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
    
  } catch (error: any) {
    console.error('Error checking connection:', {
      error,
      errorMessage: error?.message,
      errorCode: error?.code,
      providerAvailable: !!window.ethereum,
      requestMethodAvailable: typeof window.ethereum?.request === 'function'
    })
    
    // Don't throw, just return null to indicate no connection
    return null
  }
}

// Listen for account changes
export const onAccountsChanged = (callback: (accounts: string[]) => void) => {
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', callback)
  }
}

// Listen for chain changes
export const onChainChanged = (callback: (chainId: string) => void) => {
  if (window.ethereum) {
    window.ethereum.on('chainChanged', callback)
  }
}

// Remove event listeners
export const removeListeners = () => {
  if (window.ethereum) {
    window.ethereum.removeListener('accountsChanged', () => {})
    window.ethereum.removeListener('chainChanged', () => {})
  }
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
export const switchNetwork = async (network: NetworkConfig): Promise<boolean> => {
  if (!window.ethereum) {
    throw new Error('No ethereum provider found')
  }

  const chainIdHex = formatChainIdForMetaMask(network.chainId)
  
  try {
     console.log(`🔀 Switching to ${network.displayName} (Chain ID: ${network.chainId})`)
    
    // Try to switch to the network
    await window.ethereum.request({
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
        await window.ethereum.request({
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