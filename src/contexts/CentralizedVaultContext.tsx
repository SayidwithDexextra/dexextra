'use client'

import React, { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react'
import { 
  createPublicClient, 
  createWalletClient, 
  custom, 
  http, 
  formatUnits, 
  parseUnits,
  getContract,
  type WalletClient
} from 'viem'
import { polygon } from 'viem/chains'
import { getContractAddress } from '@/lib/contracts'

// Helper to safely access window.ethereum
const getEthereum = () => {
  try {
    return (globalThis as any)?.window?.ethereum || null
  } catch {
    return null
  }
}

// Viem-compatible ABI for the functions we need
const VAULT_ABI = [
  {
    name: 'getPortfolioSummary',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'availableMargin', type: 'uint256' },
      { name: 'unrealizedPnL', type: 'int256' },
      { name: 'marginRatio', type: 'uint256' },
      { name: 'activeVAMMs', type: 'uint256' }
    ]
  },
  {
    name: 'getAvailableMargin',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'depositCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'withdrawCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  }
] as const

// Simplified vault data structure
export interface CentralizedVaultData {
  portfolioValue: string
  availableCash: string
  unrealizedPnL: string
  isLoading: boolean
  error: string | null
}

interface CentralizedVaultContextType {
  vaultData: CentralizedVaultData
  refresh: () => Promise<void>
  depositCollateral: (amount: string) => Promise<void>
  withdrawCollateral: (amount: string) => Promise<void>
  
  // Convenience getters
  portfolioValue: string
  availableCash: string
  unrealizedPnL: string
  isLoading: boolean
  isConnected: boolean
}

const DEFAULT_NETWORK = 'polygon'
const POLYGON_RPC_URL = process.env.NEXT_PUBLIC_POLYGON_RPC_URL || 'https://polygon-rpc.com'

// Create viem public client for reading contract data
const publicClient = createPublicClient({
  chain: polygon,
  transport: http(POLYGON_RPC_URL),
})

const initialVaultData: CentralizedVaultData = {
  portfolioValue: '0',
  availableCash: '0', 
  unrealizedPnL: '0',
  isLoading: true, // Start with loading animation
  error: null,
}

const CentralizedVaultContext = createContext<CentralizedVaultContextType | null>(null)

