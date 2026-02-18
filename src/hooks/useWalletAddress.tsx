'use client'

import { useState, useEffect } from 'react'
import { getActiveEthereumProvider, type EthereumProvider } from '@/lib/wallet'

export function useWalletAddress() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if wallet is already connected
  useEffect(() => {
    async function checkConnection() {
      const provider: EthereumProvider | undefined =
        (getActiveEthereumProvider() ?? (typeof window !== 'undefined' ? window.ethereum : undefined)) || undefined

      if (provider) {
        try {
          const accounts = await provider.request({ 
            method: 'eth_accounts' 
          })
          
          if (accounts.length > 0) {
            setWalletAddress(accounts[0])
            console.log('👛 Wallet already connected:', accounts[0])
          }
        } catch (error) {
          console.error('Error checking wallet connection:', error)
        }
      }
    }

    checkConnection()
  }, [])

  // Listen for account changes
  useEffect(() => {
    const provider: EthereumProvider | undefined =
      (getActiveEthereumProvider() ?? (typeof window !== 'undefined' ? window.ethereum : undefined)) || undefined

    if (provider) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setWalletAddress(accounts[0])
          console.log('👛 Wallet account changed:', accounts[0])
        } else {
          setWalletAddress(null)
          console.log('👛 Wallet disconnected')
        }
      }

      provider.on('accountsChanged', handleAccountsChanged)

      return () => {
        provider.removeListener('accountsChanged', handleAccountsChanged)
      }
    }
  }, [])

  const connectWallet = async () => {
    const provider: EthereumProvider | undefined =
      (getActiveEthereumProvider() ?? (typeof window !== 'undefined' ? window.ethereum : undefined)) || undefined

    if (!provider) {
      setError('No wallet provider found')
      return false
    }

    setIsConnecting(true)
    setError(null)

    try {
      const accounts = await provider.request({
        method: 'eth_requestAccounts'
      })

      if (accounts.length > 0) {
        setWalletAddress(accounts[0])
        console.log('👛 Wallet connected:', accounts[0])
        return true
      } else {
        setError('No accounts found')
        return false
      }
    } catch (error) {
      console.error('Error connecting wallet:', error)
      setError(error instanceof Error ? error.message : 'Failed to connect wallet')
      return false
    } finally {
      setIsConnecting(false)
    }
  }

  return {
    walletAddress,
    isConnecting,
    error,
    connectWallet,
    isConnected: !!walletAddress
  }
} 