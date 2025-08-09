'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { DepositModalReviewProps } from './types'
import { designSystem, styles } from './DepositModal.styles'
import cssStyles from './DepositModal.module.css'
import { liveQuotesService, QuoteDetails, QuoteRefreshState } from '@/lib/liveQuotesService'

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

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const RefreshIcon = ({ isSpinning }: { isSpinning: boolean }) => (
  <svg 
    width="14" 
    height="14" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    style={{ 
      animation: isSpinning ? 'spin 1s linear infinite' : 'none',
      transform: 'rotate(0deg)'
    }}
  >
    <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const TrendUpIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 14L12 9L17 14" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const TrendDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 10L12 15L17 10" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ChevronDownIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg 
    width="14" 
    height="14" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    style={{ 
      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease'
    }}
  >
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Review-specific styles extending the base modal styles
const reviewStyles = {
  ...styles,
  
  // Override modal dimensions for review content
  modal: {
    ...styles.modal,
    height: '680px', // Increased height from 540px to accommodate all content
    maxHeight: '85vh', // Ensure it fits on smaller screens
    overflow: 'hidden' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'flex-start' // Changed from space-between to flex-start
  },
  
  // Header section
  reviewHeader: {
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
  
  // Title section
  reviewTitleSection: {
    textAlign: 'center' as const,
    marginBottom: designSystem.spacing.sectionSpacing,
    flexShrink: 0
  },
  
  reviewTitle: {
    ...designSystem.typography.hierarchy.modalTitle,
    margin: 0,
    marginBottom: '1px'
  },
  
  reviewSubtitle: {
    ...designSystem.typography.hierarchy.modalSubtitle,
    margin: 0
  },

  headerIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '8px'
  },
  
  // Live quote status bar
  quoteStatusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: '6px', // Using 6px instead of small
    padding: '6px 12px',
    marginBottom: '12px',
    border: `1px solid ${designSystem.colors.interactive.border}`,
    fontSize: '11px',
    color: designSystem.colors.text.secondary
  },
  
  quoteStatusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  
  quoteStatusRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  
  countdownBadge: {
    backgroundColor: designSystem.colors.interactive.buttonPrimary,
    color: designSystem.colors.text.primary,
    borderRadius: '10px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: '600'
  },
  
  // Hero amount section
  heroAmountSection: {
    textAlign: 'center' as const,
    marginBottom: '12px',
    padding: '6px 0'
  },
  
  heroAmount: {
    fontSize: '32px',
    fontWeight: 700,
    color: designSystem.colors.text.primary,
    lineHeight: 1.1,
    margin: 0,
    marginBottom: '4px'
  },
  
  heroLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    margin: 0
  },
  
  // Review details container
  reviewContainer: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '8px',
    marginBottom: '12px',
    border: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  // Detail rows
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`,
    marginBottom: 0
  },
  
  detailRowLast: {
    borderBottom: 'none'
  },
  
  detailLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  
  detailValue: {
    ...designSystem.typography.hierarchy.primaryText,
    textAlign: 'right' as const
  },
  
  detailValueWithTrend: {
    ...designSystem.typography.hierarchy.primaryText,
    textAlign: 'right' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '4px'
  },
  
  tokenPair: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  tokenIcon: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px'
  },
  
  warningBadge: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: '500',
    marginLeft: '4px'
  },
  
  successBadge: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: '500',
    marginLeft: '4px'
  },
  
  // Main content container
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    paddingBottom: '16px' // Add padding to separate from button
  },
  
  // Scrollable content area for review details
  scrollableContent: {
    flex: 1,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    paddingRight: '4px', // Space for scrollbar
    marginRight: '-4px' // Compensate for padding
  },
  
  // Button container
  buttonContainer: {
    flexShrink: 0,
    paddingTop: '16px', // Increased from 12px
    marginTop: '8px', // Ensure separation from content
    borderTop: `1px solid ${designSystem.colors.interactive.border}`, // Visual separator
    backgroundColor: designSystem.colors.interactive.cardBackground // Ensure button background using existing color
  },
  
  // Confirm button
  confirmButton: {
    backgroundColor: designSystem.colors.interactive.buttonPrimary,
    color: designSystem.colors.text.primary,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '10px 16px',
    fontSize: '12px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    transition: designSystem.effects.transitions.default,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px'
  },
  
  // Advanced details dropdown
  advancedDetailsToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    color: designSystem.colors.text.secondary,
    border: 'none',
    backgroundColor: 'transparent',
    width: '100%',
    marginTop: '8px'
  },
  
  advancedDetailsContent: {
    overflow: 'hidden' as const,
    transition: 'max-height 0.3s ease, opacity 0.3s ease',
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: '4px',
    marginTop: '8px'
  },
  
  advancedDetailsOpen: {
    maxHeight: '300px',
    opacity: 1
  },
  
  advancedDetailsClosed: {
    maxHeight: '0px',
    opacity: 0
  }
}

export default function DepositModalReview({
  isOpen,
  onClose,
  onBack,
  onConfirm,
  amount = "4.79",
  sourceToken = { symbol: 'ETH', icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/ethereum-eth-logo.png' },
  targetToken = { symbol: 'USDC', icon: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos/usd-coin-usdc-logo.png' },
  estimatedGas = "< 1 min",
  exchangeRate = "1 ETH = 4,785.00 USDC",
  isAnimating = false,
  animationDirection = 'forward',
  isDirectDeposit = false,
  onDirectDeposit,
  isVaultConnected = false
}: DepositModalReviewProps) {
  const [mounted, setMounted] = useState(false)
  const [quoteDetails, setQuoteDetails] = useState<QuoteDetails | null>(null)
  const [refreshState, setRefreshState] = useState<QuoteRefreshState>({
    isRefreshing: false,
    nextRefreshIn: 60,
    lastRefreshTime: Date.now()
  })
  const [isLoadingQuote, setIsLoadingQuote] = useState(true)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [isAdvancedDetailsOpen, setIsAdvancedDetailsOpen] = useState(false)

  // Calculate USD amount from input
  const usdAmount = parseFloat(amount)

  useEffect(() => {
    setMounted(true)
    // For direct deposits, we don't need quotes so set loading to false
    if (isDirectDeposit) {
      setIsLoadingQuote(false)
    }
  }, [isDirectDeposit])

  useEffect(() => {
    if (isOpen) {
      if (typeof window !== 'undefined') {
        (document.body as any).style.overflow = 'hidden'
      }
      // Start auto-refresh when modal opens
      startQuoteRefresh()
    } else {
      if (typeof window !== 'undefined') {
        (document.body as any).style.overflow = 'unset'
      }
    }

    return () => {
      if (typeof window !== 'undefined') {
        (document.body as any).style.overflow = 'unset'
      }
      // Cleanup will be handled by the cleanup function returned from startAutoRefresh
    }
  }, [isOpen])

  // Handle quote refresh - skip for direct deposits
  const startQuoteRefresh = useCallback(() => {
    if (!isOpen || isDirectDeposit) return

    const cleanup = liveQuotesService.startAutoRefresh(
      [sourceToken.symbol, targetToken.symbol],
      async (quotes) => {
        try {
          setIsLoadingQuote(true)
          const details = await liveQuotesService.getDetailedQuote(
            sourceToken.symbol,
            targetToken.symbol,
            usdAmount
          )
          setQuoteDetails(details)
          setQuoteError(null)
        } catch (error) {
          console.error('Error getting quote details:', error)
          setQuoteError('Failed to fetch live quote')
        } finally {
          setIsLoadingQuote(false)
        }
      },
      (state) => {
        setRefreshState(state)
      }
    )

    // Return cleanup function to be called on unmount
    return cleanup
  }, [isOpen, isDirectDeposit, sourceToken.symbol, targetToken.symbol, usdAmount])

  // Initial quote fetch - skip for direct deposits
  useEffect(() => {
    if (!isOpen || !mounted || isDirectDeposit) return

    const fetchInitialQuote = async () => {
      try {
        setIsLoadingQuote(true)
        const details = await liveQuotesService.getDetailedQuote(
          sourceToken.symbol,
          targetToken.symbol,
          usdAmount
        )
        setQuoteDetails(details)
        setQuoteError(null)
      } catch (error) {
        console.error('Error fetching initial quote:', error)
        setQuoteError('Failed to fetch live quote')
      } finally {
        setIsLoadingQuote(false)
      }
    }

    fetchInitialQuote()
  }, [isOpen, mounted, isDirectDeposit, sourceToken.symbol, targetToken.symbol, usdAmount])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleConfirm = async () => {
    // Always delegate to the main modal's confirm handler
    // This ensures the status modal flow works for both direct deposits and swaps
    console.log('📋 Review confirmed, delegating to main modal flow')
    onConfirm()
  }

  // Format price change for display
  const formatPriceChange = (change: number) => {
    const isPositive = change >= 0
    return {
      text: `${isPositive ? '+' : ''}${change.toFixed(2)}%`,
      color: isPositive ? '#22c55e' : '#ef4444',
      icon: isPositive ? <TrendUpIcon /> : <TrendDownIcon />
    }
  }

  // Format countdown display
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!mounted || !isOpen) return null

  // Animation classes for review modal
  const getReviewModalClasses = () => {
    const baseClasses = cssStyles.depositModal
    
    if (!isAnimating) {
      return baseClasses
    }
    
    const animationClass = animationDirection === 'forward' 
      ? cssStyles.modalSlideInFromRight
      : cssStyles.modalSlideOutRight
      
    return `${baseClasses} ${animationClass}`
  }

  return createPortal(
    <>
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={reviewStyles.overlay} onClick={handleBackdropClick}>
        <div 
          style={{
            ...reviewStyles.modal,
            backgroundColor: '#1a1a1a',
            border: '1px solid #333333'
          }} 
          className={getReviewModalClasses()}
        >
          {/* Back Button */}
          <button
            onClick={onBack}
            style={reviewStyles.backButton}
            className={cssStyles.closeButtonHover}
          >
            <BackIcon />
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            style={reviewStyles.closeButton}
            className={cssStyles.closeButtonHover}
          >
            <CloseIcon />
          </button>

          {/* Main Content Container */}
          <div style={reviewStyles.mainContent}>
            {/* Header Section */}
            <div style={reviewStyles.header}>
              <div style={reviewStyles.headerIcon}>
                <img 
                  src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png" 
                  alt="Dexetra" 
                  style={{ width: '24px', height: '24px' }}
                />
              </div>
              <h2 style={reviewStyles.reviewTitle}>
                {isDirectDeposit ? 'Review Vault Deposit' : 'Review Deposit'}
              </h2>
              <p style={reviewStyles.reviewSubtitle}>
                {isDirectDeposit ? 'Direct Deposit' : 'Live Quote'}
              </p>
            </div>

            {/* Scrollable Content Area */}
            <div style={reviewStyles.scrollableContent}>
              {/* Status Bar - Different for direct deposits vs swaps */}
              {isDirectDeposit ? (
                /* Direct Deposit Status Bar */
                <div style={{
                  ...reviewStyles.quoteStatusBar,
                  backgroundColor: '#1a2e1a',
                  border: '1px solid #2d5a2d'
                }}>
                  <div style={reviewStyles.quoteStatusLeft}>
                    <div style={{
                      width: '14px',
                      height: '14px',
                      backgroundColor: '#00d4aa',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '8px',
                      color: '#000'
                    }}>
                      ✓
                    </div>
                    <span style={{ color: '#00d4aa' }}>
                      {isVaultConnected ? 'Ready for direct deposit' : 'Vault connection required'}
                    </span>
                  </div>
                  <div style={reviewStyles.quoteStatusRight}>
                    <span>Estimated time:</span>
                    <div style={{
                      ...reviewStyles.countdownBadge,
                      backgroundColor: '#00d4aa',
                      color: '#000000'
                    }}>
                      {estimatedGas}
                    </div>
                  </div>
                </div>
              ) : (
                /* Live Quote Status Bar */
                <div style={{
                  ...reviewStyles.quoteStatusBar,
                  backgroundColor: '#2a2a2a',
                  border: '1px solid #333333'
                }}>
                  <div style={reviewStyles.quoteStatusLeft}>
                    <RefreshIcon isSpinning={refreshState.isRefreshing || isLoadingQuote} />
                    <span>
                      {isLoadingQuote ? 'Fetching quote...' : 
                       quoteError ? 'Quote unavailable' :
                       'Live quote active'}
                    </span>
                  </div>
                  <div style={reviewStyles.quoteStatusRight}>
                    <span>Next refresh:</span>
                    <div style={{
                      ...reviewStyles.countdownBadge,
                      backgroundColor: '#00d4aa',
                      color: '#000000'
                    }}>
                      {formatCountdown(refreshState.nextRefreshIn)}
                    </div>
                  </div>
                </div>
              )}

              {/* Hero Amount Section */}
              <div style={reviewStyles.heroAmountSection}>
                <h1 style={reviewStyles.heroAmount}>${amount}</h1>
                <p style={reviewStyles.heroLabel}>Total Deposit Amount</p>
              </div>

              {/* Review Details Container */}
              <div style={{
                ...reviewStyles.reviewContainer,
                backgroundColor: '#2a2a2a',
                border: '1px solid #333333'
              }}>
                {/* Source */}
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>Source</span>
                  <div style={reviewStyles.detailValue}>
                    <div style={reviewStyles.tokenPair}>
                      <img 
                        src={sourceToken.icon}
                        alt={sourceToken.symbol}
                        style={{ 
                          width: '16px', 
                          height: '16px',
                          borderRadius: '50%',
                          marginRight: '6px'
                        }}
                      />
                      Wallet (...9cdb)
                    </div>
                  </div>
                </div>

                {/* Destination */}
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>Destination</span>
                  <div style={reviewStyles.detailValue}>
                    <div style={reviewStyles.tokenPair}>
                      {isDirectDeposit ? (targetToken.name || 'Dexetra Vault') : 'Dexetra Wallet'}
                    </div>
                  </div>
                </div>

                {/* You Send */}
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>You send</span>
                  <div style={reviewStyles.detailValue}>
                    <div style={reviewStyles.tokenPair}>
                      <img 
                        src={sourceToken.icon}
                        alt={sourceToken.symbol}
                        style={{ 
                          width: '16px', 
                          height: '16px',
                          borderRadius: '50%',
                          marginRight: '6px'
                        }}
                      />
                      {quoteDetails ? quoteDetails.fromAmount.toFixed(5) : '0.00100'} {sourceToken.symbol}
                    </div>
                  </div>
                </div>

                {/* You Receive */}
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>
                    {isDirectDeposit ? 'Vault credit' : 'You receive'}
                  </span>
                  <div style={reviewStyles.detailValue}>
                    <div style={reviewStyles.tokenPair}>
                      <img 
                        src={targetToken.icon}
                        alt={targetToken.symbol}
                        style={{ 
                          width: '16px', 
                          height: '16px',
                          borderRadius: '50%',
                          marginRight: '6px'
                        }}
                      />
                      {isDirectDeposit 
                        ? `${amount} ${sourceToken.symbol} trading collateral`
                        : `${quoteDetails ? quoteDetails.toAmount.toFixed(2) : usdAmount.toFixed(2)} ${targetToken.symbol}`
                      }
                    </div>
                  </div>
                </div>

                              {/* Exchange Rate - only for swaps */}
              {!isDirectDeposit && exchangeRate && (
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>
                    <InfoIcon />
                    Exchange rate
                  </span>
                  <div style={reviewStyles.detailValueWithTrend}>
                    <span>{quoteDetails ? quoteDetails.exchangeRate : exchangeRate}</span>
                    {quoteDetails && (
                      <>
                        {formatPriceChange(quoteDetails.quote.priceChangePercent24h).icon}
                        <span style={{ color: formatPriceChange(quoteDetails.quote.priceChangePercent24h).color, fontSize: '10px' }}>
                          {formatPriceChange(quoteDetails.quote.priceChangePercent24h).text}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Estimated Gas - for direct deposits */}
              {isDirectDeposit && (
                <div style={reviewStyles.detailRow}>
                  <span style={reviewStyles.detailLabel}>
                    <InfoIcon />
                    Estimated gas
                  </span>
                  <span style={reviewStyles.detailValue}>
                    ~$2.50 (0.001 ETH)
                  </span>
                </div>
              )}

              {/* Estimated Time */}
              <div style={{ ...reviewStyles.detailRow, ...reviewStyles.detailRowLast }}>
                <span style={reviewStyles.detailLabel}>Estimated time</span>
                <span style={reviewStyles.detailValue}>
                  {quoteDetails ? quoteDetails.networkCosts.estimatedTime : estimatedGas}
                </span>
              </div>
              
              {/* Advanced Details Toggle */}
              <button
                style={reviewStyles.advancedDetailsToggle}
                onClick={() => setIsAdvancedDetailsOpen(!isAdvancedDetailsOpen)}
              >
                <span>Advanced Details</span>
                <ChevronDownIcon isOpen={isAdvancedDetailsOpen} />
              </button>

              {/* Advanced Details Content */}
                              <div 
                style={{
                  ...reviewStyles.advancedDetailsContent,
                  backgroundColor: '#2a2a2a',
                  border: '1px solid #333333',
                  ...(isAdvancedDetailsOpen ? reviewStyles.advancedDetailsOpen : reviewStyles.advancedDetailsClosed)
                }}
              >
                <div style={{ padding: '8px' }}>
                  {/* Network Costs */}
                  <div style={reviewStyles.detailRow}>
                    <span style={reviewStyles.detailLabel}>Network costs</span>
                    <span style={reviewStyles.detailValue}>
                      {quoteDetails 
                        ? `~$${quoteDetails.networkCosts.gasFeeUsd.toFixed(2)} (${quoteDetails.networkCosts.gasFee.toFixed(4)} ${sourceToken.symbol})`
                        : '~$7.00 (0.002 ETH)'
                      }
                    </span>
                  </div>

                  {/* Price Impact */}
                  <div style={reviewStyles.detailRow}>
                    <span style={reviewStyles.detailLabel}>Price impact</span>
                    <div style={reviewStyles.detailValue}>
                      <span>{quoteDetails ? `${quoteDetails.priceImpact.toFixed(2)}%` : '0.05%'}</span>
                      {quoteDetails && quoteDetails.priceImpact < 0.1 && (
                        <span style={reviewStyles.successBadge}>Low</span>
                      )}
                      {quoteDetails && quoteDetails.priceImpact >= 0.1 && quoteDetails.priceImpact < 1 && (
                        <span style={reviewStyles.warningBadge}>Medium</span>
                      )}
                    </div>
                  </div>

                  {/* Max Slippage */}
                  <div style={reviewStyles.detailRow}>
                    <span style={reviewStyles.detailLabel}>Max slippage</span>
                    <span style={reviewStyles.detailValue}>
                      {quoteDetails ? `${quoteDetails.maxSlippage.toFixed(1)}%` : '0.5%'}
                    </span>
                  </div>

                  {/* Minimum Received */}
                  <div style={{ ...reviewStyles.detailRow, ...reviewStyles.detailRowLast }}>
                    <span style={reviewStyles.detailLabel}>Minimum received</span>
                    <span style={reviewStyles.detailValue}>
                      {quoteDetails 
                        ? `${quoteDetails.minimumReceived.toFixed(2)} ${targetToken.symbol}`
                        : `${(usdAmount * 0.995).toFixed(2)} ${targetToken.symbol}`
                      }
                    </span>
                  </div>
                </div>
              </div>
              </div>
            </div>

          </div>

          {/* Button Container */}
          <div style={{
            ...reviewStyles.buttonContainer,
            backgroundColor: '#1a1a1a',
            borderTop: '1px solid #333333'
          }}>
            <button
              onClick={handleConfirm}
              style={{
                ...reviewStyles.confirmButton,
                backgroundColor: '#00d4aa',
                color: '#000000',
                ...(isDirectDeposit && !isVaultConnected ? {
                  opacity: 0.5,
                  cursor: 'not-allowed'
                } : {})
              }}
              className={cssStyles.continueButtonHover}
              disabled={
                isDirectDeposit 
                  ? !isVaultConnected 
                  : (isLoadingQuote || !!quoteError)
              }
              title={
                isDirectDeposit && !isVaultConnected 
                  ? 'Vault connection required for direct deposits'
                  : undefined
              }
            >
              <CheckIcon />
              {isDirectDeposit 
                ? (!isVaultConnected ? 'Vault Unavailable' : 'Confirm Deposit')
                : (isLoadingQuote ? 'Getting Quote...' : quoteError ? 'Quote Error' : 'Confirm Order')
              }
            </button>
          </div>
        </div>
      </div>
    </>,
    typeof document !== 'undefined' ? document.body : null as any
  )
} 