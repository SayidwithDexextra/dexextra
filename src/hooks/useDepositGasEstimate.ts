'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { env } from '@/lib/env'

interface GasEstimate {
  gasFeeUsd: number
  gasFeeEth: number
  gasPrice: bigint
  isLoading: boolean
  error: string | null
}

const ARBITRUM_RPC_URL = env.ARBITRUM_RPC_URL || env.NEXT_PUBLIC_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'

// Typical gas usage for deposit flow on Arbitrum:
// - ERC20 approve: ~46,000 gas
// - SpokeVault.deposit: ~150,000 gas
// Total with buffer: ~250,000 gas
const DEPOSIT_GAS_ESTIMATE = 250_000n

// Cache for ETH price to avoid repeated fetches
let cachedEthPrice: { price: number; timestamp: number } | null = null
const ETH_PRICE_CACHE_DURATION = 60_000 // 1 minute

async function fetchEthPrice(): Promise<number> {
  // Check cache first
  if (cachedEthPrice && Date.now() - cachedEthPrice.timestamp < ETH_PRICE_CACHE_DURATION) {
    return cachedEthPrice.price
  }

  try {
    const response = await fetch('/api/eth-price', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.price && !isNaN(data.price)) {
        cachedEthPrice = { price: data.price, timestamp: Date.now() }
        return data.price
      }
    }
  } catch (error) {
    console.warn('Failed to fetch ETH price from API:', error)
  }

  // Fallback to a reasonable estimate if API fails
  return cachedEthPrice?.price || 3000
}

async function getArbitrumGasPrice(): Promise<bigint> {
  try {
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC_URL)
    const feeData = await provider.getFeeData()
    
    // Use maxFeePerGas for EIP-1559, fallback to gasPrice
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n
    return gasPrice
  } catch (error) {
    console.warn('Failed to fetch Arbitrum gas price:', error)
    // Fallback: ~0.1 gwei typical for Arbitrum
    return ethers.parseUnits('0.1', 'gwei')
  }
}

export function useDepositGasEstimate(chainId: number = 42161) {
  const [estimate, setEstimate] = useState<GasEstimate>({
    gasFeeUsd: 0,
    gasFeeEth: 0,
    gasPrice: 0n,
    isLoading: true,
    error: null,
  })

  const fetchEstimate = useCallback(async () => {
    // Only support Arbitrum for now
    if (chainId !== 42161) {
      setEstimate(prev => ({ ...prev, isLoading: false, error: 'Unsupported chain' }))
      return
    }

    try {
      setEstimate(prev => ({ ...prev, isLoading: true, error: null }))

      // Fetch gas price and ETH price in parallel
      const [gasPrice, ethPrice] = await Promise.all([
        getArbitrumGasPrice(),
        fetchEthPrice(),
      ])

      // Calculate gas cost in ETH
      const gasCostWei = DEPOSIT_GAS_ESTIMATE * gasPrice
      const gasFeeEth = Number(gasCostWei) / 1e18

      // Convert to USD
      const gasFeeUsd = gasFeeEth * ethPrice

      setEstimate({
        gasFeeUsd,
        gasFeeEth,
        gasPrice,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      console.error('Failed to estimate gas:', error)
      setEstimate(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to estimate gas',
      }))
    }
  }, [chainId])

  // Fetch on mount and set up refresh interval
  useEffect(() => {
    fetchEstimate()

    // Refresh every 30 seconds
    const interval = setInterval(fetchEstimate, 30_000)
    return () => clearInterval(interval)
  }, [fetchEstimate])

  return {
    ...estimate,
    refresh: fetchEstimate,
  }
}

// Standalone function for one-time gas estimation
export async function estimateDepositGasFee(): Promise<{ gasFeeUsd: number; gasFeeEth: number }> {
  try {
    const [gasPrice, ethPrice] = await Promise.all([
      getArbitrumGasPrice(),
      fetchEthPrice(),
    ])

    const gasCostWei = DEPOSIT_GAS_ESTIMATE * gasPrice
    const gasFeeEth = Number(gasCostWei) / 1e18
    const gasFeeUsd = gasFeeEth * ethPrice

    return { gasFeeUsd, gasFeeEth }
  } catch (error) {
    console.error('Failed to estimate deposit gas fee:', error)
    // Return a conservative fallback for Arbitrum
    return { gasFeeUsd: 0.05, gasFeeEth: 0.00002 }
  }
}
