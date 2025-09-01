'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers, BrowserProvider, Contract } from 'ethers'
import { CONTRACTS } from '@/lib/contracts'

// Extend Window interface for ethereum provider
declare global {
  interface Window {
    ethereum?: any
  }
}

interface UserBalance {
  available: string
  locked: string
  pendingWithdrawal: string
}

interface VaultState {
  isConnected: boolean
  isLoading: boolean
  userBalance: UserBalance | null
  error: string | null
  primaryCollateralToken: string | null
  isERC20Collateral: boolean
}

// Helper function to switch to Polygon network
const switchToPolygon = async () => {
  if (!window.ethereum) return false
  
  try {
    // Try to switch to Polygon
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x89' }], // 137 in hex
    })
    return true
  } catch (switchError: any) {
    // If network doesn't exist, add it
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x89',
            chainName: 'Polygon',
            nativeCurrency: {
              name: 'MATIC',
              symbol: 'MATIC',
              decimals: 18,
            },
            rpcUrls: ['https://polygon-rpc.com/'],
            blockExplorerUrls: ['https://polygonscan.com/'],
          }],
        })
        return true
      } catch (addError) {
        console.error('Failed to add Polygon network:', addError)
        return false
      }
    }
    console.error('Failed to switch to Polygon network:', switchError)
    return false
  }
}

