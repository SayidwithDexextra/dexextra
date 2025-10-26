'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  onClose
}: DepositModalProps) {
  const [step, setStep] = useState<'input' | 'review' | 'processing' | 'success' | 'error'>('input')
  const [depositAmount, setDepositAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)
  const { walletAddress } = useWalletAddress()
  const coreVault = useCoreVault()
  
  // Status indicator classes based on current state
  const getStatusDotClass = (step: string) => {
    switch (step) {
      case 'processing':
        return cssStyles.statusDotPending
      case 'success':
        return cssStyles.statusDotSuccess
      case 'error':
        return cssStyles.statusDotError
      default:
        return ''
    }
  }
  const statusDotClass = getStatusDotClass(step)
  
  const mockUSDC: Token = {
    symbol: 'USDC',
    icon: '💵',
    name: 'USD Coin',
    amount: '0.00',
    value: '0.00',
    contractAddress: CONTRACT_ADDRESSES.MOCK_USDC,
    decimals: 6
  }
  
  const vaultToken: Token = {
    symbol: 'VAULT',
    icon: '🏦',
    name: 'Dexetera CoreVault'
  }

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('input');
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
  
  return createPortal(
    <div className={`${cssStyles.modalOverlay} ${isOpen ? cssStyles.visible : cssStyles.hidden}`}>
      <div className={cssStyles.modalContainer}>
        <div className={`${cssStyles.modal} ${isOpen ? cssStyles.visible : cssStyles.hidden}`}>
          {/* Status Indicator */}
          {step !== 'input' && (
            <div className="flex items-center gap-2 absolute top-2 right-2">
              <div className={statusDotClass} />
              {step === 'processing' && (
                <div className={cssStyles.statusProgress}>
                  <div className={cssStyles.statusProgressBar} style={{ width: '60%' }} />
                </div>
              )}
            </div>
          )}
          
          {/* Modal Content */}
          {step === 'input' && (
            <DepositModalInput
              isOpen={isOpen}
              onClose={handleClose}
              onBack={handleClose}
              onContinue={(amount) => {
                setDepositAmount(amount);
                setStep('review');
              }}
              maxBalance={1000}
              selectedToken={mockUSDC}
              targetToken={vaultToken}
              isDirectDeposit={true}
              isVaultConnected={true}
            />
          )}
          
          {step === 'review' && (
            <DepositModalReview
              isOpen={isOpen}
              onClose={handleClose}
              onBack={() => setStep('input')}
              onConfirm={handleDeposit}
              amount={depositAmount}
              sourceToken={mockUSDC}
              targetToken={vaultToken}
              isDirectDeposit={true}
            />
          )}
          
          {(step === 'processing' || step === 'success' || step === 'error') && (
            <DepositModalStatus
              isOpen={isOpen}
              onClose={handleClose}
              onNewDeposit={() => {
                setStep('input');
                setDepositAmount('');
              }}
              status={paymentStatus}
              amount={depositAmount}
              sourceToken={mockUSDC}
              targetToken={vaultToken}
              isDirectDeposit={true}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
} 