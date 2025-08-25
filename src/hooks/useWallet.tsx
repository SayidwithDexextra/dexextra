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
  diagnoseWalletIssues,
} from '@/lib/wallet'
import { fetchWalletPortfolio } from '@/lib/tokenService'
import { ProfileApi } from '@/lib/profileApi'

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
  userProfile: null,
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
    if (!address) {
      console.warn('No address available for balance refresh')
      return
    }

    try {
       console.log('Refreshing balance for:', address)
      const balance = await getBalance(address)
      setWalletData(prev => ({ ...prev, balance }))
       console.log('Balance refreshed successfully:', balance)
    } catch (error) {
      console.error('Error refreshing balance:', error)
      
      // REMOVED: Heavy diagnostics that cause delays
      // await diagnoseWalletIssues()
      
      // Set balance to '0' on error to prevent UI issues
      setWalletData(prev => ({ ...prev, balance: '0' }))
    }
  }, []) // No dependencies to avoid infinite loops

  // Create or get user profile for connected wallet
  const createOrGetUserProfile = useCallback(async (walletAddress: string): Promise<void> => {
    try {
       console.log('Creating/getting user profile for:', walletAddress)
      const userProfile = await ProfileApi.createOrGetProfile(walletAddress)
      
      setWalletData(prev => ({ 
        ...prev, 
        userProfile 
      }))
      
       console.log('User profile created/retrieved:', userProfile)
    } catch (error) {
      console.error('Error creating/getting user profile:', error)
      // Don't throw error - profile creation failure shouldn't prevent wallet connection
      // User can create profile later through the settings page
    }
  }, [])

  // Refresh user profile data
  const refreshProfile = useCallback(async (): Promise<void> => {
    const address = currentAddressRef.current
    if (!address) return

    try {
      const userProfile = await ProfileApi.getProfile(address)
      setWalletData(prev => ({ 
        ...prev, 
        userProfile 
      }))
    } catch (error) {
      console.error('Error refreshing user profile:', error)
    }
  }, [])

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
          
          // If wallet is already connected, also load the user profile
          if (existingConnection.address) {
            await createOrGetUserProfile(existingConnection.address)
          }
        }
      } catch (error) {
        console.error('Error initializing wallet:', error)
      }
    }

    // Only run on client side
    if (typeof window !== 'undefined') {
      // Initial detection
      initializeWallet()
      
      // Enhanced wallet detection with multiple retry attempts
      const detectionTimeouts = [
        // Quick retry for immediate wallet injection
        setTimeout(() => {
          const updatedProviders = detectWalletProviders()
          setProviders(updatedProviders)
        }, 500),
        
        // Standard retry for normal wallet injection
        setTimeout(() => {
          const updatedProviders = detectWalletProviders()
          setProviders(updatedProviders)
        }, 1000),
        
        // Extended retry for slow wallet injection
        setTimeout(() => {
          const updatedProviders = detectWalletProviders()
          setProviders(updatedProviders)
        }, 2000),
        
        // Final retry for very slow wallet injection
        setTimeout(() => {
          const updatedProviders = detectWalletProviders()
          setProviders(updatedProviders)
        }, 5000)
      ]
      
      // Re-detect on window focus (user might have installed a wallet)
      const handleFocus = () => {
        const updatedProviders = detectWalletProviders()
        setProviders(updatedProviders)
      }
      
      // Re-detect on ethereum events (wallet becomes available)
      const handleEthereumConnect = () => {
        const updatedProviders = detectWalletProviders()
        setProviders(updatedProviders)
      }
      
      window.addEventListener('focus', handleFocus)
      
      // Listen for ethereum events
      if (window.ethereum) {
        window.ethereum.on?.('connect', handleEthereumConnect)
        window.ethereum.on?.('chainChanged', handleEthereumConnect)
      }
      
      // Also listen for the ethereum object becoming available
      const handleEthereumAvailable = () => {
        const updatedProviders = detectWalletProviders()
        setProviders(updatedProviders)
      }
      
      window.addEventListener('ethereum#initialized', handleEthereumAvailable)
      
      return () => {
        detectionTimeouts.forEach(timeout => clearTimeout(timeout))
        window.removeEventListener('focus', handleFocus)
        window.removeEventListener('ethereum#initialized', handleEthereumAvailable)
        
        if (window.ethereum) {
          window.ethereum.removeListener?.('connect', handleEthereumConnect)
          window.ethereum.removeListener?.('chainChanged', handleEthereumConnect)
        }
      }
    }
  }, [])

  // Set up event listeners for wallet changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleAccountsChanged = async (accounts: string[]) => {
      if (accounts.length === 0) {
        // Wallet disconnected
         console.log('Wallet disconnected - accounts changed to empty')
        setWalletData(initialWalletData)
      } else {
        // Account changed
        const address = accounts[0]
         console.log('Account changed to:', address)
        
        let balance = '0'
        try {
          balance = await getBalance(address)
        } catch (error) {
          console.error('Error getting balance for new account:', error)
          // Continue with balance as '0' rather than failing completely
        }
        
        setWalletData(prev => ({
          ...prev,
          address,
          balance,
          avatar: generateAvatar(address),
        }))
        
        // Load user profile for the new account
        try {
          await createOrGetUserProfile(address)
        } catch (error) {
          console.error('Error loading user profile for new account:', error)
          // Profile loading failure shouldn't prevent account switching
        }
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
       console.log('Attempting to connect wallet:', providerName || 'auto-detect')
      
      let targetProvider: WalletProvider | undefined
      
      if (providerName) {
        targetProvider = providers.find(p => p.name === providerName)
        if (!targetProvider) {
          console.error('Requested provider not found:', providerName)
           console.log('Available providers:', providers.map(p => p.name))
        }
      } else {
        // Use first available provider
        targetProvider = providers.find(p => p.isInstalled)
         console.log('Auto-selected provider:', targetProvider?.name)
      }

      if (!targetProvider) {
        console.error('No wallet provider available')
         console.log('Available providers:', providers.length)
         console.log('Installed providers:', providers.filter(p => p.isInstalled).map(p => p.name))
        
        // REMOVED: Heavy diagnostics that cause connection delays
        // await diagnoseWalletIssues()
        throw new Error('No wallet provider available')
      }

      if (!targetProvider.isInstalled) {
        console.error(`${targetProvider.name} is not installed`)
        throw new Error(`${targetProvider.name} is not installed`)
      }

       console.log('Connecting to:', targetProvider.name)
      await targetProvider.connect()
      
      // Re-check connection to get updated data
       console.log('Verifying connection...')
      const connection = await checkConnection()
      if (connection) {
        setWalletData(connection)
        
        // Store connection preference
        localStorage.setItem('walletProvider', targetProvider.name)
        
        // OPTIMIZED: Create user profile in background - don't block connection
        if (connection.address) {
          createOrGetUserProfile(connection.address).catch(error => 
            console.warn('User profile creation failed (non-blocking):', error)
          )
        }
        
         console.log('Wallet connected successfully:', connection.address)
      } else {
        console.error('Connection verification failed')
        throw new Error('Connection verification failed')
      }
    } catch (error: unknown) {
      console.error('Connection error:', error)
      
      // REMOVED: Heavy diagnostics that cause connection delays  
      // await diagnoseWalletIssues()
      
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
    refreshProfile,
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