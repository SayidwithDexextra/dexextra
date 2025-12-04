'use client'

import { useState, useEffect } from 'react'
import { DepositModalProps, Token } from './types'
import DepositModalInput from './DepositModalInput'
import DepositModalReview from './DepositModalReview'
import DepositModalStatus from './DepositModalStatus'
import DepositTokenSelect from './DepositTokenSelect'
import DepositExternalInput from './DepositExternalInput'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'
import { useCoreVault } from '@/hooks/useCoreVault'

// Close Icon Component
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function DepositModal({
  isOpen,
  onClose
}: DepositModalProps) {
  const [step, setStep] = useState<'select' | 'input' | 'external' | 'review' | 'processing' | 'success' | 'error'>('select')
  const [depositAmount, setDepositAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)
  const { walletAddress } = useWalletAddress()
  const coreVault = useCoreVault()
  
  // Stablecoins by chain
  const polygonUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Polygon',
    contractAddress: CONTRACT_ADDRESSES.MOCK_USDC
  }
  const polygonUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Polygon'
  }
  const polygonDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Polygon'
  }
  const arbitrumUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Arbitrum'
  }
  const arbitrumUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Arbitrum'
  }
  const arbitrumDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Arbitrum'
  }

  // Ethereum Mainnet
  const ethereumUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Ethereum'
  }
  const ethereumUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Ethereum'
  }
  const ethereumDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Ethereum'
  }

  // Hyperliquid
  const hyperliquidUSDC: Token = {
    symbol: 'USDC',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png',
    name: 'USD Coin',
    decimals: 6,
    chain: 'Hyperliquid'
  }
  const hyperliquidUSDT: Token = {
    symbol: 'USDT',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/tether-usdt-logo.png',
    name: 'Tether USD',
    decimals: 6,
    chain: 'Hyperliquid'
  }
  const hyperliquidDAI: Token = {
    symbol: 'DAI',
    icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/multi-collateral-dai-dai-logo.svg',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'Hyperliquid'
  }

  const availableTokens: Token[] = [
    polygonUSDC, polygonUSDT, polygonDAI,
    arbitrumUSDC, arbitrumUSDT, arbitrumDAI,
    ethereumUSDC, ethereumUSDT, ethereumDAI,
    hyperliquidUSDC, hyperliquidUSDT, hyperliquidDAI
  ]

  const [sourceToken, setSourceToken] = useState<Token>(polygonUSDC)
  
  const vaultToken: Token = {
    symbol: 'VAULT',
    icon: '🏦',
    name: 'Dexetera CoreVault'
  }

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setDepositAmount('');
      setPaymentStatus('pending');
      setError(null);
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


  // Function to handle deposit
  const handleDeposit = async () => {
    if (!depositAmount) return
    
    setStep('processing')
    setPaymentStatus('pending')
    
    try {
      if (!coreVault) {
        throw new Error('Vault contract not initialized')
      }
      
      // Call CoreVault deposit with proper amount formatting
      await coreVault.depositCollateral(depositAmount)
      
      setPaymentStatus('success')
      setStep('success')
      
    } catch (err: any) {
      console.error('Deposit error:', err)
      setPaymentStatus('error')
      setStep('error')
      setError(err.message || 'Failed to process deposit')
    }
  }

  // Close modal
  const handleClose = () => {
    onClose()
  }
  
  if (!isOpen) return null

  // Delegate rendering to sub-modals which already implement the Sophisticated Minimal Design System
  if (step === 'select') {
    return (
      <DepositTokenSelect
        isOpen={isOpen}
        onClose={handleClose}
        availableTokens={availableTokens}
        selectedToken={sourceToken}
        onSelectToken={(t) => setSourceToken(t)}
        onContinue={() => {
          if ((sourceToken?.chain || '').toLowerCase() === 'hyperliquid') {
            setStep('input')
          } else {
            setStep('external')
          }
        }}
      />
    )
  }

  if (step === 'external') {
    return (
      <DepositExternalInput
        isOpen={isOpen}
        onClose={handleClose}
        onBack={() => setStep('select')}
        selectedToken={sourceToken}
      />
    )
  }

  if (step === 'input') {
    return (
      <DepositModalInput
        isOpen={isOpen}
        onClose={handleClose}
        onBack={() => setStep('select')}
        onContinue={(amount) => {
          setDepositAmount(amount);
          setStep('review');
        }}
        maxBalance={1000}
        selectedToken={sourceToken}
        targetToken={vaultToken}
        isDirectDeposit={true}
        isVaultConnected={true}
        availableTokens={availableTokens}
        onSelectToken={(t: Token) => setSourceToken(t)}
      />
    )
  }

  if (step === 'review') {
    return (
      <DepositModalReview
        isOpen={isOpen}
        onClose={handleClose}
        onBack={() => setStep('input')}
        onConfirm={handleDeposit}
        amount={depositAmount}
        sourceToken={sourceToken}
        targetToken={vaultToken}
        isDirectDeposit={true}
      />
    )
  }

  return (
    <DepositModalStatus
      isOpen={isOpen}
      onClose={handleClose}
      onNewDeposit={() => {
        setStep('input');
        setDepositAmount('');
      }}
      status={paymentStatus}
      amount={depositAmount}
      sourceToken={sourceToken}
      targetToken={vaultToken}
      isDirectDeposit={true}
    />
  )
} 