export function CentralizedVaultProvider({ children }: { children: React.ReactNode }) {
  const [vaultData, setVaultData] = useState<CentralizedVaultData>(initialVaultData)
  const [currentUserAddress, setCurrentUserAddress] = useState<string | null>(null)
  
  // Use ref to avoid dependency cycles
  const userAddressRef = useRef<string | null>(null)

  // Get vault contract address (stable)
  const vaultAddress = getContractAddress(DEFAULT_NETWORK, 'DEXV2_VAULT')

  // Format USDC values (6 decimals) using viem
  const formatUSDCValue = (value: bigint): string => {
    return formatUnits(value, 6)
  }

  // Cache wallet client and contract instances to avoid recreation
  const walletClientRef = useRef<WalletClient | null>(null)
  const vaultContractRef = useRef<any>(null)
  const isInitializingRef = useRef(false)
  
  // Initialize clients once and cache them
  const initializeClients = useCallback(async () => {
    if (isInitializingRef.current || (walletClientRef.current && vaultContractRef.current)) {
      return // Already initialized or currently initializing
    }
    
    isInitializingRef.current = true
    
    try {
      const ethereum = getEthereum()
      if (!ethereum) {
        throw new Error('No wallet connected')
      }

      console.log('🔧 Initializing cached wallet client and contract...')
      
      const walletClient = createWalletClient({
        chain: polygon,
        transport: custom(ethereum),
      })

      const contract = getContract({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        client: { public: publicClient, wallet: walletClient },
      })

      walletClientRef.current = walletClient
      vaultContractRef.current = contract
      
      console.log('✅ Wallet client and contract cached successfully')
    } catch (error) {
      console.error('❌ Failed to initialize clients:', error)
      throw error
    } finally {
      isInitializingRef.current = false
    }
  }, [vaultAddress])

  // Clear cached clients when vault address changes
  useEffect(() => {
    walletClientRef.current = null
    vaultContractRef.current = null
  }, [vaultAddress])

  // FIXED: Simple data fetch function with ONLY stable dependencies
  const fetchVaultData = useCallback(async () => {
    if (!currentUserAddress) {
      // When user is not connected, immediately resolve to zero values instead of staying in loading state
      setVaultData({
        portfolioValue: '0',
        availableCash: '0',
        unrealizedPnL: '0',
        isLoading: false,
        error: null,
      })
      return
    }

    console.log('📊 Fetching vault data with viem for:', currentUserAddress)
    setVaultData(prev => ({ ...prev, error: null }))

    try {
      // Create contract inline to avoid dependency issues
      if (!vaultAddress || vaultAddress.includes('_your_') || vaultAddress.includes('_testnet_') || vaultAddress.includes('_local_')) {
        throw new Error('Invalid vault address')
      }

      const contract = getContract({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        client: { public: publicClient, wallet: walletClientRef.current! },
      })

      console.log('🔍 Contract created:', !!contract)

      // Simple parallel calls using viem
      const [portfolioSummary, availableMargin] = await Promise.all([
        contract.read.getPortfolioSummary([currentUserAddress as `0x${string}`]),
        contract.read.getAvailableMargin([currentUserAddress as `0x${string}`])
      ])

      console.log('💰 Raw viem responses:', {
        portfolioSummary,
        availableMargin: availableMargin?.toString()
      })

      // Extract and format the values
      const portfolioValue = formatUSDCValue(portfolioSummary[0] || 0n)
      const availableCash = formatUSDCValue(availableMargin || 0n)
      const unrealizedPnL = formatUSDCValue(portfolioSummary[2] || 0n)

      console.log('✅ Animation complete! Real values:', {
        portfolioValue,
        availableCash,
        unrealizedPnL
      })

      // Stop animation and show real values
      setVaultData({
        portfolioValue,
        availableCash,
        unrealizedPnL,
        isLoading: false, // ✅ Animation stops here
        error: null,
      })

    } catch (error: any) {
      console.error('❌ Error fetching vault data:', error)
      setVaultData(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Failed to fetch vault data',
      }))
    }
  }, [currentUserAddress, vaultAddress]) // ✅ STABLE dependencies only

  // Manual refresh function - FIXED dependency
  const refresh = useCallback(async () => {
    await fetchVaultData()
  }, [fetchVaultData]) // ✅ Now fetchVaultData is stable

  // Transaction functions - optimized with caching
  const depositCollateral = useCallback(async (amount: string): Promise<void> => {
    try {
      // Ensure clients are initialized
      if (!walletClientRef.current || !vaultContractRef.current) {
        await initializeClients()
      }

      const walletClient = walletClientRef.current!
      const contract = vaultContractRef.current!

      console.log('🏦 Starting optimized deposit:', amount)
      
      const amountWei = parseUnits(amount, 6)
      const [account] = await walletClient.getAddresses()

      const hash = await contract.write.depositCollateral([amountWei], { account })
      await publicClient.waitForTransactionReceipt({ hash })
      
      console.log('✅ Deposit completed with cached clients')
      
      // Refresh after transaction
      setTimeout(() => fetchVaultData(), 1000)
    } catch (error) {
      console.error('Deposit error:', error)
      
      // Clear cache on error in case clients became stale
      walletClientRef.current = null
      vaultContractRef.current = null
      
      throw error
    }
  }, [initializeClients, fetchVaultData])

  const withdrawCollateral = useCallback(async (amount: string): Promise<void> => {
    try {
      // Ensure clients are initialized
      if (!walletClientRef.current || !vaultContractRef.current) {
        await initializeClients()
      }

      const walletClient = walletClientRef.current!
      const contract = vaultContractRef.current!

      console.log('🏦 Starting optimized withdrawal:', amount)
      
      const amountWei = parseUnits(amount, 6)
      const [account] = await walletClient.getAddresses()

      const hash = await contract.write.withdrawCollateral([amountWei], { account })
      await publicClient.waitForTransactionReceipt({ hash })
      
      console.log('✅ Withdrawal completed with cached clients')
      
      // Refresh after transaction
      setTimeout(() => fetchVaultData(), 1000)
    } catch (error) {
      console.error('Withdrawal error:', error)
      
      // Clear cache on error in case clients became stale
      walletClientRef.current = null
      vaultContractRef.current = null
      
      throw error
    }
  }, [initializeClients, fetchVaultData])

  // FIXED: Load data when user address changes - STABLE dependency
  useEffect(() => {
    fetchVaultData()
  }, [fetchVaultData]) // ✅ Now fetchVaultData is stable, no infinite loop

  // FIXED: Update user address function - NO dependencies to prevent infinite loop
  const updateUserAddress = useCallback((address: string | null) => {
    // Use ref for comparison to avoid dependency on currentUserAddress
    if (address !== userAddressRef.current) {
      console.log('🔄 Updating user address:', userAddressRef.current, '->', address)
      userAddressRef.current = address
      setCurrentUserAddress(address)
      
      // Start animation when user changes
      if (address) {
        setVaultData(prev => ({ ...prev, isLoading: true }))
      }
    }
  }, []) // ✅ No dependencies = stable function, no infinite loop

  const contextValue: CentralizedVaultContextType = {
    vaultData,
    refresh,
    depositCollateral,
    withdrawCollateral,
    
    // Convenience getters
    portfolioValue: vaultData.portfolioValue,
    availableCash: vaultData.availableCash,
    unrealizedPnL: vaultData.unrealizedPnL,
    isLoading: vaultData.isLoading,
    isConnected: !!currentUserAddress && !vaultData.error,
  }

  // Expose updateUserAddress for the hook
  ;(contextValue as any).updateUserAddress = updateUserAddress

  return (
    <CentralizedVaultContext.Provider value={contextValue}>
      {children}
    </CentralizedVaultContext.Provider>
  )
}

export function useCentralizedVault(userAddress?: string | null) {
  const context = useContext(CentralizedVaultContext)
  if (!context) {
    throw new Error('useCentralizedVault must be used within a CentralizedVaultProvider')
  }

  // Update user address when it changes
  useEffect(() => {
    ;(context as any).updateUserAddress(userAddress || null)
  }, [userAddress]) // ✅ Remove context dependency to prevent infinite loop

  return context
}
