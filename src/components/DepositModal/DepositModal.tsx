'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { designSystem, styles } from './DepositModal.styles'
import { DepositModalProps, PaymentMethod, Token } from './types'
import cssStyles from './DepositModal.module.css'
import DepositModalInput from './DepositModalInput'
import DepositModalReview from './DepositModalReview'
import DepositModalStatus from './DepositModalStatus'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { useWalletPortfolio } from '@/hooks/useWalletPortfolio'
import { useCentralizedVault } from '@/contexts/CentralizedVaultContext'
import { NetworkWarningBanner } from '@/components/NetworkStatus'

// Close Icon Component
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Arrow Right Icon Component
const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function DepositModal({ isOpen, onClose }: DepositModalProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [showInputModal, setShowInputModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [depositAmount, setDepositAmount] = useState('4.79')
  const [isAnimating, setIsAnimating] = useState(false)
  const [animationDirection, setAnimationDirection] = useState<'forward' | 'backward'>('forward')
  const [showInitialAnimation, setShowInitialAnimation] = useState(false)
  
  // Transaction status state
  const [transactionStatus, setTransactionStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [transactionHash, setTransactionHash] = useState<string | undefined>(undefined)
  const [transactionStartTime, setTransactionStartTime] = useState<number>(0)
  const [actualTransactionTime, setActualTransactionTime] = useState<string | undefined>(undefined)

  // Real wallet integration
  const { walletAddress, isConnected, connectWallet, isConnecting } = useWalletAddress()
  const { tokens: portfolioTokens, summary, isLoading: isLoadingPortfolio, error: portfolioError } = useWalletPortfolio(walletAddress)
  
  // Extract totalValue from V2 summary (convert string to number for legacy compatibility)
  const totalValue = parseFloat(summary.totalValue) || 0
  
  // Centralized vault integration for direct deposits
  const { depositCollateral, isConnected: isVaultConnected } = useCentralizedVault(walletAddress || undefined)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      // Trigger animation on next render cycle
      setShowInitialAnimation(true)
      // OPTIMIZED: Reduced animation timeout for faster interactions
      const timer = setTimeout(() => {
        setShowInitialAnimation(false)
      }, 300) // Reduced from 600ms
      
      return () => clearTimeout(timer)
    } else {
      document.body.style.overflow = 'unset'
      setShowInitialAnimation(false)
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Dynamic payment methods based on wallet connection
  const paymentMethods: PaymentMethod[] = [
    {
      id: 'wallet',
      name: isConnected ? `Wallet (...${walletAddress?.slice(-4)})` : 'Connect Wallet',
      description: `Dexetra Balance: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      balance: isConnected ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//MetaMask_Fox.svg.png'
    }
  ]

  // Fetch live balances for all stablecoins from portfolio data
  const stablecoinAddresses = {
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT on Polygon
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC on Polygon  
    dai: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',   // DAI on Polygon
    mockUsdc: '0xbD9E0b8e723434dCd41700e82cC4C8C539F66377'   // MOCK_USDC on Polygon
  }
  
  const findTokenByAddress = (address: string) => {
    return portfolioTokens.find(token => 
      token.contractAddress?.toLowerCase() === address.toLowerCase()
    )
  }
  
  const usdtToken = findTokenByAddress(stablecoinAddresses.usdt)
  const usdcToken = findTokenByAddress(stablecoinAddresses.usdc)
  const daiToken = findTokenByAddress(stablecoinAddresses.dai)
  const mockUSDCToken = findTokenByAddress(stablecoinAddresses.mockUsdc)
  
  const tokens: Token[] = [
    {
      id: 'usdt',
      symbol: 'USDT',
      name: usdtToken?.name || 'Tether USD',
      amount: usdtToken?.amount || '0.00 USDT',
      value: usdtToken?.value || '$0.00',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//tether-usdt-logo.png',
      networkIcon: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
      network: 'polygon',
      contractAddress: stablecoinAddresses.usdt,
      decimals: usdtToken?.decimals || 6,
      isLowBalance: usdtToken?.isLowBalance || false
    },
    {
      id: 'usdc',
      symbol: 'USDC',
      name: usdcToken?.name || 'USD Coin',
      amount: usdcToken?.amount || '0.00 USDC',
      value: usdcToken?.value || '$0.00',
      icon: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg',
      networkIcon: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
      network: 'polygon',
      contractAddress: stablecoinAddresses.usdc,
      decimals: usdcToken?.decimals || 6,
      isLowBalance: usdcToken?.isLowBalance || false
    },
    {
      id: 'dai',
      symbol: 'DAI',
      name: daiToken?.name || 'Dai Stablecoin',
      amount: daiToken?.amount || '0.00 DAI',
      value: daiToken?.value || '$0.00',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//multi-collateral-dai-dai-logo.svg',
      networkIcon: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
      network: 'polygon',
      contractAddress: stablecoinAddresses.dai,
      decimals: daiToken?.decimals || 18,
      isLowBalance: daiToken?.isLowBalance || false
    },
    {
      id: 'dexetera_usdc_mock',
      symbol: 'MOCK_USDC',
      name: mockUSDCToken?.name || 'Dexetera Mock USDC',
      amount: mockUSDCToken?.amount || '0.00 MOCK_USDC',
      value: mockUSDCToken?.value || '$0.00',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png',
      networkIcon: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
      network: 'polygon',
      contractAddress: stablecoinAddresses.mockUsdc,
      decimals: mockUSDCToken?.decimals || 6,
      isLowBalance: mockUSDCToken?.isLowBalance || false
    }
  ]

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleContinue = async () => {
    // If wallet not connected, connect first
    if (!isConnected) {
      const connected = await connectWallet()
      if (!connected) return // Exit if connection failed
    }

    // Start sliding animation to input modal
    setIsAnimating(true)
    setAnimationDirection('forward')
    
    // OPTIMIZED: Reduced animation delay for faster interactions
    setTimeout(() => {
      setShowInputModal(true)
      setIsAnimating(false)
    }, 50) // Reduced from 150ms
  }

  const handleInputModalClose = () => {
    setShowInputModal(false)
    setShowReviewModal(false)
    onClose()
  }

  const handleInputModalBack = () => {
    // Start sliding animation back to first modal
    setIsAnimating(true)
    setAnimationDirection('backward')
    
    // OPTIMIZED: Reduced animation delay for faster interactions
    setTimeout(() => {
      setShowInputModal(false)
      setIsAnimating(false)
    }, 50) // Reduced from 150ms
  }

  const handleInputModalContinue = (amount?: string) => {
    // Update deposit amount if provided
    if (amount) {
      setDepositAmount(amount)
    }
    
    // Start sliding animation to review modal
    setIsAnimating(true)
    setAnimationDirection('forward')
    
    // OPTIMIZED: Reduced animation delay for faster interactions
    setTimeout(() => {
      setShowInputModal(false)
      setShowReviewModal(true)
      setIsAnimating(false)
    }, 50) // Reduced from 150ms
  }

  const handleReviewModalBack = () => {
    // Start sliding animation back to input modal
    setIsAnimating(true)
    setAnimationDirection('backward')
    
    // OPTIMIZED: Reduced animation delay for faster interactions
    setTimeout(() => {
      setShowReviewModal(false)
      setShowInputModal(true)
      setIsAnimating(false)
    }, 50) // Reduced from 150ms
  }

  const handleReviewModalConfirm = async () => {
    // Immediately show status modal with pending state
    setTransactionStartTime(Date.now())
    setTransactionStatus('pending')
    
    // Show status modal immediately - no delay
    setShowReviewModal(false)
    setShowStatusModal(true)

    // Process transaction in background while status modal is showing
    try {
      let txHash: string | undefined = undefined

      if (isDirectDeposit && depositCollateral) {
        // Direct deposit to vault
        console.log('🏦 Starting direct deposit:', depositAmount)
        await depositCollateral(depositAmount)
        console.log('✅ Direct deposit completed successfully')
        
        // Generate a mock transaction hash for direct deposits
        txHash = '0x' + Math.random().toString(16).substring(2, 66)
      } else {
        // Swap transaction (simulate for now)
        console.log('🔄 Starting swap transaction:', depositAmount)
        await new Promise(resolve => setTimeout(resolve, 3000)) // Simulate transaction time
        console.log('✅ Swap transaction completed successfully')
        
        // Generate a mock transaction hash for swaps
        txHash = '0x' + Math.random().toString(16).substring(2, 66)
      }
      
      // Calculate actual transaction time
      const elapsed = Math.floor((Date.now() - transactionStartTime) / 1000)
      const timeText = elapsed < 60 ? `${elapsed} seconds` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      
      // Set transaction results
      setTransactionHash(txHash)
      setActualTransactionTime(timeText)
      
      // Update to success status (this will trigger re-render of status modal)
      setTransactionStatus('success')
      
      console.log('📊 Transaction completed:', {
        hash: txHash,
        time: timeText,
        amount: depositAmount,
        isDirectDeposit
      })
      
    } catch (error) {
      console.error('❌ Transaction failed:', error)
      
      // Calculate time even for failed transactions
      const elapsed = Math.floor((Date.now() - transactionStartTime) / 1000)
      const timeText = elapsed < 60 ? `${elapsed} seconds` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      setActualTransactionTime(timeText)
      
      // Set error status
      setTransactionStatus('error')
    }
  }

  const handleStatusModalClose = () => {
    setShowStatusModal(false)
    onClose()
  }

  const handleNewDeposit = () => {
    // Reset all states and restart the flow
    setShowStatusModal(false)
    setSelectedToken(null)
    setDepositAmount('4.79')
    setTransactionStatus('pending')
    setTransactionHash(undefined)
    setActualTransactionTime(undefined)
    // Don't close main modal, just reset to initial state
  }

  // Get selected token information
  const getSelectedTokenInfo = () => {
    if (!selectedToken) {
      // Default POL token with actual icon
      return { 
        symbol: 'POL', 
        icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiM4MjQ3RTUiLz4KPHBhdGggZD0iTTkgMTZMMTcgMjQgMjMgMTYgMTcgOCA5IDE2WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg=='
      }
    }
    const token = tokens.find(t => t.id === selectedToken)
    if (!token) {
      // Default POL token with actual icon
      return { 
        symbol: 'POL', 
        icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiM4MjQ3RTUiLz4KPHBhdGggZD0iTTkgMTZMMTcgMjQgMjMgMTYgMTcgOCA5IDE2WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg=='
      }
    }
    return {
      symbol: token.symbol,
      icon: token.icon // Use actual token icon URL
    }
  }

  // Get the actual USD balance of the selected token
  const getSelectedTokenBalance = (): number => {
    if (!selectedToken) return 0
    const token = tokens.find(t => t.id === selectedToken)
    if (!token) return 0
    
    // Parse the value string (format: "$1,234.56") to get the numeric balance
    const balanceString = token.value.replace('$', '').replace(/,/g, '')
    const balance = parseFloat(balanceString)
    return isNaN(balance) ? 0 : balance
  }

  // Check if selected token is the vault collateral token (USDC variants)
  const isVaultCollateralToken = (): boolean => {
    if (!selectedToken) return false
    const token = tokens.find(t => t.id === selectedToken)
    if (!token) return false
    
    // Check for USDC variants that can be directly deposited to the vault
    const collateralSymbols = ['USDC', 'MOCK_USDC', 'USDC.E']
    return collateralSymbols.includes(token.symbol.toUpperCase())
  }

  // Determine if this should be a direct deposit or swap
  const isDirectDeposit = isVaultCollateralToken()

  // Get appropriate target token based on deposit type
  const getTargetToken = () => {
    if (isDirectDeposit) {
      // For direct deposits, target is the vault (no token conversion)
      return { 
        symbol: 'VAULT', 
        icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png',
        name: 'Dexetra Vault'
      }
    } else {
      // For swaps, target is USDC
      return { 
        symbol: 'USDC', 
        icon: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg',
        name: 'USD Coin'
      }
    }
  }

  if (!mounted) return null

  // Animation classes
  const getModalClasses = () => {
    const baseClasses = cssStyles.depositModal
    
    if (!isAnimating) {
      // Add initial fadeIn animation only when modal first opens
      if (showInitialAnimation) {
        return `${baseClasses} ${cssStyles.initialFadeIn}`
      }
      return baseClasses
    }
    
    const animationClass = animationDirection === 'forward' 
      ? cssStyles.modalSlideOutLeft
      : cssStyles.modalSlideInFromLeft
      
    return `${baseClasses} ${animationClass}`
  }

  return (
    <>
      {(isOpen && !showInputModal) && createPortal(
        <div style={styles.overlay} onClick={handleBackdropClick}>
          <div 
            style={{
              ...styles.modal,
              backgroundColor: '#1a1a1a',
              border: '1px solid #333333'
            }} 
            className={getModalClasses()}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              style={styles.closeButton}
              className={cssStyles.closeButtonHover}
            >
              <CloseIcon />
            </button>

            {/* Modal Header */}
            <div style={styles.header}>
              <div style={styles.headerIcon}>
                {/* Place your Dexetra icon here */}
                <img 
                  src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png" 
                  alt="Dexetra" 
                  style={{ width: '24px', height: '24px' }}
                />
              </div>
              <h2 style={styles.title}>
                Deposit
              </h2>
              <p style={styles.subtitle}>
                Dexetra Balance: ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            {/* Network Warning Banner */}
            <div style={{ padding: '0 20px' }}>
              <NetworkWarningBanner userAddress={walletAddress} />
            </div>

            {/* Payment Method Selector */}
            <div style={styles.paymentSection}>
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  style={{
                    ...(selectedPaymentMethod === method.id ? styles.paymentCardSelected : styles.paymentCard),
                    backgroundColor: '#2a2a2a',
                    border: selectedPaymentMethod === method.id ? '1px solid #00d4aa' : '1px solid #333333',
                    minHeight: '60px',
                    padding: '8px 12px'
                  }}
                  className={cssStyles.paymentCardHover}
                  onClick={() => setSelectedPaymentMethod(method.id)}
                >
                  <div style={styles.paymentCardLeft}>
                    <img 
                      src={method.icon}
                      alt="MetaMask"
                      style={{ width: '30px', height: '30px' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).insertAdjacentHTML('afterend', '<span style="font-size: 18px;">🦊</span>');
                      }}
                    />
                    <div>
                      <div style={{
                        ...designSystem.typography.hierarchy.sectionLabel,
                        marginBottom: '2px'
                      }}>
                        Deposit from
                      </div>
                      <div style={designSystem.typography.hierarchy.primaryText}>{method.name}</div>
                      <div style={designSystem.typography.hierarchy.secondaryText}>{method.description}</div>
                    </div>
                  </div>
                  <div style={styles.paymentCardRight}>
                    <div style={designSystem.typography.hierarchy.amountText}>{method.balance}</div>
                    <div style={styles.paymentIcons}>
                      <svg width="16" height="10" viewBox="0 0 40 24" fill="none">
                        <rect width="40" height="24" rx="4" fill="#1A1F71"/>
                        <text x="20" y="15" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">VISA</text>
                      </svg>
                      <svg width="16" height="10" viewBox="0 0 40 24" fill="none">
                        <rect width="40" height="24" rx="4" fill="#EB001B"/>
                        <circle cx="15" cy="12" r="8" fill="#EB001B"/>
                        <circle cx="25" cy="12" r="8" fill="#FF5F00"/>
                      </svg>
                      <svg width="16" height="10" viewBox="0 0 40 24" fill="none">
                        <rect width="40" height="24" rx="4" fill="#0052FF"/>
                        <text x="20" y="15" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">CB</text>
                      </svg>
                    </div>
                    <div style={{ color: designSystem.colors.text.secondary }}>
                      <ArrowRightIcon />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Token List */}
            <div style={styles.tokenSection}>
              <div style={styles.tokenList} className={cssStyles.tokenListScrollable}>
                {tokens.map((token) => (
                  <div
                    key={token.id}
                    style={{
                      ...(selectedToken === token.id ? styles.tokenCardSelected : styles.tokenCard),
                      backgroundColor: '#2a2a2a',
                      border: selectedToken === token.id ? '1px solid #00d4aa' : '1px solid #333333'
                    }}
                    className={cssStyles.tokenCardHover}
                    onClick={() => setSelectedToken(token.id)}
                  >
                    <div style={styles.tokenCardLeft}>
                      <div className={cssStyles.iconContainer} style={{ position: 'relative' }}>
                        <div style={styles.tokenIcon}>
                          <img 
                            src={token.icon}
                            alt={token.symbol}
                            style={{ 
                              width: '20px', 
                              height: '20px'
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).insertAdjacentHTML('afterend', `<span style="font-size: 16px;">${token.symbol === 'USDC' ? '💵' : token.symbol === 'USDT' ? '💰' : token.symbol === 'DAI' ? '🟡' : '💎'}</span>`);
                            }}
                          />
                        </div>
                        {token.networkIcon && (
                          <div style={styles.networkBadge}>
                            <img 
                              src={token.networkIcon}
                              alt={`${token.network} network`}
                              style={{ 
                                width: '10px', 
                                height: '10px',
                                filter: token.network === 'ethereum' ? 'brightness(0) invert(1)' : 'none'
                              }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                (e.target as HTMLImageElement).insertAdjacentHTML('afterend', `<span style="font-size: 6px;">${token.network === 'ethereum' ? '⟠' : '🔮'}</span>`);
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={designSystem.typography.hierarchy.primaryText}>{token.symbol}</div>
                        <div style={designSystem.typography.hierarchy.secondaryText}>{token.amount}</div>
                      </div>
                    </div>
                    <div style={styles.tokenCardRight}>
                      {token.isLowBalance && (
                        <span
                          style={{
                            ...designSystem.typography.hierarchy.statusText,
                            color: designSystem.colors.status.lowBalance
                          }}
                        >
                          Low Balance
                        </span>
                      )}
                      <div style={designSystem.typography.hierarchy.amountText}>{token.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Continue Button */}
            <button
              onClick={handleContinue}
              style={{
                ...styles.continueButton,
                backgroundColor: '#00d4aa',
                color: '#000000'
              }}
              className={cssStyles.continueButtonHover}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' 
               : !isConnected ? 'Connect Wallet' 
               : 'Continue'}
            </button>
          </div>
        </div>,
        document.body
      )}
      
      <DepositModalInput
        isOpen={showInputModal}
        onClose={handleInputModalClose}
        onBack={handleInputModalBack}
        onContinue={handleInputModalContinue}
        maxBalance={getSelectedTokenBalance()}
        selectedToken={getSelectedTokenInfo()}
        targetToken={getTargetToken()}
        isAnimating={isAnimating}
        animationDirection={animationDirection}
        isDirectDeposit={isDirectDeposit}
        onDirectDeposit={depositCollateral}
        isVaultConnected={isVaultConnected}
      />

      <DepositModalReview
        isOpen={showReviewModal}
        onClose={handleInputModalClose}
        onBack={handleReviewModalBack}
        onConfirm={handleReviewModalConfirm}
        amount={depositAmount}
        sourceToken={getSelectedTokenInfo()}
        targetToken={getTargetToken()}
        estimatedGas="< 1 min"
        exchangeRate={isDirectDeposit ? undefined : `1 ${getSelectedTokenInfo().symbol} = 4,785.00 USDC`}
        isAnimating={isAnimating}
        animationDirection={animationDirection}
        isDirectDeposit={isDirectDeposit}
        isVaultConnected={isVaultConnected}
      />

      <DepositModalStatus
        isOpen={showStatusModal}
        onClose={handleStatusModalClose}
        onNewDeposit={handleNewDeposit}
        status={transactionStatus}
        amount={depositAmount}
        sourceToken={getSelectedTokenInfo()}
        targetToken={getTargetToken()}
        transactionHash={transactionHash}
        estimatedTime="< 1 min"
        actualTime={actualTransactionTime}
        isDirectDeposit={isDirectDeposit}
        walletAddress={walletAddress ? walletAddress.slice(-4) : '9cdb'}
        isAnimating={isAnimating}
        animationDirection={animationDirection}
      />
    </>
  )
} 