export function useCentralVault(walletAddress?: string) {
  const [state, setState] = useState<VaultState>({
    isConnected: false,
    isLoading: false,
    userBalance: null,
    error: null,
    primaryCollateralToken: null,
    isERC20Collateral: false
  })

  // Check if wallet is connected and on correct network
  const checkVaultConnection = useCallback(async () => {
    if (!walletAddress) {
      setState(prev => ({ ...prev, isConnected: false, error: null }))
      return false
    }
    
    if (typeof window === 'undefined' || !window.ethereum) {
      setState(prev => ({ ...prev, isConnected: false, error: null }))
      return false
    }

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }))
      
      const provider = new BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()
      
      console.log('🔗 Network connection details:', {
        chainId: network.chainId.toString(),
        networkName: network.name,
        expectedChainId: '137'
      })
      
      // Check if on Polygon (chainId 137)
      if (network.chainId !== 137n) { // Use BigInt comparison
        console.log(`❌ Wrong network detected. Current: ${network.chainId}, Expected: 137 (Polygon)`)
        setState(prev => ({
          ...prev,
          isConnected: false,
          isLoading: false,
          error: null // Remove error message from UI
        }))
        return false
      }

      console.log('✅ Correct network detected (Polygon)')

      // Test contract connection
      const vaultContract = new Contract(
        CONTRACTS.CentralVault.address,
        CONTRACTS.CentralVault.abi,
        provider
      )

      console.log('🔗 Testing vault contract connection...')

      // Get primary collateral token info
      const primaryToken = await vaultContract.primaryCollateralToken()
      const isERC20 = await vaultContract.primaryCollateralIsERC20()

      console.log('✅ Vault contract connected successfully:', {
        primaryToken,
        isERC20,
        vaultAddress: CONTRACTS.CentralVault.address
      })

      setState(prev => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        primaryCollateralToken: primaryToken,
        isERC20Collateral: isERC20,
        error: null
      }))

      return true

    } catch (error) {
      console.error('❌ Vault connection failed:', error)
      console.error('❌ Error details:', {
        message: error.message,
        code: error.code,
        reason: error.reason
      })
      setState(prev => ({
        ...prev,
        isConnected: false,
        isLoading: false,
        error: null // Remove error message from UI
      }))
      return false
    }
  }, [walletAddress])

  // Load user balance from vault
  const loadUserBalance = useCallback(async () => {
    if (!walletAddress || !state.isConnected || !state.primaryCollateralToken) {
      return null
    }

    try {
      const provider = new BrowserProvider(window.ethereum)
      const vaultContract = new Contract(
        CONTRACTS.CentralVault.address,
        CONTRACTS.CentralVault.abi,
        provider
      )

      const balance = await vaultContract.userBalances(walletAddress, state.primaryCollateralToken)
      
      console.log('📊 Raw balance data from contract:', {
        available: balance.available?.toString(),
        locked: balance.locked?.toString(),
        pendingWithdrawal: balance.pendingWithdrawal?.toString(),
        walletAddress,
        primaryCollateralToken: state.primaryCollateralToken
      })
      
      // Helper function to safely format units with null checks
      const safeFormatUnits = (value: any, decimals: number = 6): string => {
        if (value === null || value === undefined) {
          console.log('⚠️ Null/undefined value detected, defaulting to 0')
          return '0'
        }
        try {
          return ethers.formatUnits(value, decimals)
        } catch (error) {
          console.error('❌ Error formatting units:', error, 'Value:', value)
          return '0'
        }
      }
      
      const userBalance: UserBalance = {
        available: safeFormatUnits(balance.available, 6), // USDC has 6 decimals
        locked: safeFormatUnits(balance.locked, 6),
        pendingWithdrawal: safeFormatUnits(balance.pendingWithdrawal, 6)
      }

      console.log('✅ Successfully formatted user balance:', userBalance)
      
      setState(prev => ({ ...prev, userBalance }))
      return userBalance

    } catch (error) {
      console.error('❌ Failed to load user balance:', error)
      console.error('❌ Balance loading error details:', {
        message: error.message,
        code: error.code,
        walletAddress,
        isConnected: state.isConnected,
        primaryCollateralToken: state.primaryCollateralToken
      })
      return null
    }
  }, [walletAddress, state.isConnected, state.primaryCollateralToken])

  // Deposit collateral to vault - REAL BLOCKCHAIN TRANSACTION
  const depositCollateral = useCallback(async (amount: string): Promise<string> => {
    // Basic validation - only require wallet and ethereum provider
    if (!walletAddress || !window.ethereum) {
      throw new Error('Wallet not connected')
    }

    console.log('🏦 Starting deposit with progressive vault initialization:', {
      walletAddress,
      amount,
      currentVaultState: {
        isConnected: state.isConnected,
        primaryCollateralToken: state.primaryCollateralToken,
        isERC20Collateral: state.isERC20Collateral
      }
    })

    // If vault not connected, try to establish connection
    if (!state.isConnected) {
      console.log('🔄 Vault not connected, attempting to connect...')
      
      try {
        const connected = await checkVaultConnection()
        if (!connected) {
          // Check the specific reason for failure
          const provider = new BrowserProvider(window.ethereum)
          const network = await provider.getNetwork()
          
          if (network.chainId !== 137n) {
            console.log('🔄 Wrong network detected, attempting to switch to Polygon...')
            const switched = await switchToPolygon()
            if (switched) {
              // Try connection again after network switch
              const retryConnected = await checkVaultConnection()
              if (!retryConnected) {
                throw new Error('Failed to connect to vault after switching to Polygon network')
              }
            } else {
              throw new Error(`Please manually switch to Polygon network. Current network: ${network.name} (Chain ID: ${network.chainId})`)
            }
          } else {
            throw new Error('Failed to connect to vault contract. Please check your connection and try again.')
          }
        }
        console.log('✅ Vault connection established successfully')
      } catch (connectionError) {
        console.error('❌ Vault connection error:', connectionError)
        throw connectionError
      }
    } else {
      console.log('✅ Vault already connected, proceeding with deposit')
    }

    // Additional validation after connection attempt
    if (!state.primaryCollateralToken || !state.isERC20Collateral) {
      throw new Error('Vault not properly initialized for USDC deposits')
    }

    try {
      const provider = new BrowserProvider(window.ethereum)
      
      // Validate amount
      const amountNum = parseFloat(amount)
      if (amountNum <= 0) {
        throw new Error('Invalid deposit amount')
      }
      
      // Convert amount to proper units (USDC has 6 decimals)
      const amountWei = ethers.parseUnits(amount, 6)

      // Get contracts  
      const signer = await provider.getSigner()
      
      console.log('🔗 Using contracts:', {
        vault: CONTRACTS.CentralVault.address,
        mockUSDC: CONTRACTS.MockUSDC.address,
        amount: amount + ' USDC'
      })
      
      const vaultContract = new Contract(
        CONTRACTS.CentralVault.address,
        CONTRACTS.CentralVault.abi,
        signer
      )

      const usdcContract = new Contract(
        CONTRACTS.MockUSDC.address,
        CONTRACTS.MockUSDC.abi,
        signer
      )

      // Validate user has sufficient balance
      const userBalance = await usdcContract.balanceOf(walletAddress)
      if (userBalance < amountWei) {
        throw new Error(`Insufficient MOCK_USDC balance. You have ${ethers.formatUnits(userBalance, 6)} USDC`)
      }

      // Check and handle allowance
      const allowance = await usdcContract.allowance(walletAddress, CONTRACTS.CentralVault.address)
      
      if (allowance < amountWei) {
        console.log('🔓 Approving USDC spending for vault...')
        const approveTx = await usdcContract.approve(CONTRACTS.CentralVault.address, amountWei)
        const approveReceipt = await approveTx.wait()
        console.log('✅ USDC approval completed:', approveReceipt.transactionHash)
      }

      // Execute REAL deposit to CentralVault
      console.log('🏦 Executing REAL deposit to CentralVault:', amount, 'MOCK_USDC')
      const depositTx = await vaultContract.depositPrimaryCollateral(amountWei)
      
      console.log('⏳ Waiting for blockchain confirmation...', depositTx.hash)
      
      // Add validation for transaction object
      if (!depositTx || !depositTx.hash) {
        throw new Error('Invalid transaction object returned from contract')
      }
      
      const receipt = await depositTx.wait()
      
      console.log('📋 Transaction receipt details:', {
        status: receipt.status,
        transactionHash: receipt.transactionHash,
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        allProperties: Object.keys(receipt)
      })
      
      if (receipt.status !== 1) {
        throw new Error('Transaction failed on blockchain')
      }
      
      // Try to get transaction hash from different possible properties
      // Different ethers versions and networks may use different property names
      const transactionHash = receipt.transactionHash || 
                               receipt.hash || 
                               depositTx.hash || 
                               receipt.transactionHash ||  // Sometimes it's nested
                               (receipt as any).txHash ||  // Some implementations use txHash
                               (receipt as any).tx_hash    // Some use snake_case
      
      console.log('🔍 Transaction hash resolution:', {
        receiptTransactionHash: receipt.transactionHash,
        receiptHash: receipt.hash,
        depositTxHash: depositTx.hash,
        receiptTxHash: (receipt as any).txHash,
        receiptTx_hash: (receipt as any).tx_hash,
        resolved: transactionHash,
        receiptType: typeof receipt,
        receiptKeys: Object.keys(receipt)
      })
      
      // Validate transaction hash before returning
      if (!transactionHash) {
        console.error('❌ No transaction hash found in any location:', {
          receipt: receipt,
          depositTx: depositTx
        })
        throw new Error('Transaction completed but no hash found in receipt or transaction object')
      }
      
      console.log('✅ REAL deposit completed successfully!', {
        txHash: transactionHash,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString()
      })
      
      // Store transaction hash before any async operations (already resolved above)
      console.log('🔗 Stored transaction hash for return:', transactionHash)
      
      // Refresh user balance from vault (don't let this interfere with return value)
      try {
        await loadUserBalance()
        console.log('✅ User balance refreshed successfully')
      } catch (balanceError) {
        console.warn('⚠️ Failed to refresh balance after deposit, but transaction was successful:', balanceError)
      }
      
      // Return actual transaction hash from blockchain
      console.log('🔗 Returning transaction hash:', transactionHash)
      return transactionHash

    } catch (error) {
      console.error('❌ REAL deposit failed:', error)
      throw error
    }
  }, [walletAddress, state.isConnected, state.primaryCollateralToken, state.isERC20Collateral, loadUserBalance, checkVaultConnection])

  // Initialize vault connection when wallet connects
  useEffect(() => {
    if (walletAddress) {
      checkVaultConnection()
    }
  }, [walletAddress, checkVaultConnection])

  // Load user balance when vault connects
  useEffect(() => {
    if (state.isConnected && state.primaryCollateralToken) {
      loadUserBalance()
    }
  }, [state.isConnected, state.primaryCollateralToken, loadUserBalance])

  return {
    ...state,
    depositCollateral,
    loadUserBalance,
    checkVaultConnection,
    
    // Computed properties
    totalBalance: state.userBalance 
      ? (parseFloat(state.userBalance.available) + parseFloat(state.userBalance.locked)).toString()
      : '0',
    
    availableBalance: state.userBalance?.available || '0',
    lockedBalance: state.userBalance?.locked || '0',
    
    // Contract addresses for reference
    vaultAddress: CONTRACTS.CentralVault.address,
    mockUSDCAddress: CONTRACTS.MockUSDC.address,
  }
}

export default useCentralVault
