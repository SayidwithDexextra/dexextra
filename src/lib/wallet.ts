import { WalletData, WalletProvider } from '@/types/wallet'

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

// Enhanced wallet detection utilities
const isWalletInstalled = (walletName: string): boolean => {
  if (typeof window === 'undefined') return false
  
  const win = window as any
  
  switch (walletName) {
    case 'MetaMask':
      return !!(win.ethereum?.isMetaMask)
    
    case 'Coinbase Wallet':
      return !!(win.ethereum?.isCoinbaseWallet || win.ethereum?.selectedProvider?.isCoinbaseWallet)
    
    case 'Trust Wallet':
      return !!(win.trustWallet || win.ethereum?.isTrust || win.ethereum?.isTrustWallet)
    
    case 'Zerion':
      return !!(win.zerion || win.ethereum?.isZerion)
    
    case 'Rabby':
      return !!(win.rabby || win.ethereum?.isRabby)
    
    case 'Rainbow':
      return !!(win.ethereum?.isRainbow)
    
    case 'Phantom':
      return !!(win.phantom?.ethereum || win.solana?.isPhantom)
    
    case 'Brave Wallet':
      return !!(win.ethereum?.isBraveWallet)
    
    case 'Frame':
      return !!(win.ethereum?.isFrame)
    
    case 'Talisman':
      return !!(win.talisman)
    
    case 'SubWallet':
      return !!(win.SubWallet)
    
    case 'OKX Wallet':
      return !!(win.okxwallet || win.ethereum?.isOKExWallet)
    
    case 'Binance Wallet':
      return !!(win.BinanceChain)
    
    default:
      return false
  }
}



// Debug function to help with wallet detection issues
export const debugWalletDetection = (): void => {
  if (typeof window === 'undefined') {
    console.log('🔍 Wallet Detection Debug: Running in SSR environment')
    return
  }
  
  const win = window as any
  console.log('🔍 Wallet Detection Debug:')
  console.log('ethereum object:', !!win.ethereum)
  
  if (win.ethereum) {
    console.log('ethereum.isMetaMask:', win.ethereum.isMetaMask)
    console.log('ethereum.isCoinbaseWallet:', win.ethereum.isCoinbaseWallet)
    console.log('ethereum.isBraveWallet:', win.ethereum.isBraveWallet)
    console.log('ethereum.isRainbow:', win.ethereum.isRainbow)
    console.log('ethereum.isFrame:', win.ethereum.isFrame)
    console.log('ethereum.isTrust:', win.ethereum.isTrust)
    console.log('ethereum.isTrustWallet:', win.ethereum.isTrustWallet)
    console.log('ethereum.isZerion:', win.ethereum.isZerion)
    console.log('ethereum.isRabby:', win.ethereum.isRabby)
    console.log('ethereum.isOKExWallet:', win.ethereum.isOKExWallet)
    console.log('ethereum.providers:', win.ethereum.providers)
  }
  
  console.log('trustWallet:', !!win.trustWallet)
  console.log('zerion:', !!win.zerion)
  console.log('rabby:', !!win.rabby)
  console.log('phantom:', !!win.phantom)
  console.log('phantom.ethereum:', !!win.phantom?.ethereum)
  console.log('phantom.solana:', !!win.phantom?.solana)
  console.log('talisman:', !!win.talisman)
  console.log('SubWallet:', !!win.SubWallet)
  console.log('okxwallet:', !!win.okxwallet)
  console.log('BinanceChain:', !!win.BinanceChain)
  console.log('solana:', !!win.solana)
  
  // Log all window properties that might be wallet-related
  const walletProps = Object.keys(win).filter(key => 
    key.toLowerCase().includes('wallet') || 
    key.toLowerCase().includes('ethereum') ||
    key.toLowerCase().includes('web3') ||
    key.toLowerCase().includes('metamask') ||
    key.toLowerCase().includes('coinbase') ||
    key.toLowerCase().includes('trust') ||
    key.toLowerCase().includes('phantom') ||
    key.toLowerCase().includes('brave')
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

// Connect to MetaMask
export const connectMetaMask = async (): Promise<WalletData> => {
  if (!window.ethereum?.isMetaMask) {
    throw new Error('MetaMask not installed')
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    })
    
    if (accounts.length === 0) {
      throw new Error('No accounts found')
    }
    
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
    throw new Error(`Failed to connect to MetaMask: ${error.message}`)
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
    return '0'
  }
  
  try {
    // Get ETH balance
    const balance = await window.ethereum.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })
    
    // Convert from wei to ETH
    const ethBalance = parseInt(balance, 16) / Math.pow(10, 18)
    
    // Mock price conversion (replace with real price API)
    const ethPrice = 2000 // Mock ETH price
    const usdValue = ethBalance * ethPrice
    
    return usdValue.toString()
  } catch (error) {
    console.error('Error fetching balance:', error)
    return '0'
  }
}

// Get current chain ID
export const getChainId = async (): Promise<number> => {
  if (!window.ethereum) {
    return 1 // Default to Ethereum mainnet
  }
  
  try {
    const chainId = await window.ethereum.request({
      method: 'eth_chainId',
    })
    return parseInt(chainId, 16)
  } catch (error) {
    console.error('Error fetching chain ID:', error)
    return 1
  }
}

// Check if wallet is already connected
export const checkConnection = async (): Promise<WalletData | null> => {
  if (!window.ethereum) {
    return null
  }
  
  try {
    const accounts = await window.ethereum.request({
      method: 'eth_accounts',
    })
    
    if (accounts.length === 0) {
      return null
    }
    
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
  } catch (error) {
    console.error('Error checking connection:', error)
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