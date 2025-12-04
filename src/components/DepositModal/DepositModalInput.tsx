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
  isVaultConnected = false,
  availableTokens = [],
  onSelectToken
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
  const [isTokenSelectorOpen, setIsTokenSelectorOpen] = useState(false)

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
        {/* Header - aligned with WalletConnect and design system */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          {/* Back Button - solid control like WalletModal */}
          <button
            onClick={onBack}
            className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" viewBox="0 0 24 24" fill="none">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Title and Brand */}
          <div className="flex items-center gap-3 min-w-0 flex-1 justify-center">
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
                  src="/Dexicon/LOGO-Dexetera-05.svg" 
                  alt="Dexetera" 
                  className="w-5 h-5 opacity-90"
                />
              </div>
            </div>
            <div className="min-w-0 text-center">
              <div className="flex items-center gap-2 justify-center">
                <h2 className="text-sm font-medium text-white tracking-wide uppercase">
                  Vault Deposit
                </h2>
                {isDirectDeposit && (
                  <div className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                    Direct
                  </div>
                )}
              </div>
              <div className="text-[10px] text-[#606060]">
                ${maxBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedToken.symbol} Available
              </div>
            </div>
          </div>

          {/* Close Button - red accent like Wallet modal destructive control */}
          <button
            onClick={onClose}
            className="group flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 border bg-red-500/10 border-red-500/20 hover:bg-red-500/15 hover:border-red-500/30"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-red-400 group-hover:text-red-300 transition-colors duration-200" viewBox="0 0 24 24" fill="none">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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
            className="font-mono"
            placeholder="$0.00"
          />

          {/* Percentage Buttons */}
          <div style={inputStyles.percentageButtons}>
            {percentageOptions.map(({ label, value }) => {
              const isDisabled = maxBalance <= 0
              const isSelected = selectedPercentage === label
              return (
                <button
                  key={label}
                  onClick={() => !isDisabled && handlePercentageClick(value, label)}
                  className={[
                    'px-4 py-2 rounded-xl border transition-all duration-200 text-[11px] font-medium',
                    isSelected ? 'bg-[#2A2A2A] border-[#444444] text-white' : 'bg-[#1A1A1A] border-[#333333] text-white',
                    !isDisabled ? 'hover:bg-[#2A2A2A] hover:border-[#444444]' : 'opacity-50 cursor-not-allowed'
                  ].join(' ')}
                  disabled={isDisabled}
                  title={isDisabled ? 'No balance available' : `Set to ${label} of available balance ($${(maxBalance * value).toFixed(2)})`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Section Header - Route */}
        <div className="px-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Route
            </h4>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {isDirectDeposit ? 'Direct' : 'Swap'}
            </div>
          </div>
        </div>

        {/* Transaction Details Card - WalletModal design pattern */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-xl border border-[#222222] hover:border-[#333333] transition-all duration-200 mx-6">
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-4 h-4 rounded-full overflow-hidden bg-[#0F0F0F] flex items-center justify-center">
                <img
                  src={selectedToken.icon}
                  alt={selectedToken.symbol}
                  className="w-4 h-4 rounded-full"
                  onError={() => {}}
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-medium text-[#808080]">You send</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIsTokenSelectorOpen(true) }}
                className="text-[10px] text-white underline decoration-dotted underline-offset-2 hover:text-[#9CA3AF] transition-colors text-left"
                title="Change token"
              >
                {selectedToken.symbol}
              </button>
              </div>
            </div>

            <svg className="w-4 h-4 text-[#606060]" viewBox="0 0 24 24" fill="none">
              <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-4 h-4 rounded-full overflow-hidden bg-[#0F0F0F] flex items-center justify-center">
                <img
                  src={targetToken.icon}
                  alt={targetToken.symbol}
                  className="w-4 h-4 rounded-full"
                  onError={() => {}}
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-medium text-[#808080]">
                  {isDirectDeposit ? 'Deposited to' : 'You receive'}
                </span>
                <span className="text-[10px] text-white truncate">
                  {isDirectDeposit ? (targetToken.name || targetToken.symbol) : targetToken.symbol}
                </span>
              </div>
            </div>
          </div>
          {/* Expandable details on hover */}
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-3 pb-3 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-2">
                <span className="text-[#606060]">
                  {isDirectDeposit
                    ? 'Direct credit to CoreVault. No swap route.'
                    : `Best route selected automatically for ${selectedToken.symbol} → ${targetToken.symbol}`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Token Selector Modal */}
        {isTokenSelectorOpen && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setIsTokenSelectorOpen(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300" />
            <div 
              className="relative z-10 w-full max-w-sm bg-[#0F0F0F] rounded-xl border border-[#222222] shadow-2xl transform transition-all duration-300"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-[#1A1A1A]">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <h3 className="text-xs font-medium text-white uppercase tracking-wide">Select Token</h3>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {availableTokens?.length || 0}
                  </div>
                </div>
                <button
                  onClick={() => setIsTokenSelectorOpen(false)}
                  className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" viewBox="0 0 24 24" fill="none">
                    <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-2">
                {(availableTokens && availableTokens.length > 0 ? availableTokens : [selectedToken]).map((t) => {
                  const isActive = t.symbol === selectedToken.symbol
                  return (
                    <button
                      key={t.symbol}
                      onClick={() => { onSelectToken && onSelectToken(t); setIsTokenSelectorOpen(false) }}
                      className={[
                        'w-full group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 p-3 flex items-center justify-between',
                        isActive ? 'border-[#333333]' : 'border-[#222222] hover:border-[#333333]'
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-[#404040]'}`} />
                        <div className="w-5 h-5 rounded-full overflow-hidden bg-[#0F0F0F] flex items-center justify-center">
                          <img src={t.icon} alt={t.symbol} className="w-5 h-5 rounded-full" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-white">{t.symbol}</div>
                          <div className="text-[10px] text-[#606060] truncate">{t.name || 'Stablecoin'}</div>
                        </div>
                      </div>
                      <svg className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Additional information for direct deposits */}
        {isDirectDeposit && (
          <div className="mx-6 mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 flex items-start gap-2">
            <div className="w-4 h-4 rounded-full bg-green-400 text-black flex items-center justify-center text-[10px] mt-0.5">✓</div>
            <div className="flex-1">
              <div className="text-[12px] text-green-400 font-medium mb-0.5">Direct CoreVault Deposit</div>
              <div className="text-[11px] text-[#b3b3b3] leading-snug">
                Your {selectedToken.symbol} will be deposited directly to the Dexetera CoreVault as trading collateral.
              </div>
            </div>
          </div>
        )}

        {/* Additional information for swaps */}
        {!isDirectDeposit && (
          <div className="mx-6 mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 flex items-start gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-400 text-white flex items-center justify-center text-[10px] mt-0.5">⇄</div>
            <div className="flex-1">
              <div className="text-[12px] text-blue-400 font-medium mb-0.5">Token Swap Required</div>
              <div className="text-[11px] text-[#b3b3b3] leading-snug">
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