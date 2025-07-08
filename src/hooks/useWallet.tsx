'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { WalletData, WalletContextType, WalletPortfolio, type WalletProvider } from '@/types/wallet'
import {
  detectWalletProviders,
  checkConnection,
  formatAddress,
  formatBalance,
  onAccountsChanged,
  onChainChanged,
  removeListeners,
  getBalance,
  generateAvatar,
} from '@/lib/wallet'
import { fetchWalletPortfolio } from '@/lib/tokenService'

const WalletContext = createContext<WalletContextType | undefined>(undefined)

interface WalletProviderProps {
  children: ReactNode
}

const initialWalletData: WalletData = {
  address: null,
  balance: null,
  isConnected: false,
  isConnecting: false,
  chainId: null,
  ensName: null,
  avatar: null,
}

const initialPortfolio: WalletPortfolio = {
  totalValue: '0',
  totalValueFormatted: '$0.00',
  ethBalance: '0',
  ethBalanceFormatted: '0',
  ethValue: '0',
  ethValueFormatted: '$0.00',
  tokens: [],
  nfts: [],
  isLoading: false,
  lastUpdated: null,
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [walletData, setWalletData] = useState<WalletData>(initialWalletData)
  const [portfolio, setPortfolio] = useState<WalletPortfolio>(initialPortfolio)
  const [providers, setProviders] = useState<WalletProvider[]>([])
  
  // Use refs to store current wallet state to avoid circular dependencies
  const currentAddressRef = useRef<string | null>(null)
  const isConnectedRef = useRef<boolean>(false)
  
  // Update refs whenever wallet state changes
  useEffect(() => {
    currentAddressRef.current = walletData.address
    isConnectedRef.current = walletData.isConnected
  }, [walletData.address, walletData.isConnected])

  // Define a stable refreshBalance function that doesn't depend on walletData.address
  const refreshBalance = useCallback(async (): Promise<void> => {
    const address = currentAddressRef.current
    if (!address) return

    try {
      const balance = await getBalance(address)
      setWalletData(prev => ({ ...prev, balance }))
    } catch (error) {
      console.error('Error refreshing balance:', error)
    }
  }, []) // No dependencies to avoid infinite loops

  // Initialize wallet providers and check for existing connection
  useEffect(() => {
    const initializeWallet = async () => {
      try {
        // Detect available wallet providers
        const detectedProviders = detectWalletProviders()
        setProviders(detectedProviders)

        // Check for existing connection
        const existingConnection = await checkConnection()
        if (existingConnection) {
          setWalletData(existingConnection)
        }
      } catch (error) {
        console.error('Error initializing wallet:', error)
      }
    }

    // Only run on client side
    if (typeof window !== 'undefined') {
      // Initial detection
      initializeWallet()
      
      // Re-detect wallets after a short delay (some wallets inject themselves after page load)
      const delayedDetection = setTimeout(() => {
        const updatedProviders = detectWalletProviders()
        setProviders(updatedProviders)
      }, 1000)
      
      // Re-detect on window focus (user might have installed a wallet)
      const handleFocus = () => {
        const updatedProviders = detectWalletProviders()
        setProviders(updatedProviders)
      }
      
      window.addEventListener('focus', handleFocus)
      
      return () => {
        clearTimeout(delayedDetection)
        window.removeEventListener('focus', handleFocus)
      }
    }
  }, [])

  // Set up event listeners for wallet changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleAccountsChanged = async (accounts: string[]) => {
      if (accounts.length === 0) {
        // Wallet disconnected
        setWalletData(initialWalletData)
      } else {
        // Account changed
        const address = accounts[0]
        const balance = await getBalance(address)
        setWalletData(prev => ({
          ...prev,
          address,
          balance,
          avatar: generateAvatar(address),
        }))
      }
    }

    const handleChainChanged = (chainId: string) => {
      setWalletData(prev => ({
        ...prev,
        chainId: parseInt(chainId, 16),
      }))
      // Refresh balance when chain changes
      if (currentAddressRef.current) {
        refreshBalance()
      }
    }

    onAccountsChanged(handleAccountsChanged)
    onChainChanged(handleChainChanged)

    return () => {
      removeListeners()
    }
  }, [refreshBalance]) // refreshBalance is now stable, so this won't cause infinite loops

  const connect = async (providerName?: string): Promise<void> => {
    setWalletData(prev => ({ ...prev, isConnecting: true }))

    try {
      let targetProvider: WalletProvider | undefined
      
      if (providerName) {
        targetProvider = providers.find(p => p.name === providerName)
      } else {
        // Use first available provider
        targetProvider = providers.find(p => p.isInstalled)
      }

      if (!targetProvider) {
        throw new Error('No wallet provider available')
      }

      if (!targetProvider.isInstalled) {
        throw new Error(`${targetProvider.name} is not installed`)
      }

      await targetProvider.connect()
      
      // Re-check connection to get updated data
      const connection = await checkConnection()
      if (connection) {
        setWalletData(connection)
        
        // Store connection preference
        localStorage.setItem('walletProvider', targetProvider.name)
      }
    } catch (error: unknown) {
      console.error('Connection error:', error)
      setWalletData(prev => ({ ...prev, isConnecting: false }))
      throw error
    }
  }

  const disconnect = async (): Promise<void> => {
    try {
      // Clear local storage
      localStorage.removeItem('walletProvider')
      localStorage.removeItem('walletAddress')
      
      // Reset wallet state
      setWalletData(initialWalletData)
    } catch (error) {
      console.error('Disconnect error:', error)
    }
  }



  const refreshPortfolio = useCallback(async (): Promise<void> => {
    const address = currentAddressRef.current
    const isConnected = isConnectedRef.current
    
    if (!address || !isConnected) return

    try {
      setPortfolio(prev => ({ ...prev, isLoading: true }))
      
      // Get the ethereum provider
      const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
      if (!ethereum) {
        throw new Error('No ethereum provider found')
      }

      const portfolioData = await fetchWalletPortfolio(ethereum, address)
      setPortfolio(portfolioData)
    } catch (error) {
      console.error('Error refreshing portfolio:', error)
      setPortfolio(prev => ({ ...prev, isLoading: false }))
    }
  }, []) // No dependencies to avoid infinite loops

  const contextValue: WalletContextType = {
    walletData,
    portfolio,
    providers,
    connect,
    disconnect,
    refreshBalance,
    refreshPortfolio,
    formatAddress,
    formatBalance,
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

// Export default hook for convenience
export default useWallet 