'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { DepositModalReviewProps } from './types'
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
    className={isSpinning ? 'animate-spin' : ''}
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
    className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
  >
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
      {/* Sophisticated Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm bg-black/30" />
      
      {/* Review Modal with Sophisticated Design */}
      <div 
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] transition-all duration-200 ${getReviewModalClasses()}`}
        style={{ 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Sophisticated Header Section with Navigation */}
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
            {/* Review Status Indicator */}
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
            
            {/* Dexetra Icon */}
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
                  alt="Dexetra" 
                  className="w-5 h-5"
                />
              </div>
            </div>
            
            {/* Review Info */}
            <div className="text-center">
              <div className="flex items-center gap-2 justify-center">
                <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  {isDirectDeposit ? 'Vault Review' : 'Quote Review'}
                </span>
                {isDirectDeposit && (
                  <div className="text-[9px] text-green-400 bg-green-500/10 px-1 py-0.5 rounded">
                    Direct
                  </div>
                )}
              </div>
              <div className="text-[10px] text-[#606060] mt-0.5">
                Final confirmation step
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

        {/* Scrollable Content Area */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 scrollbar-none ${cssStyles.reviewScrollable}`}>
          {/* Status Bar using Design System Pattern */}
          {isDirectDeposit ? (
            /* Direct Deposit Status Bar */
            <div className="group bg-[#0F0F0F] rounded-md border border-green-500/20 transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-green-400">
                      {isVaultConnected ? 'Ready for direct deposit' : 'Preparing deposit...'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#606060]">Estimated time:</span>
                  <div className="text-[10px] text-[#606060] bg-green-500/10 px-1.5 py-0.5 rounded">
                    {estimatedGas}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Live Quote Status Bar */
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <RefreshIcon isSpinning={refreshState.isRefreshing || isLoadingQuote} />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      {isLoadingQuote ? 'Fetching quote...' : 
                       quoteError ? 'Quote unavailable' :
                       'Live quote active'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#606060]">Next refresh:</span>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {formatCountdown(refreshState.nextRefreshIn)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hero Amount Section */}
          <div className="text-center py-4">
            <h1 className="text-3xl font-bold text-white mb-1">${amount}</h1>
            <p className="text-[11px] font-medium text-[#808080]">Total Deposit Amount</p>
          </div>

          {/* Transaction Details using Design System Patterns */}
          <div className="space-y-3">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Transaction Details
              </h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {isDirectDeposit ? 'Direct' : 'Swap'}
              </div>
            </div>

            {/* Source */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                  <span className="text-[11px] font-medium text-[#808080]">Source</span>
                </div>
                <div className="flex items-center gap-2">
                  <img 
                    src={sourceToken.icon}
                    alt={sourceToken.symbol}
                    className="w-4 h-4 rounded-full"
                  />
                  <span className="text-[10px] text-white">Wallet (...9cdb)</span>
                </div>
              </div>
            </div>

            {/* Destination */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                  <span className="text-[11px] font-medium text-[#808080]">Destination</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white">
                    {isDirectDeposit ? (targetToken.name || 'Dexetra Vault') : 'Dexetra Wallet'}
                  </span>
                </div>
              </div>
            </div>

            {/* You Send */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                  <span className="text-[11px] font-medium text-[#808080]">You send</span>
                </div>
                <div className="flex items-center gap-2">
                  <img 
                    src={sourceToken.icon}
                    alt={sourceToken.symbol}
                    className="w-4 h-4 rounded-full"
                  />
                  <span className="text-[10px] text-white font-mono">
                    {quoteDetails ? quoteDetails.fromAmount.toFixed(5) : '0.00100'} {sourceToken.symbol}
                  </span>
                </div>
              </div>
            </div>

            {/* You Receive */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                  <span className="text-[11px] font-medium text-[#808080]">
                    {isDirectDeposit ? 'Vault credit' : 'You receive'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <img 
                    src={targetToken.icon}
                    alt={targetToken.symbol}
                    className="w-4 h-4 rounded-full"
                  />
                  <span className="text-[10px] text-white font-mono">
                    {isDirectDeposit 
                      ? `${amount} ${sourceToken.symbol} trading collateral`
                      : `${quoteDetails ? quoteDetails.toAmount.toFixed(2) : usdAmount.toFixed(2)} ${targetToken.symbol}`
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Exchange Rate - only for swaps */}
            {!isDirectDeposit && exchangeRate && (
              <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                <div className="flex items-center justify-between p-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <InfoIcon />
                    <span className="text-[11px] font-medium text-[#808080]">Exchange rate</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white">{quoteDetails ? quoteDetails.exchangeRate : exchangeRate}</span>
                    {quoteDetails && (
                      <>
                        {formatPriceChange(quoteDetails.quote.priceChangePercent24h).icon}
                        <span 
                          className="text-[9px]"
                          style={{ color: formatPriceChange(quoteDetails.quote.priceChangePercent24h).color }}
                        >
                          {formatPriceChange(quoteDetails.quote.priceChangePercent24h).text}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Estimated Gas - for direct deposits */}
            {isDirectDeposit && (
              <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                <div className="flex items-center justify-between p-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <InfoIcon />
                    <span className="text-[11px] font-medium text-[#808080]">Estimated gas</span>
                  </div>
                  <span className="text-[10px] text-white">~$2.50 (0.001 ETH)</span>
                </div>
              </div>
            )}

            {/* Estimated Time */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                  <span className="text-[11px] font-medium text-[#808080]">Estimated time</span>
                </div>
                <span className="text-[10px] text-white">
                  {quoteDetails ? quoteDetails.networkCosts.estimatedTime : estimatedGas}
                </span>
              </div>
            </div>
            
            {/* Advanced Details Toggle */}
            <button
              className="w-full flex items-center justify-between p-2.5 rounded-md border border-[#222222] bg-[#0F0F0F] transition-all duration-200"
              onClick={() => setIsAdvancedDetailsOpen(!isAdvancedDetailsOpen)}
            >
              <span className="text-xs font-medium text-[#9CA3AF]">Advanced Details</span>
              <ChevronDownIcon isOpen={isAdvancedDetailsOpen} />
            </button>

            {/* Advanced Details Content with smooth expand */}
            <div 
              className={`overflow-hidden transition-all duration-300 ${
                isAdvancedDetailsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="space-y-2 mt-2">
                {/* Network Costs */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Network costs</span>
                    </div>
                    <span className="text-[10px] text-white">
                      {quoteDetails 
                        ? `~$${quoteDetails.networkCosts.gasFeeUsd.toFixed(2)} (${quoteDetails.networkCosts.gasFee.toFixed(4)} ${sourceToken.symbol})`
                        : '~$7.00 (0.002 ETH)'
                      }
                    </span>
                  </div>
                </div>

                {/* Price Impact */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Price impact</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white">{quoteDetails ? `${quoteDetails.priceImpact.toFixed(2)}%` : '0.05%'}</span>
                      {quoteDetails && quoteDetails.priceImpact < 0.1 && (
                        <div className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded">Low</div>
                      )}
                      {quoteDetails && quoteDetails.priceImpact >= 0.1 && quoteDetails.priceImpact < 1 && (
                        <div className="text-[10px] text-yellow-600 bg-yellow-500/10 px-1.5 py-0.5 rounded">Medium</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Max Slippage */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Max slippage</span>
                    </div>
                    <span className="text-[10px] text-white">
                      {quoteDetails ? `${quoteDetails.maxSlippage.toFixed(1)}%` : '0.5%'}
                    </span>
                  </div>
                </div>

                {/* Minimum Received */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Minimum received</span>
                    </div>
                    <span className="text-[10px] text-white">
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

        {/* Sophisticated Confirm Button */}
        <div className="px-6 py-4 border-t border-[#1A1A1A] bg-[#0F0F0F]">
          <button
            onClick={handleConfirm}
            className={`group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border transition-all duration-200 ${
              (isDirectDeposit ? true : (!isLoadingQuote && !quoteError))
                ? 'bg-green-500 hover:bg-green-600 border-green-500 hover:border-green-600 hover:scale-105 active:scale-95'
                : 'bg-[#1A1A1A] border-[#333333] cursor-not-allowed opacity-50'
            }`}
            disabled={
              isDirectDeposit 
                ? false // Allow deposits even if vault not connected initially
                : (isLoadingQuote || !!quoteError)
            }
          >
            {/* Status Indicator */}
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              (isDirectDeposit ? true : (!isLoadingQuote && !quoteError))
                ? 'bg-green-400' : 'bg-gray-600'
            }`} />
            
            {/* Check Icon */}
            <CheckIcon />
            
            {/* Button Text */}
            <span className="text-[11px] font-medium text-white">
              {isDirectDeposit 
                ? 'Confirm Deposit'
                : (isLoadingQuote ? 'Getting Quote...' : quoteError ? 'Quote Error' : 'Confirm Order')
              }
            </span>
            
            {/* Arrow Icon */}
            {(isDirectDeposit ? true : (!isLoadingQuote && !quoteError)) && (
              <svg className="w-3 h-3 text-white group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>,
    typeof document !== 'undefined' ? document.body : null as any
  )
}