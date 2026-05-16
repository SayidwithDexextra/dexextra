'use client'

import { useState, useCallback, useEffect } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { getChainId, getRpcUrl } from '@/lib/network'
import { getActiveEthereumProvider } from '@/lib/wallet'
import { isMagicSelectedWallet, switchMagicChainWithRetry, getMagicProvider } from '@/lib/magic'

export interface NetworkGuardState {
  isConnected: boolean
  isOnCorrectNetwork: boolean
  isCheckingNetwork: boolean
  isSwitching: boolean
  walletChainId: number | null
  expectedChainId: number
  networkName: string
  error: string | null
}

export interface NetworkGuardActions {
  switchNetwork: () => Promise<boolean>
  checkNetwork: () => Promise<boolean>
  dismissError: () => void
}

export type UseNetworkGuardReturn = NetworkGuardState & NetworkGuardActions

const NETWORK_CONFIG: Record<number, { name: string; symbol: string; rpcUrl?: string }> = {
  999: { name: 'Hyperliquid', symbol: 'HYPE' },
  998: { name: 'Hyperliquid Testnet', symbol: 'HYPE' },
  42161: { name: 'Arbitrum One', symbol: 'ETH' },
  1: { name: 'Ethereum Mainnet', symbol: 'ETH' },
  137: { name: 'Polygon', symbol: 'MATIC' },
}

