'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { getActiveEthereumProvider, type EthereumProvider } from '@/lib/wallet'
import { getMagicProvider, magicRequestWithRetry, switchMagicChainWithRetry } from '@/lib/magic'
import { env } from '@/lib/env'

// Native USDC on Arbitrum
const ARBITRUM_NATIVE_USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const ARBITRUM_CHAIN_ID = 42161

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

interface UseArbitrumUSDCBalanceResult {
  balance: string | null
  balanceRaw: bigint | null
  decimals: number
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useArbitrumUSDCBalance(walletAddress: string | null): UseArbitrumUSDCBalanceResult {
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null)
  const [decimals, setDecimals] = useState<number>(6)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) {
      setBalance(null)
      setBalanceRaw(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Get the token address from env or use the native USDC address
      const tokenAddress =
        env.SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS ||
        env.SPOKE_ARBITRUM_USDC_ADDRESS ||
        ARBITRUM_NATIVE_USDC_ADDRESS

      // Get RPC URL for Arbitrum
      const rpcUrl = env.ARBITRUM_RPC_URL || env.NEXT_PUBLIC_ARBITRUM_RPC_URL

      let provider: ethers.Provider

      if (rpcUrl) {
        // Use JSON-RPC provider for read-only operations (faster, doesn't require wallet)
        provider = new ethers.JsonRpcProvider(rpcUrl)
      } else {
        // Fallback to wallet provider
        const preferred = typeof window !== 'undefined' ? window.localStorage.getItem('walletProvider') : null
        const isMagic = preferred === 'magic'
        const eip1193: EthereumProvider | undefined =
          (isMagic ? (getMagicProvider() as any as EthereumProvider) : null) ??
          (getActiveEthereumProvider() ?? (typeof window !== 'undefined' ? ((window as any).ethereum as EthereumProvider | undefined) : undefined)) ??
          undefined

        if (!eip1193) {
          throw new Error('No wallet or RPC provider available')
        }

        provider = new ethers.BrowserProvider(eip1193 as any)
      }

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

      const [rawBalance, tokenDecimals] = await Promise.all([
        token.balanceOf(walletAddress) as Promise<bigint>,
        token.decimals().catch(() => 6) as Promise<number>,
      ])

      const formattedBalance = ethers.formatUnits(rawBalance, tokenDecimals)
      
      setBalanceRaw(rawBalance)
      setDecimals(Number(tokenDecimals))
      setBalance(formattedBalance)
    } catch (err: any) {
      console.error('Error fetching Arbitrum USDC balance:', err)
      setError(err?.message || 'Failed to fetch balance')
      setBalance(null)
      setBalanceRaw(null)
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  return {
    balance,
    balanceRaw,
    decimals,
    isLoading,
    error,
    refetch: fetchBalance,
  }
}

export default useArbitrumUSDCBalance
