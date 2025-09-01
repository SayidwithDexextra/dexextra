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
import { useCentralVault } from '@/hooks/useCentralVault'
import { NetworkWarningBanner } from '@/components/NetworkStatus'
import { CONTRACTS } from '@/lib/contracts'

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
  const [isClosing, setIsClosing] = useState(false)
  
  // Transaction status state
  const [transactionStatus, setTransactionStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [transactionHash, setTransactionHash] = useState<string | undefined>(undefined)
  const [transactionStartTime, setTransactionStartTime] = useState<number>(0)
  const [actualTransactionTime, setActualTransactionTime] = useState<string | undefined>(undefined)

  // Real wallet integration
  const { walletAddress, isConnected, connectWallet, isConnecting } = useWalletAddress()
  const { tokens: portfolioTokens, summary, isLoading: isLoadingPortfolio, error: portfolioError } = useWalletPortfolio(walletAddress)
  
  // Real vault integration
  const { 
    isConnected: isVaultConnected, 
    isLoading: isVaultLoading,
    depositCollateral,
    availableBalance: vaultBalance,
    error: vaultError,
    vaultAddress,
    mockUSDCAddress 
  } = useCentralVault(walletAddress)
  
  // Extract totalValue from V2 summary (convert string to number for legacy compatibility)
  const totalValue = parseFloat(summary.totalValue) || 0

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
    mockUsdc: CONTRACTS.MockUSDC.address   // MOCK_USDC on Polygon (from latest deployment)
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

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 200)
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
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
    
    console.log('🔄 Input modal continue - proceeding to review:', {
      amount: amount || depositAmount,
      selectedToken,
      isDirectDeposit,
      isVaultConnected
    })
    
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
    // Validate that we can perform a real transaction
    // Only require isDirectDeposit - let depositCollateral handle vault connection during execution
    console.log('🔍 Review modal confirm validation:', {
      isDirectDeposit,
      hasDepositCollateral: !!depositCollateral,
      isVaultConnected,
      selectedToken,
      depositAmount
    })
    
    if (!isDirectDeposit || !depositCollateral) {
      console.error('❌ Cannot proceed: Invalid deposit type or deposit function not available')
      setTransactionStatus('error')
      setShowReviewModal(false)
      setShowStatusModal(true)
      return
    }

    // Immediately show status modal with pending state
    setTransactionStartTime(Date.now())
    setTransactionStatus('pending')
    
    // Show status modal immediately - no delay
    setShowReviewModal(false)
    setShowStatusModal(true)

    // Process REAL transaction - no mocks or simulations
    try {
      console.log('🏦 Starting REAL vault deposit:', depositAmount)
      
      // This will perform actual blockchain transaction
      console.log('📞 Calling depositCollateral function...')
      const txHash = await depositCollateral(depositAmount)
      
      console.log('📋 depositCollateral returned:', {
        value: txHash,
        type: typeof txHash,
        length: txHash?.length,
        isString: typeof txHash === 'string'
      })
      
      if (!txHash || typeof txHash !== 'string' || txHash.length === 0) {
        throw new Error(`Transaction failed - invalid transaction hash returned: ${txHash}`)
      }
      
      console.log('✅ Real blockchain deposit completed:', txHash)
      
      // Calculate actual transaction time
      const elapsed = Math.floor((Date.now() - transactionStartTime) / 1000)
      const timeText = elapsed < 60 ? `${elapsed} seconds` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      
      // Set transaction results from real blockchain transaction
      setTransactionHash(txHash)
      setActualTransactionTime(timeText)
      
      // Update to success status only after real transaction confirmation
      setTransactionStatus('success')
      
      console.log('📊 Real transaction completed:', {
        hash: txHash,
        time: timeText,
        amount: depositAmount,
        network: 'Polygon',
        contract: 'CentralVault'
      })
      
    } catch (error) {
      console.error('❌ Real transaction failed:', error)
      
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

  // Check if selected token is the vault collateral token (MOCK_USDC only for real deposits)
  const isVaultCollateralToken = (): boolean => {
    if (!selectedToken) return false
    const token = tokens.find(t => t.id === selectedToken)
    if (!token) return false
    
    // Only MOCK_USDC can be directly deposited to vault (real transactions)
    // Other tokens would require swaps which are not implemented
    return token.symbol === 'MOCK_USDC'
  }

  // Determine if this should be a direct deposit or swap
  const isDirectDeposit = isVaultCollateralToken()

  // Get appropriate target token based on deposit type
  const getTargetToken = () => {
    if (isDirectDeposit && selectedToken) {
      // For MOCK_USDC direct deposits, target is the CentralVault
      return { 
        symbol: 'VAULT', 
        icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png',
        name: 'CentralVault (Polygon)',
        address: CONTRACTS.CentralVault.address
      }
    } else {
      // Non-MOCK_USDC tokens are not supported for direct deposits
      return { 
        symbol: 'USDC', 
        icon: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg',
        name: 'USD Coin (Not Supported)',
        address: CONTRACTS.MockUSDC.address
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden" onClick={handleBackdropClick}>
                {/* Sophisticated Backdrop with Subtle Blur */}
      <div 
        className={`absolute inset-0 transition-all duration-300 backdrop-blur-sm ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      />
          
                    {/* Main Modal Container - Sophisticated Minimal Design */}
          <div 
            className={`group relative z-10 w-full max-w-md transition-all duration-300 transform ${
              isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
            } bg-[#0F0F0F] rounded-xl border border-[#222222] overflow-hidden ${getModalClasses()}`}
            style={{ 
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(20px)',
              maxHeight: 'calc(100vh - 2rem)',
              minHeight: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Sophisticated Header Section */}
            <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Deposit Status Indicator */}
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                
                {/* Dexetra Icon with Sophisticated Styling */}
                <div className="relative group">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
                    style={{
                      background: 'linear-gradient(135deg, rgba(74, 222, 128, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                      boxShadow: '0 8px 32px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                    }}
                  >
                <img 
                  src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png" 
                  alt="Dexetra" 
                      className="w-6 h-6"
                />
              </div>
                  {/* Subtle Ring Effect */}
                  <div className="absolute inset-0 rounded-xl border border-white/10 group-hover:border-white/20 transition-colors duration-200" />
                </div>
                
                {/* Deposit Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                Deposit
                    </span>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      To Vault
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] font-medium text-white">
                      ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Available
                    </span>
                {isVaultConnected && vaultBalance && (
                      <span className="text-[9px] text-green-400">
                    • Vault: {parseFloat(vaultBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                )}
                  </div>
                </div>
              </div>
              
              {/* Close Button with Sophisticated Styling */}
              <button
                onClick={handleClose}
                className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-red-500/10 rounded-lg text-[#808080] hover:text-red-300"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Network Warning Banner */}
            <div className="px-6 py-2">
              <NetworkWarningBanner userAddress={walletAddress} />
            </div>

            {/* Sophisticated Payment Method Selector */}
            <div className="px-6 py-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Payment Source
                </h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  Wallet
                </div>
              </div>
              
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 cursor-pointer ${
                    selectedPaymentMethod === method.id 
                      ? 'border-green-400 bg-green-500/5' 
                      : 'border-[#222222] hover:border-[#333333]'
                  }`}
                  onClick={() => setSelectedPaymentMethod(method.id)}
                >
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Connection Status Indicator */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isConnected ? 'bg-green-400' : 'bg-[#404040]'
                      }`} />
                      
                      {/* Wallet Icon */}
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#1A1A1A] border border-[#333333]">
                    <img 
                      src={method.icon}
                      alt="MetaMask"
                          className="w-5 h-5"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).insertAdjacentHTML('afterend', '<span style="font-size: 14px;">🦊</span>');
                          }}
                        />
                      </div>
                      
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[#808080] mb-0.5">
                        Deposit from
                        </div>
                        <div className="text-[11px] font-medium text-white">
                          {method.name}
                        </div>
                        <div className="text-[10px] text-[#606060]">
                          {method.description}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] font-medium text-white">
                        {method.balance}
                  </div>
                      <svg className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200" viewBox="0 0 24 24" fill="none">
                        <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Sophisticated Token List Section - Contained */}
            <div className={`flex-1 overflow-y-auto px-6 py-3 scrollbar-none ${cssStyles.modalScrollable}`} style={{ minHeight: 0 }}>
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Select Token
                </h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {tokens.length} tokens
                </div>
              </div>
              
              {/* Compact hint for vault deposits */}
              {!selectedToken && (
                <div className="bg-[#0F0F0F] rounded-md border border-green-400/30 mb-2 flex-shrink-0">
                  <div className="flex items-center gap-2 p-2">
                    <div className="w-1 h-1 rounded-full flex-shrink-0 bg-green-400" />
                    <span className="text-[10px] text-green-400">
                      💡 Select MOCK_USDC for direct deposits
                    </span>
                  </div>
                </div>
              )}
              
              {/* Token List - Properly Contained */}
              <div className="space-y-1.5 pb-2">
                {tokens.map((token) => (
                  <div
                    key={token.id}
                    className={`bg-[#0F0F0F] rounded-md border cursor-pointer ${
                      selectedToken === token.id 
                        ? 'border-green-400 bg-green-500/5' 
                        : 'border-[#222222]'
                    }`}
                    onClick={() => setSelectedToken(token.id)}
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Token Status Indicator */}
                        <div className={`w-1 h-1 rounded-full flex-shrink-0 ${
                          token.symbol === 'MOCK_USDC' ? 'bg-green-400' : 
                          token.isLowBalance ? 'bg-yellow-400' : 'bg-blue-400'
                        }`} />
                        
                                                {/* Token Icon with Network Badge - Fixed Overflow */}
                        <div className="relative flex-shrink-0 w-8 h-6 mr-2">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-[#1A1A1A] border border-[#333333] overflow-hidden">
                            <img 
                              src={token.icon}
                              alt={token.symbol}
                              className="w-4 h-4 rounded-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                (e.target as HTMLImageElement).insertAdjacentHTML('afterend', `<span style="font-size: 8px;">${token.symbol === 'USDC' ? '💵' : token.symbol === 'USDT' ? '💰' : token.symbol === 'DAI' ? '🟡' : '💎'}</span>`);
                              }}
                            />
                          </div>
                          {token.networkIcon && (
                            <div className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#0F0F0F] border border-[#333333] flex items-center justify-center overflow-hidden">
                              <img 
                                src={token.networkIcon}
                                alt={`${token.network} network`}
                                className="w-1 h-1 object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).insertAdjacentHTML('afterend', `<span style="font-size: 4px;">${token.network === 'ethereum' ? '⟠' : '🔮'}</span>`);
                                }}
                              />
                            </div>
                          )}
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-white">
                              {token.symbol}
                            </span>
                            {token.symbol === 'MOCK_USDC' && (
                              <div className="text-[8px] text-green-400 bg-green-500/10 px-1 py-0.5 rounded flex-shrink-0">
                                Direct
                              </div>
                            )}
                            {token.isLowBalance && (
                              <div className="text-[8px] text-yellow-400 bg-yellow-500/10 px-1 py-0.5 rounded flex-shrink-0">
                                Low
                              </div>
                            )}
                          </div>
                          <div className="text-[9px] text-[#606060]">
                            {token.amount}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="text-[10px] font-medium text-white text-right">
                          {token.value}
                        </div>
                        <svg className="w-2.5 h-2.5 text-[#404040]" viewBox="0 0 24 24" fill="none">
                          <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sophisticated Continue Button */}
            <div className="px-6 py-4 border-t border-[#1A1A1A] bg-[#0F0F0F] flex-shrink-0">
            <button
              onClick={handleContinue}
                className={`group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border transition-all duration-200 ${
                  isConnecting 
                    ? 'bg-blue-500/20 border-blue-500/50 cursor-wait' 
                    : !isConnected 
                      ? 'bg-blue-500 hover:bg-blue-600 border-blue-500 hover:border-blue-600 hover:scale-105 active:scale-95' 
                      : selectedToken && isVaultCollateralToken()
                        ? 'bg-green-500 hover:bg-green-600 border-green-500 hover:border-green-600 hover:scale-105 active:scale-95'
                        : selectedToken && !isVaultCollateralToken()
                          ? 'bg-red-500/20 border-red-500/50 cursor-not-allowed opacity-50'
                          : 'bg-[#1A1A1A] border-[#333333] cursor-not-allowed opacity-50'
                }`}
                disabled={isConnecting || (selectedToken && !isVaultCollateralToken()) || (!selectedToken && isConnected)}
              title={selectedToken && !isVaultCollateralToken() ? 'Only MOCK_USDC can be deposited to vault' : undefined}
            >
                {/* Status Indicator */}
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isConnecting ? 'bg-blue-400 animate-pulse' :
                  !isConnected ? 'bg-blue-400' :
                  selectedToken && isVaultCollateralToken() ? 'bg-green-400' :
                  selectedToken && !isVaultCollateralToken() ? 'bg-red-400' :
                  'bg-gray-600'
                }`} />
                
                {/* Button Text */}
                <span className="text-[11px] font-medium text-white">
                  {isConnecting ? 'Connecting Wallet...' 
               : !isConnected ? 'Connect Wallet'
               : selectedToken && !isVaultCollateralToken() ? 'Token Not Supported'
                   : selectedToken && isVaultCollateralToken() ? 'Continue to Amount'
                   : 'Select Token to Continue'}
                </span>
                
                {/* Arrow Icon */}
                {((!isConnected || (selectedToken && isVaultCollateralToken())) && !isConnecting) && (
                  <svg className="w-3 h-3 text-white group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                
                {/* Loading Spinner */}
                {isConnecting && (
                  <svg className="w-3 h-3 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
                    <path d="M22 12A10 10 0 0112 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
            </button>
            </div>
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