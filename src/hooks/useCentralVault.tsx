'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers, BrowserProvider, Contract } from 'ethers'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'

// CentralVault ABI - focused on deposit/withdraw functions
const CENTRAL_VAULT_ABI = [
  // Deposit functions
  'function deposit(address asset, uint256 amount) external payable',
  'function depositPrimaryCollateral(uint256 amount) external payable',
  
  // View functions
  'function userBalances(address user, address asset) view returns (tuple(uint256 available, uint256 locked, uint256 pendingWithdrawal))',
  'function totalAssetReserves(address asset) view returns (uint256)',
  'function supportedAssets(address asset) view returns (bool)',
  'function primaryCollateralToken() view returns (address)',
  'function primaryCollateralIsERC20() view returns (bool)',
  
  // Events
  'event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 timestamp)',
  'event Withdraw(address indexed user, address indexed asset, uint256 amount, uint256 timestamp)',
]

// MockUSDC ABI for approvals
const MOCK_USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]

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
      
      // Check if on Polygon (chainId 137)
      if (network.chainId !== 137) {
        setState(prev => ({
          ...prev,
          isConnected: false,
          isLoading: false,
          error: null // Remove error message from UI
        }))
        return false
      }

      // Test contract connection
      const vaultContract = new Contract(
        CONTRACT_ADDRESSES.centralVault,
        CENTRAL_VAULT_ABI,
        provider
      )

      // Get primary collateral token info
      const primaryToken = await vaultContract.primaryCollateralToken()
      const isERC20 = await vaultContract.primaryCollateralIsERC20()

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
        CONTRACT_ADDRESSES.centralVault,
        CENTRAL_VAULT_ABI,
        provider
      )

      const balance = await vaultContract.userBalances(walletAddress, state.primaryCollateralToken)
      
      const userBalance: UserBalance = {
        available: ethers.formatUnits(balance.available, 6), // USDC has 6 decimals
        locked: ethers.formatUnits(balance.locked, 6),
        pendingWithdrawal: ethers.formatUnits(balance.pendingWithdrawal, 6)
      }

      setState(prev => ({ ...prev, userBalance }))
      return userBalance

    } catch (error) {
      console.error('❌ Failed to load user balance:', error)
      return null
    }
  }, [walletAddress, state.isConnected, state.primaryCollateralToken])

  // Deposit collateral to vault - REAL BLOCKCHAIN TRANSACTION
  const depositCollateral = useCallback(async (amount: string): Promise<string> => {
    if (!walletAddress || !state.isConnected || !window.ethereum) {
      throw new Error('Wallet not connected or vault unavailable')
    }

    if (!state.primaryCollateralToken || !state.isERC20Collateral) {
      throw new Error('Vault not properly initialized')
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
        vault: CONTRACT_ADDRESSES.centralVault,
        mockUSDC: CONTRACT_ADDRESSES.mockUSDC,
        amount: amount + ' USDC'
      })
      
      const vaultContract = new Contract(
        CONTRACT_ADDRESSES.centralVault,
        CENTRAL_VAULT_ABI,
        signer
      )

      const usdcContract = new Contract(
        CONTRACT_ADDRESSES.mockUSDC,
        MOCK_USDC_ABI,
        signer
      )

      // Validate user has sufficient balance
      const userBalance = await usdcContract.balanceOf(walletAddress)
      if (userBalance < amountWei) {
        throw new Error(`Insufficient MOCK_USDC balance. You have ${ethers.formatUnits(userBalance, 6)} USDC`)
      }

      // Check and handle allowance
      const allowance = await usdcContract.allowance(walletAddress, CONTRACT_ADDRESSES.centralVault)
      
      if (allowance < amountWei) {
        console.log('🔓 Approving USDC spending for vault...')
        const approveTx = await usdcContract.approve(CONTRACT_ADDRESSES.centralVault, amountWei)
        const approveReceipt = await approveTx.wait()
        console.log('✅ USDC approval completed:', approveReceipt.transactionHash)
      }

      // Execute REAL deposit to CentralVault
      console.log('🏦 Executing REAL deposit to CentralVault:', amount, 'MOCK_USDC')
      const depositTx = await vaultContract.depositPrimaryCollateral(amountWei)
      
      console.log('⏳ Waiting for blockchain confirmation...', depositTx.hash)
      const receipt = await depositTx.wait()
      
      if (receipt.status !== 1) {
        throw new Error('Transaction failed on blockchain')
      }
      
      console.log('✅ REAL deposit completed successfully!', {
        txHash: receipt.transactionHash,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      })
      
      // Refresh user balance from vault
      await loadUserBalance()
      
      // Return actual transaction hash from blockchain
      return receipt.transactionHash

    } catch (error) {
      console.error('❌ REAL deposit failed:', error)
      throw error
    }
  }, [walletAddress, state.isConnected, state.primaryCollateralToken, state.isERC20Collateral, loadUserBalance])

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
    vaultAddress: CONTRACT_ADDRESSES.centralVault,
    mockUSDCAddress: CONTRACT_ADDRESSES.mockUSDC,
  }
}

export default useCentralVault
