'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DepositModalInputProps } from './types'
import { designSystem, styles } from './DepositModal.styles'
import cssStyles from './DepositModal.module.css'

// Icon Components
const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Extended styles for input modal - using original modal styles + input-specific styles
const inputStyles = {
  ...styles, // Import base styles from original modal
  
  // Override header for navigation
  inputHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: designSystem.spacing.sectionSpacing,
    padding: '0',
    flexShrink: 0,
    paddingTop: '16px',
    paddingBottom: '12px',
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  // Navigation buttons
  backButton: {
    position: 'absolute' as const,
    top: '12px',
    left: '12px',
    width: '24px',
    height: '24px',
    color: designSystem.colors.text.secondary,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: designSystem.effects.transitions.default
  },
  
  // Title section for input modal
  inputTitleSection: {
    textAlign: 'center' as const,
    marginBottom: designSystem.spacing.sectionSpacing,
    flexShrink: 0
  },
  
  inputTitle: {
    ...designSystem.typography.hierarchy.modalTitle,
    margin: 0,
    marginBottom: '1px'
  },
  
  inputSubtitle: {
    ...designSystem.typography.hierarchy.modalSubtitle,
    margin: 0
  },

  headerIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '8px'
  },
  
  // Large amount input section
  amountSection: {
    textAlign: 'center' as const,
    marginBottom: designSystem.spacing.sectionSpacing,
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center'
  },
  
  amountInput: {
    background: 'transparent',
    border: 'none',
    color: designSystem.colors.text.primary,
    fontSize: '36px',
    fontWeight: '600',
    textAlign: 'center' as const,
    outline: 'none',
    width: '100%',
    marginBottom: '16px',
    lineHeight: 1,
    maxWidth: '300px',
    fontFamily: 'inherit'
  },
  
  // Percentage buttons
  percentageButtons: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginBottom: designSystem.spacing.sectionSpacing,
    flexWrap: 'wrap' as const
  },
  
  percentageButton: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    color: designSystem.colors.text.primary,
    padding: '8px 12px',
    borderRadius: designSystem.effects.borderRadius.medium,
    fontSize: '11px',
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    minWidth: '50px',
    transition: designSystem.effects.transitions.default
  },
  
  percentageButtonActive: {
    backgroundColor: designSystem.colors.interactive.buttonPrimary,
    color: designSystem.colors.text.primary
  },
  
  // Token swap card
  tokenSwapCard: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: designSystem.spacing.cardPadding,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: designSystem.spacing.sectionSpacing,
    flexShrink: 0
  },
  
  tokenInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  tokenIcon: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden' as const
  },
  
  tokenText: {
    display: 'flex',
    flexDirection: 'column' as const
  },
  
  tokenLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    marginBottom: '1px'
  },
  
  tokenSymbol: {
    ...designSystem.typography.hierarchy.primaryText
  },
  
  arrow: {
    color: designSystem.colors.text.secondary
  }
}