export function useNetworkGuard(): UseNetworkGuardReturn {
  const { walletData } = useWallet()
  const expectedChainId = getChainId()
  
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeChainId, setActiveChainId] = useState<number | null>(null)

  const walletChainId = walletData.chainId
  const isConnected = walletData.isConnected
  const networkName = NETWORK_CONFIG[expectedChainId]?.name || `Chain ${expectedChainId}`
  
  // Use activeChainId if available (freshly fetched), otherwise fall back to walletChainId
  const effectiveChainId = activeChainId ?? walletChainId
  
  // IMPORTANT: If connected but chainId is null/undefined, we consider it "wrong network"
  // because we can't verify it's correct. This ensures the guard is conservative.
  const isOnCorrectNetwork = !isConnected || (effectiveChainId !== null && effectiveChainId === expectedChainId)

  // Actively fetch chain ID on mount and when connection state changes
  // This handles cases where walletData.chainId might be stale or null
  useEffect(() => {
    if (!isConnected) {
      setActiveChainId(null)
      return
    }
    
    const fetchChainId = async () => {
      try {
        const isMagic = isMagicSelectedWallet()
        let fetchedChainId: number | null = null
        
        if (isMagic) {
          try {
            const magicProvider = getMagicProvider()
            const chainHex = await (magicProvider as any).request({ method: 'eth_chainId' })
            fetchedChainId = parseInt(chainHex, 16)
          } catch {
            fetchedChainId = walletChainId
          }
        } else {
          const ethereum = getActiveEthereumProvider() || (typeof window !== 'undefined' ? (window as any).ethereum : null)
          if (ethereum) {
            try {
              const chainHex = await ethereum.request({ method: 'eth_chainId' })
              fetchedChainId = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex)
            } catch {
              fetchedChainId = walletChainId
            }
          }
        }
        
        if (fetchedChainId !== null) {
          setActiveChainId(fetchedChainId)
          console.log(`[NetworkGuard] Fetched chain ID: ${fetchedChainId}, expected: ${expectedChainId}`)
        }
      } catch (err) {
        console.error('[NetworkGuard] Error fetching chain ID:', err)
      }
    }
    
    fetchChainId()
  }, [isConnected, walletChainId, expectedChainId])
  
  // Log when on wrong network
  useEffect(() => {
    if (isConnected && !isOnCorrectNetwork) {
      console.log(`[NetworkGuard] ⚠️ Wrong network! Wallet on chain ${effectiveChainId}, expected ${expectedChainId}`)
    }
  }, [isConnected, isOnCorrectNetwork, effectiveChainId, expectedChainId])

  const dismissError = useCallback(() => {
    setError(null)
  }, [])

  const checkNetwork = useCallback(async (): Promise<boolean> => {
    if (!isConnected) return true
    
    setIsCheckingNetwork(true)
    setError(null)
    
    try {
      const isMagic = isMagicSelectedWallet()
      let currentChainId: number | null = null

      if (isMagic) {
        try {
          const magicProvider = getMagicProvider()
          const chainHex = await (magicProvider as any).request({ method: 'eth_chainId' })
          currentChainId = parseInt(chainHex, 16)
        } catch {
          currentChainId = walletChainId
        }
      } else {
        const ethereum = getActiveEthereumProvider()
        if (ethereum) {
          try {
            const chainHex = await ethereum.request({ method: 'eth_chainId' })
            currentChainId = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex)
          } catch {
            currentChainId = walletChainId
          }
        }
      }

      return currentChainId === expectedChainId
    } catch (err: any) {
      console.error('[NetworkGuard] Error checking network:', err)
      setError('Failed to check network status')
      return false
    } finally {
      setIsCheckingNetwork(false)
    }
  }, [isConnected, walletChainId, expectedChainId])

  const switchNetwork = useCallback(async (): Promise<boolean> => {
    if (!isConnected) return true
    // Re-check current state since it may have changed
    const currentIsCorrect = effectiveChainId !== null && effectiveChainId === expectedChainId
    if (currentIsCorrect) return true

    setIsSwitching(true)
    setError(null)

    const expectedChainHex = `0x${expectedChainId.toString(16)}`
    const rpcUrl = getRpcUrl()

    try {
      const isMagic = isMagicSelectedWallet()

      if (isMagic) {
        try {
          await switchMagicChainWithRetry(expectedChainId, { retries: 2 })
          setActiveChainId(expectedChainId)
          return true
        } catch (magicErr: any) {
          setError(`Failed to switch Magic wallet: ${magicErr?.message || 'Unknown error'}`)
          return false
        }
      }

      const ethereum = getActiveEthereumProvider() || (window as any).ethereum
      if (!ethereum) {
        setError('No wallet provider found. Please install MetaMask or another wallet.')
        return false
      }

      const trySwitch = async () => {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: expectedChainHex }]
        })
      }

      const tryAddAndSwitch = async () => {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: expectedChainHex,
            chainName: networkName,
            nativeCurrency: { 
              name: networkName, 
              symbol: NETWORK_CONFIG[expectedChainId]?.symbol || 'ETH', 
              decimals: 18 
            },
            rpcUrls: [rpcUrl],
            blockExplorerUrls: ['https://explorer.hyperliquid.xyz']
          }]
        })
      }

      try {
        await trySwitch()
        setActiveChainId(expectedChainId)
        return true
      } catch (switchErr: any) {
        const userRejected = switchErr?.code === 4001
        const chainMissing = switchErr?.code === 4902

        if (userRejected) {
          setError('Network switch was rejected. Please approve the network change to continue trading.')
          return false
        }

        if (chainMissing) {
          try {
            await tryAddAndSwitch()
            setActiveChainId(expectedChainId)
            return true
          } catch (addErr: any) {
            const addRejected = addErr?.code === 4001
            if (addRejected) {
              setError(`Please approve adding ${networkName} to your wallet, then try again.`)
            } else {
              setError(`Failed to add ${networkName}. Please add it manually in your wallet settings.`)
            }
            return false
          }
        }

        setError(`Failed to switch network. Please manually switch to ${networkName} in your wallet.`)
        return false
      }
    } catch (err: any) {
      console.error('[NetworkGuard] Unexpected error switching network:', err)
      setError(`Unexpected error: ${err?.message || 'Please try again'}`)
      return false
    } finally {
      setIsSwitching(false)
    }
  }, [isConnected, effectiveChainId, expectedChainId, networkName])

  return {
    isConnected,
    isOnCorrectNetwork,
    isCheckingNetwork,
    isSwitching,
    walletChainId: effectiveChainId,
    expectedChainId,
    networkName,
    error,
    switchNetwork,
    checkNetwork,
    dismissError,
  }
}

export default useNetworkGuard
