// This is a partial update focusing only on the useWalletPortfolio hook usage

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
import { useCoreVault } from '@/hooks/useCoreVault'
import { NetworkWarningBanner } from '@/components/NetworkStatus'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'

// Close Icon Component
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function DepositModal({
  isOpen,
  onClose,
  onSuccessfulDeposit
}: DepositModalProps) {
  const [step, setStep] = useState('input') // 'input' | 'review' | 'processing' | 'success' | 'error'
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [isReviewing, setIsReviewing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wallet')
  const [paymentStatus, setPaymentStatus] = useState<'processing' | 'success' | 'error' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { walletAddress } = useWalletAddress() // Extract walletAddress from the hook result
  const coreVault = useCoreVault()
  
  // Get wallet portfolio data
  const portfolioData = useWalletPortfolio(walletAddress || undefined)
  const portfolioTokens = portfolioData.tokens || []
  const refreshPortfolio = portfolioData.refreshPortfolio || (() => {})

  // Show animation when opening/closing
  useEffect(() => {
    if (isOpen) {
      setModalVisible(true)
    } else {
      const timeout = setTimeout(() => {
        setModalVisible(false)
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Add a delay before resetting state to allow animation to finish
      const timeout = setTimeout(() => {
        setStep('input')
        setSelectedToken(null)
        setDepositAmount('')
        setIsReviewing(false)
        setPaymentStatus(null)
        setError(null)
      }, 500)
      return () => clearTimeout(timeout)
    }
  }, [isOpen])

  // Disable scrolling on body when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // List of payment methods
  const paymentMethods = [
    {
      id: 'wallet',
      name: 'Wallet',
      description: 'Direct deposit from connected wallet',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/wallet.png'
    },
    {
      id: 'metamask',
      name: 'MetaMask',
      description: 'Pay with MetaMask',
      icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//MetaMask_Fox.svg.png'
    }
  ]

  // Fetch live balances for all stablecoins from portfolio data
  const stablecoinAddresses = {
    // Note: Only MockUSDC is supported for direct deposits on HyperLiquid Testnet
    usdt: '0x0000000000000000000000000000000000000000',
    usdc: '0x0000000000000000000000000000000000000000',  
    dai: '0x0000000000000000000000000000000000000000',
    mockUsdc: CONTRACT_ADDRESSES.MOCK_USDC || '0x69bfB7DAB0135fB6cD3387CF411624d874B3c799'
  }
  
  const findTokenByAddress = (address: string) => {
    // Add null check for portfolioTokens
    if (!portfolioTokens || !Array.isArray(portfolioTokens)) {
      console.warn('Portfolio tokens is undefined or not an array');
      return null;
    }
    
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
      balance: usdtToken?.balance || '0',
      decimals: usdtToken?.decimals || 6,
      contractAddress: stablecoinAddresses.usdt,
      logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether.png',
      isTestnet: false
    },
    {
      id: 'usdc',
      symbol: 'USDC',
      name: usdcToken?.name || 'USD Coin',
      amount: usdcToken?.amount || '0.00 USDC',
      balance: usdcToken?.balance || '0',
      decimals: usdcToken?.decimals || 6,
      contractAddress: stablecoinAddresses.usdc,
      logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc.svg',
      isTestnet: false
    },
    {
      id: 'dai',
      symbol: 'DAI',
      name: daiToken?.name || 'Dai Stablecoin',
      amount: daiToken?.amount || '0.00 DAI',
      balance: daiToken?.balance || '0',
      decimals: daiToken?.decimals || 18,
      contractAddress: stablecoinAddresses.dai,
      logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/dai.png',
      isTestnet: false
    },
    {
      id: 'mockUsdc',
      symbol: 'mockUSDC',
      name: mockUSDCToken?.name || 'Mock USD Coin (Test)',
      amount: mockUSDCToken?.amount || '0.00 mockUSDC',
      balance: mockUSDCToken?.balance || '0',
      decimals: mockUSDCToken?.decimals || 6,
      contractAddress: stablecoinAddresses.mockUsdc,
      logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usdc-test.png',
      isTestnet: true
    }
  ]

  // Default to first token if none selected
  useEffect(() => {
    if (!selectedToken && tokens.length > 0) {
      // Default to MockUSDC for testnet
      const testToken = tokens.find(t => t.isTestnet) || tokens[0]
      setSelectedToken(testToken)
    }
  }, [tokens, selectedToken])

  // Function to handle deposit
  const handleDeposit = async () => {
    if (!selectedToken || !depositAmount) return
    
    setStep('processing')
    setPaymentStatus('processing')
    
    try {
      // For real deployment, handle different token deposits differently
      // For now, assume it's MockUSDC for testnet
      if (!coreVault) {
        throw new Error('Vault contract not initialized')
      }
      
      // Parse amount based on token decimals (default to 6 for USDC)
      const decimals = selectedToken.decimals || 6
      const parsedAmount = parseFloat(depositAmount) * Math.pow(10, decimals)
      
      const result = await coreVault.depositCollateral(parsedAmount)
      
      console.log('Deposit transaction:', result)
      
      // Wait for transaction to be mined
      const receipt = await result.wait()
      console.log('Transaction receipt:', receipt)
      
      setPaymentStatus('success')
      setStep('success')
      
      // Refresh portfolio data after successful deposit
      if (typeof refreshPortfolio === 'function') {
        refreshPortfolio()
      }
      
      // Notify parent component of successful deposit
      if (onSuccessfulDeposit) {
        onSuccessfulDeposit(selectedToken, depositAmount)
      }
    } catch (err: any) {
      console.error('Deposit error:', err)
      setPaymentStatus('error')
      setStep('error')
      setError(err.message || 'Failed to process deposit')
    }
  }

  // Review deposit
  const handleReviewDeposit = () => {
    setIsReviewing(true)
    setStep('review')
  }
  
  // Return to deposit input
  const handleBackToInput = () => {
    setIsReviewing(false)
    setStep('input')
  }
  
  // Try deposit again after error
  const handleTryAgain = () => {
    setStep('input')
    setPaymentStatus(null)
    setError(null)
  }
  
  // Close modal
  const handleClose = () => {
    onClose()
  }

  // Helper to format currency
  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount)
    if (isNaN(num)) return '0.00'
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
  
  // Get deposit value in USD (for stablecoins it's 1:1)
  const getDepositValueUSD = () => {
    if (!depositAmount) return '0.00'
    return formatCurrency(depositAmount)
  }
  
  if (!modalVisible) return null
  
  return createPortal(
    <div className={`${cssStyles.modalOverlay} ${isOpen ? cssStyles.visible : cssStyles.hidden}`}>
      <div className={cssStyles.modalContainer}>
        <div className={`${cssStyles.modal} ${isOpen ? cssStyles.visible : cssStyles.hidden}`}>
          
          {/* Modal Header */}
          <div className={cssStyles.modalHeader}>
            <h2>{step === 'input' ? 'Deposit Funds' : 
                 step === 'review' ? 'Review Deposit' :
                 step === 'processing' ? 'Processing Deposit' :
                 step === 'success' ? 'Deposit Successful' : 'Deposit Failed'}</h2>
            <button className={cssStyles.closeButton} onClick={handleClose} aria-label="Close">
              <CloseIcon />
              </button>
            </div>

          {/* Network Warning */}
          <NetworkWarningBanner />
          
          {/* Modal Content - Different views based on step */}
          <div className={cssStyles.modalContent}>
            {step === 'input' && (
              <DepositModalInput
                tokens={tokens}
                selectedToken={selectedToken}
                onSelectToken={setSelectedToken}
                depositAmount={depositAmount}
                onChangeAmount={setDepositAmount}
                paymentMethods={paymentMethods}
                selectedPaymentMethod={paymentMethod}
                onSelectPaymentMethod={setPaymentMethod}
                onContinue={handleReviewDeposit}
              />
            )}
            
            {step === 'review' && (
              <DepositModalReview
                token={selectedToken!}
                amount={depositAmount}
                valueUSD={getDepositValueUSD()}
                paymentMethod={paymentMethods.find(pm => pm.id === paymentMethod)!}
                onBack={handleBackToInput}
                onConfirm={handleDeposit}
              />
            )}
            
            {(step === 'processing' || step === 'success' || step === 'error') && (
              <DepositModalStatus
                status={paymentStatus!}
                token={selectedToken!}
                amount={depositAmount}
                valueUSD={getDepositValueUSD()}
                error={error}
                onClose={handleClose}
                onTryAgain={handleTryAgain}
              />
                            )}
                          </div>
            </div>
          </div>
        </div>,
        document.body
  )
} 