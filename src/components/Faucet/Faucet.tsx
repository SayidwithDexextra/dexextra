'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { FaucetProps, FaucetState, ClaimResult } from './types'
import styles from './Faucet.module.css'

// Mock USDC contract address on Polygon mainnet (from orderbook deployment)
const MOCK_USDC_ADDRESS = '0xff541e2AEc7716725f8EDD02945A1Fe15664588b'
const POLYGON_CHAIN_ID = 137

// Mock USDC ABI (comprehensive for faucet functionality)
const MOCK_USDC_ABI = [
  // Standard ERC20 functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  
  // Mock USDC specific functions
  'function mint(address to, uint256 amount) external',
  'function mintToSelf(uint256 amount) external',
  'function faucet() external',
  'function mintStandard(address to) external',
  'function faucetWithEvent() external',
  
  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event FaucetUsed(address indexed user, uint256 amount)'
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
      <div className={styles.formSection}>
        {/* Network Warning */}
        {isConnected && !isPolygonNetwork && (
          <div className={styles.warningContainer}>
            <div className={styles.warningContent}>
              <div className={styles.warningIcon}></div>
              <div className={styles.warningText}>
                <span className={styles.warningTitle}>Network Switch Required</span>
                <span className={styles.warningDescription}>
                  Switch to Polygon network to continue
                </span>
              </div>
            </div>
            <button 
              onClick={switchToPolygon}
              className={styles.warningAction}
            >
              Switch Network
            </button>
          </div>
        )}

        {/* Wallet Connection */}
        {!isConnected && (
          <div className={styles.connectionContainer}>
            <div className={styles.connectionContent}>
              <div className={styles.connectionIcon}></div>
              <div className={styles.connectionText}>
                <span className={styles.connectionTitle}>Connect Wallet</span>
                <span className={styles.connectionDescription}>
                  Connect your wallet to claim test USDC tokens
                </span>
              </div>
            </div>
            <button 
              onClick={connectWallet}
              disabled={isConnecting}
              className={styles.connectionAction}
            >
              {isConnecting ? (
                <>
                  <div className={styles.loadingSpinner} />
                  <span>Connecting</span>
                </>
              ) : (
                'Connect Wallet'
              )}
            </button>
          </div>
        )}

        {/* Balance Display */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.balanceContainer}>
            <div className={styles.balanceContent}>
              <div className={styles.balanceStatusDot}></div>
              <div className={styles.balanceText}>
                <span className={styles.balanceLabel}>Current Balance</span>
                <span className={styles.balanceDescription}>
                  Your mock USDC balance for testing
                </span>
              </div>
            </div>
            <div className={styles.balanceValue}>
              {state.isLoading ? (
                <div className={styles.loadingSpinner} />
              ) : (
                <div className={styles.balanceAmount}>
                  <div className={styles.usdcIcon}>$</div>
                  <span className={styles.balanceNumber}>{formatBalance(usdcBalance)} USDC</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Amount Input */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.inputContainer}>
            <div className={styles.inputContent}>
              <div className={styles.inputStatusDot}></div>
              <div className={styles.inputText}>
                <span className={styles.inputLabel}>Amount to Claim</span>
                <span className={styles.inputDescription}>
                  Enter USDC tokens to claim (up to 1,000,000)
                </span>
              </div>
            </div>
            <div className={styles.inputField}>
              <input
                type="text"
                value={state.customAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="e.g. 1000"
                className={`${styles.input} ${!validateAmount(state.customAmount) && state.customAmount ? styles.inputError : ''}`}
              />
              {state.customAmount && !validateAmount(state.customAmount) && (
                <div className={styles.errorFeedback}>
                  <span className={styles.errorText}>Invalid amount (0 - 1,000,000)</span>
                </div>
              )}
              {validateAmount(state.customAmount) && (
                <div className={styles.successFeedback}>
                  <span className={styles.successText}>Ready to claim {state.customAmount} USDC</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        {state.error && (
          <div className={styles.messageContainer}>
            <div className={styles.messageContent}>
              <div className={styles.errorIcon}></div>
              <span className={styles.errorMessage}>{state.error}</span>
            </div>
          </div>
        )}

        {state.success && (
          <div className={styles.messageContainer}>
            <div className={styles.messageContent}>
              <div className={styles.successIcon}></div>
              <span className={styles.successMessage}>{state.success}</span>
            </div>
          </div>
        )}

        {/* Claim Section */}
        {isConnected && isPolygonNetwork && (
          <div className={styles.claimContainer}>
            <div className={styles.claimContent}>
              <div className={styles.claimStatusDot}></div>
              <div className={styles.claimText}>
                <span className={styles.claimLabel}>Claim Tokens</span>
                <span className={styles.claimDescription}>
                  Get test USDC tokens instantly • No limits
                </span>
              </div>
            </div>
            <div className={styles.claimActions}>
              <button 
                onClick={handleClaim}
                disabled={!canClaim}
                className={styles.claimButton}
              >
                {state.isClaiming ? (
                  <>
                    <div className={styles.loadingSpinner} />
                    <span>Claiming</span>
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
        <div className={styles.infoHeader}>
          <div className={styles.infoIcon}></div>
          <span className={styles.infoTitle}>How it works</span>
        </div>
        <div className={styles.infoContent}>
          <div className={styles.infoItem}>
            <div className={styles.infoStepDot}></div>
            <span className={styles.infoText}>Connect wallet and switch to Polygon</span>
          </div>
          <div className={styles.infoItem}>
            <div className={styles.infoStepDot}></div>
            <span className={styles.infoText}>Enter amount to claim (up to 1M USDC)</span>
          </div>
          <div className={styles.infoItem}>
            <div className={styles.infoStepDot}></div>
            <span className={styles.infoText}>Receive tokens instantly • No limits</span>
          </div>
          <div className={styles.infoItem}>
            <div className={styles.infoStepDot}></div>
            <span className={styles.infoText}>Use for testing on Dexetra markets</span>
          </div>
        </div>
      </div>
    </div>
  )
} 