export default function DepositModalInput({ 
  isOpen, 
  onClose, 
  onBack, 
  onContinue,
  maxBalance = 1000,
  selectedToken = { symbol: 'POL', icon: '🔮' },
  targetToken = { symbol: 'USDC', icon: '💵' },
  isAnimating = false,
  animationDirection = 'forward',
  isDirectDeposit = false,
  onDirectDeposit,
  isVaultConnected = false
}: DepositModalInputProps) {
  // Set intelligent default amount based on available balance
  const getDefaultAmount = () => {
    if (maxBalance <= 0) return '0.00'
    if (maxBalance < 10) return maxBalance.toFixed(2)
    return '1.00'
  }

  const [amount, setAmount] = useState<string>(getDefaultAmount())
  const [selectedPercentage, setSelectedPercentage] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const amountInputRef = useRef<HTMLInputElement>(null)

  // Update amount when maxBalance changes
  useEffect(() => {
    setAmount(getDefaultAmount())
    setSelectedPercentage(null)
  }, [maxBalance])

  const percentageOptions = [
    { label: '25%', value: 0.25 },
    { label: '50%', value: 0.5 },
    { label: '75%', value: 0.75 },
    { label: 'Max', value: 1.0 }
  ]

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      // Focus the amount input when modal opens
      setTimeout(() => {
        amountInputRef.current?.focus()
      }, 100)
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handlePercentageClick = (percentage: number, label: string) => {
    // Handle case where maxBalance is 0 or very low
    if (maxBalance <= 0) {
      setAmount('0.00')
      setSelectedPercentage(label)
      return
    }
    
    const calculatedAmount = (maxBalance * percentage).toFixed(2)
    setAmount(calculatedAmount)
    setSelectedPercentage(label)
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // Allow only numbers and decimal point
    if (/^\d*\.?\d*$/.test(value)) {
      const numericValue = parseFloat(value)
      
      // Prevent entering amount greater than available balance
      if (maxBalance > 0 && numericValue > maxBalance) {
        setAmount(maxBalance.toFixed(2))
      } else {
        setAmount(value)
      }
      setSelectedPercentage(null) // Clear percentage selection when manually typing
    }
  }

  const handleContinue = async () => {
    const numericAmount = parseFloat(amount)
    
    // Validate amount before continuing
    if (numericAmount <= 0) {
      console.log('Amount must be greater than 0')
      return
    }
    
    if (maxBalance > 0 && numericAmount > maxBalance) {
      console.log('Amount cannot exceed available balance')
      return
    }
    
    console.log('Continue with amount:', amount, 'Direct deposit:', isDirectDeposit)
    
    // Always proceed to review modal (whether direct deposit or swap)
    if (onContinue) {
      onContinue(amount)
    } else {
      onClose()
    }
  }

  if (!mounted || !isOpen) return null

  // Animation classes for input modal
  const getInputModalClasses = () => {
    const baseClasses = cssStyles.depositModal
    
    if (!isAnimating) {
      return baseClasses
    }
    
    const animationClass = animationDirection === 'forward' 
      ? cssStyles.modalSlideInFromRight  // Coming from right
      : cssStyles.modalSlideOutRight     // Going to right
      
    return `${baseClasses} ${animationClass}`
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
      {/* Sophisticated Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm" style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }} />
      
      {/* Input Modal with Sophisticated Design */}
      <div 
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] transition-all duration-200 ${getInputModalClasses()}`}
        style={{ 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Sophisticated Header Section */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          {/* Back Button */}
          <button
            onClick={onBack}
            className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-blue-500/10 rounded-lg text-[#808080] hover:text-blue-300"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="flex items-center gap-3 min-w-0 flex-1 justify-center">
            {/* Amount Status Indicator */}
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            
            <div className="relative group">
              <div 
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, rgba(74, 222, 128, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                  boxShadow: '0 8px 32px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                <img 
                  src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png" 
                  alt="Dexetera" 
                  className="w-5 h-5"
                />
              </div>
            </div>
            
            {/* Amount Info */}
            <div className="text-center">
              <div className="flex items-center gap-2 justify-center">
                <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  {isDirectDeposit ? 'Vault Deposit' : 'Amount'}
                </span>
                {isDirectDeposit && (
                  <div className="text-[9px] text-green-400 bg-green-500/10 px-1 py-0.5 rounded">
                    Direct
                  </div>
                )}
              </div>
              <div className="text-[10px] text-[#606060] mt-0.5">
                ${maxBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedToken.symbol} Available
              </div>
            </div>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-red-500/10 rounded-lg text-[#808080] hover:text-red-300"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Amount Input Section */}
        <div style={inputStyles.amountSection}>
          <input
            ref={amountInputRef}
            type="text"
            value={`$${amount}`}
            onChange={(e) => handleAmountChange({ 
              ...e, 
              target: { ...e.target, value: e.target.value.replace('$', '') } 
            })}
            style={inputStyles.amountInput}
            placeholder="$0.00"
          />

          {/* Percentage Buttons */}
          <div style={inputStyles.percentageButtons}>
            {percentageOptions.map(({ label, value }) => {
              const isDisabled = maxBalance <= 0
              const buttonStyle = {
                ...inputStyles.percentageButton,
                backgroundColor: selectedPercentage === label ? '#00d4aa' : '#2a2a2a',
                color: selectedPercentage === label ? '#000000' : '#ffffff',
                border: '1px solid #333333',
                ...(isDisabled ? { 
                  opacity: 0.5, 
                  cursor: 'not-allowed',
                  backgroundColor: '#2a2a2a'
                } : {})
              }
              
              return (
                <button
                  key={label}
                  onClick={() => !isDisabled && handlePercentageClick(value, label)}
                  style={buttonStyle}
                  className={!isDisabled ? cssStyles.continueButtonHover : ''}
                  disabled={isDisabled}
                  title={isDisabled ? 'No balance available' : `Set to ${label} of available balance ($${(maxBalance * value).toFixed(2)})`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Transaction Details Card - Always render, different content for direct deposit vs swap */}
        <div style={{
          ...inputStyles.tokenSwapCard,
          backgroundColor: '#2a2a2a',
          border: '1px solid #333333'
        }}>
          <div style={inputStyles.tokenInfo}>
            <div style={inputStyles.tokenIcon}>
              <img 
                src={selectedToken.icon}
                alt={selectedToken.symbol}
                style={{ 
                  width: '20px', 
                  height: '20px',
                  borderRadius: '50%'
                }}
                onError={(e) => {
                  console.log('Failed to load token icon:', selectedToken.icon);
                }}
              />
            </div>
            <div style={inputStyles.tokenText}>
              <div style={inputStyles.tokenLabel}>You send</div>
              <div style={inputStyles.tokenSymbol}>{selectedToken.symbol}</div>
            </div>
          </div>

          <div style={inputStyles.arrow}>
            <ArrowRightIcon />
          </div>

          <div style={inputStyles.tokenInfo}>
            <div style={inputStyles.tokenIcon}>
              <img 
                src={targetToken.icon}
                alt={targetToken.symbol}
                style={{ 
                  width: '20px', 
                  height: '20px',
                  borderRadius: '50%'
                }}
                onError={(e) => {
                  console.log('Failed to load token icon:', targetToken.icon);
                }}
              />
            </div>
            <div style={inputStyles.tokenText}>
              <div style={inputStyles.tokenLabel}>
                {isDirectDeposit ? 'Deposited to' : 'You receive'}
              </div>
              <div style={inputStyles.tokenSymbol}>
                {isDirectDeposit ? (targetToken.name || targetToken.symbol) : targetToken.symbol}
              </div>
            </div>
          </div>
        </div>

        {/* Additional information for direct deposits */}
        {isDirectDeposit && (
          <div style={{
            backgroundColor: '#1a2e1a',
            border: '1px solid #2d5a2d',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              backgroundColor: '#00d4aa',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: '#000'
            }}>
              ✓
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '12px',
                color: '#00d4aa',
                fontWeight: 500,
                marginBottom: '2px'
              }}>
                Direct CoreVault Deposit
              </div>
              <div style={{
                fontSize: '11px',
                color: '#b3b3b3',
                lineHeight: 1.3
              }}>
                Your {selectedToken.symbol} will be deposited directly to the Dexetera CoreVault as trading collateral.
              </div>
            </div>
          </div>
        )}

        {/* Additional information for swaps */}
        {!isDirectDeposit && (
          <div style={{
            backgroundColor: '#1a1a2e',
            border: '1px solid #2d2d5a',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              backgroundColor: '#4a9eff',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: '#fff'
            }}>
              ⇄
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '12px',
                color: '#4a9eff',
                fontWeight: 500,
                marginBottom: '2px'
              }}>
                Token Swap Required
              </div>
              <div style={{
                fontSize: '11px',
                color: '#b3b3b3',
                lineHeight: 1.3
              }}>
                Your {selectedToken.symbol} will be swapped to {targetToken.symbol} before depositing to the vault.
              </div>
            </div>
          </div>
        )}

        {/* Sophisticated Continue Button */}
        <div className="px-6 py-4 border-t border-[#1A1A1A] bg-[#0F0F0F]">
          <button
            onClick={handleContinue}
            className={`group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border transition-all duration-200 ${
              parseFloat(amount) > 0 && parseFloat(amount) <= maxBalance && maxBalance > 0
                ? 'bg-green-500 hover:bg-green-600 border-green-500 hover:border-green-600 hover:scale-105 active:scale-95'
                : 'bg-[#1A1A1A] border-[#333333] cursor-not-allowed opacity-50'
            }`}
            disabled={
              parseFloat(amount) <= 0 || 
              (maxBalance > 0 && parseFloat(amount) > maxBalance) ||
              maxBalance <= 0
            }
          >
            {/* Status Indicator */}
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              parseFloat(amount) > 0 && parseFloat(amount) <= maxBalance && maxBalance > 0
                ? 'bg-green-400' : 'bg-gray-600'
            }`} />
            
            {/* Button Text */}
            <span className="text-[11px] font-medium text-white">
              Continue to Review
            </span>
            
            {/* Arrow Icon */}
            {parseFloat(amount) > 0 && parseFloat(amount) <= maxBalance && maxBalance > 0 && (
              <svg className="w-3 h-3 text-white group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
} 