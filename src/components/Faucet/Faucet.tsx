'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { FaucetProps, FaucetState, ClaimResult } from './types'
import styles from './Faucet.module.css'

// Mock USDC contract address on Polygon mainnet
const MOCK_USDC_ADDRESS = '0xbD9E0b8e723434dCd41700e82cC4C8C539F66377'
const POLYGON_CHAIN_ID = 137

// Mock USDC ABI (simplified for faucet functionality)
const MOCK_USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
]

export default function Faucet({ className }: FaucetProps) {
  const { walletAddress, isConnected, connectWallet, isConnecting } = useWalletAddress()
  
  const [state, setState] = useState<FaucetState>({
    isLoading: false,
    isClaiming: false,
    customAmount: '1000',
    error: null,
    success: null
  })

  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [isPolygonNetwork, setIsPolygonNetwork] = useState<boolean>(false)

  // Check network and load initial data
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      checkNetwork()
      
      // Listen for network changes
      const handleChainChanged = () => {
        checkNetwork()
      }
      
      window.ethereum.on('chainChanged', handleChainChanged)
      return () => {
        window.ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [])

  // Load user data when wallet connects
  useEffect(() => {
    if (isConnected && walletAddress && isPolygonNetwork) {
      loadUserData()
    }
  }, [isConnected, walletAddress, isPolygonNetwork])

  const checkNetwork = async () => {
    try {
      if (!window.ethereum) return
      
      const chainId = await window.ethereum.request({ method: 'eth_chainId' })
      const isPolygon = parseInt(chainId, 16) === POLYGON_CHAIN_ID
      setIsPolygonNetwork(isPolygon)
    } catch (error) {
      console.error('Error checking network:', error)
    }
  }

  const loadUserData = async () => {
    if (!walletAddress || !isPolygonNetwork) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const contract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, provider)
      
      const balance = await contract.balanceOf(walletAddress)
      const decimals = await contract.decimals()
      const formattedBalance = ethers.formatUnits(balance, decimals)
      
      setUsdcBalance(formattedBalance)
    } catch (error) {
      console.error('Error loading user data:', error)
      setState(prev => ({ 
        ...prev, 
        error: 'Failed to load balance. Please refresh and try again.' 
      }))
    } finally {
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }

  const switchToPolygon = async () => {
    if (!window.ethereum) return

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${POLYGON_CHAIN_ID.toString(16)}` }],
      })
    } catch (error: any) {
      // If network not added, add it
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${POLYGON_CHAIN_ID.toString(16)}`,
              chainName: 'Polygon Mainnet',
              nativeCurrency: {
                name: 'MATIC',
                symbol: 'MATIC',
                decimals: 18,
              },
              rpcUrls: ['https://polygon-rpc.com/'],
              blockExplorerUrls: ['https://polygonscan.com/'],
            }],
          })
        } catch (addError) {
          console.error('Error adding Polygon network:', addError)
        }
      }
    }
  }

  const validateAmount = (amount: string): boolean => {
    if (!amount || amount.trim() === '') return false
    const num = parseFloat(amount)
    return !isNaN(num) && num > 0 && num <= 1000000 // Max 1M tokens
  }

  const handleAmountChange = (value: string) => {
    // Allow only numbers and decimal point
    const cleanedValue = value.replace(/[^0-9.]/g, '')
    
    // Prevent multiple decimal points
    const parts = cleanedValue.split('.')
    if (parts.length > 2) {
      return
    }
    
    // Limit decimal places to 6 (USDC decimals)
    if (parts[1] && parts[1].length > 6) {
      return
    }

    setState(prev => ({ 
      ...prev, 
      customAmount: cleanedValue,
      error: null // Clear any existing errors when user types
    }))
  }

  const claimTokens = async (): Promise<ClaimResult> => {
    if (!walletAddress || !isPolygonNetwork) {
      throw new Error('Wallet not connected or wrong network')
    }

    if (!validateAmount(state.customAmount)) {
      throw new Error('Please enter a valid amount between 0 and 1,000,000 USDC')
    }

    const provider = new ethers.BrowserProvider(window.ethereum)
    const signer = await provider.getSigner()
    const contract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer)
    
    const decimals = await contract.decimals()
    const amount = ethers.parseUnits(state.customAmount, decimals)
    
    const tx = await contract.mint(walletAddress, amount)
    await tx.wait()
    
    return {
      success: true,
      txHash: tx.hash,
      amount: state.customAmount
    }
  }

  const handleClaim = async () => {
    if (state.isClaiming) return

    setState(prev => ({ 
      ...prev, 
      isClaiming: true, 
      error: null, 
      success: null 
    }))

    try {
      const result = await claimTokens()
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          success: `Successfully claimed ${result.amount} USDC!`
        }))

        // Refresh balance
        setTimeout(() => {
          loadUserData()
        }, 2000)
      }
    } catch (error: any) {
      console.error('Claim failed:', error)
      setState(prev => ({ 
        ...prev, 
        error: error.message || 'Failed to claim tokens. Please try again.' 
      }))
    } finally {
      setState(prev => ({ ...prev, isClaiming: false }))
    }
  }

  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance)
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K'
    } else {
      return num.toFixed(2)
    }
  }

  const canClaim = isConnected && isPolygonNetwork && !state.isClaiming && validateAmount(state.customAmount)

  return (
    <div className={`${styles.faucetContainer} ${className || ''}`}>
      {/* Header */}
      <div className={styles.faucetHeader}>
        <h1 className={styles.faucetTitle}>USDC Faucet</h1>
        <p className={styles.faucetSubtitle}>
          Claim test USDC tokens for trading on Polygon
        </p>
      </div>

      <div className={styles.formSection}>
        {/* Network Warning */}
        {isConnected && !isPolygonNetwork && (
          <div className={styles.networkWarning}>
            Switch to Polygon network to continue
            <button 
              onClick={switchToPolygon}
              className={styles.networkSwitchButton}
            >
              Switch Network
            </button>
          </div>
        )}

        {/* Wallet Connection */}
        {!isConnected && (
          <div className={styles.connectionSection}>
            <button 
              onClick={connectWallet}
              disabled={isConnecting}
              className={styles.connectButton}
            >
              {isConnecting ? (
                <>
                  <div className={styles.loadingSpinner} />
                  Connecting
                </>
              ) : (
                'Connect Wallet'
              )}
            </button>
          </div>
        )}

        {/* Balance Display */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Current Balance</div>
              <div className={styles.fieldDescription}>
                Your mock USDC balance for testing and trading
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.statusDisplay}>
                {state.isLoading ? (
                  <div className={styles.loadingSpinner} />
                ) : (
                  <div className={styles.balanceAmount}>
                    <div className={styles.usdcIcon}>$</div>
                    {formatBalance(usdcBalance)} USDC
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Amount Input */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Amount to Claim</div>
              <div className={styles.fieldDescription}>
                Enter the number of USDC tokens you want to claim (up to 1,000,000)
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>USDC AMOUNT</div>
              <input
                type="text"
                value={state.customAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="Enter amount (e.g. 1000)"
                className={`${styles.input} ${!validateAmount(state.customAmount) && state.customAmount ? styles.inputError : ''}`}
              />
              {state.customAmount && !validateAmount(state.customAmount) && (
                <div className={styles.errorText}>
                  Please enter a valid amount between 0 and 1,000,000
                </div>
              )}
              {validateAmount(state.customAmount) && (
                <div className={styles.helpText}>
                  You will receive {state.customAmount} USDC tokens
                </div>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        {state.error && (
          <div className={styles.errorMessage}>
            {state.error}
          </div>
        )}

        {state.success && (
          <div className={styles.successMessage}>
            {state.success}
          </div>
        )}

        {/* Claim Section */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Claim Tokens</div>
              <div className={styles.fieldDescription}>
                Get your specified amount of test USDC tokens instantly. No limits or restrictions.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <button 
                onClick={handleClaim}
                disabled={!canClaim}
                className={styles.claimButton}
              >
                {state.isClaiming ? (
                  <>
                    <div className={styles.loadingSpinner} />
                    Claiming
                  </>
                ) : (
                  `Claim ${validateAmount(state.customAmount) ? state.customAmount : '...'} USDC`
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className={styles.infoSection}>
        <div className={styles.infoTitle}>How it works</div>
        <ul className={styles.infoList}>
          <li>Connect your wallet and switch to Polygon network</li>
          <li>Enter the amount of USDC tokens you want to claim</li>
          <li>Click claim to receive tokens instantly</li>
          <li>No waiting periods or daily limits</li>
          <li>Use these tokens to trade on Dexetra markets</li>
          <li>Tokens are for testing purposes only and have no real value</li>
        </ul>
      </div>
    </div>
  )
} 