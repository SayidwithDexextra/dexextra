'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DepositModalStatusProps } from './types'
import cssStyles from './DepositModal.module.css'

// Icon Components following design system
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const SuccessIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#22c55e" stroke="#22c55e" strokeWidth="2"/>
    <path d="M9 12L11 14L15 10" stroke="#000000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const LoadingIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="animate-spin">
    <circle cx="12" cy="12" r="10" stroke="#60a5fa" strokeWidth="2" fill="none" opacity="0.3"/>
    <path d="M22 12A10 10 0 0 1 12 22" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const ErrorIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#ef4444" stroke="#ef4444" strokeWidth="2"/>
    <path d="M15 9L9 15M9 9L15 15" stroke="#000000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 13V19A2 2 0 0 1 16 21H5A2 2 0 0 1 3 19V8A2 2 0 0 1 5 6H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 3H21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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

export default function DepositModalStatus({
  isOpen,
  onClose,
  onNewDeposit,
  status = 'pending',
  amount = '0.00',
  sourceToken = { symbol: 'USDC', icon: '💵' },
  targetToken = { symbol: 'VAULT', icon: '🏦', name: 'Dexetra Vault' },
  transactionHash,
  estimatedTime = '< 1 min',
  actualTime,
  isDirectDeposit = false,
  walletAddress = '9cdb',
  isAnimating = false
}: DepositModalStatusProps) {
  const [mounted, setMounted] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // Timer for pending transactions
  useEffect(() => {
    if (status === 'pending' && isOpen) {
      const startTime = Date.now()
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [status, isOpen])

  useEffect(() => {
    if (isOpen) {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'hidden'
      }
    } else {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'unset'
      }
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (status !== 'pending') {
        onClose()
      }
    }
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  const getStatusInfo = () => {
    switch (status) {
      case 'pending':
        return {
          icon: <LoadingIcon />,
          title: 'Processing Deposit',
          subtitle: isDirectDeposit ? 'Confirming on blockchain...' : 'Swapping and depositing...',
          statusText: 'Pending',
          statusColor: 'text-blue-400',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/20',
          timeText: formatTime(elapsedTime),
          showClose: false
        }
      case 'success':
        return {
          icon: <SuccessIcon />,
          title: 'Deposit Successful',
          subtitle: `Added $${amount} to your vault balance`,
          statusText: 'Completed',
          statusColor: 'text-green-400',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/20',
          timeText: actualTime || formatTime(elapsedTime),
          showClose: true
        }
      case 'error':
        return {
          icon: <ErrorIcon />,
          title: 'Deposit Failed',
          subtitle: 'Transaction could not be completed',
          statusText: 'Failed',
          statusColor: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/20',
          timeText: formatTime(elapsedTime),
          showClose: true
        }
      default:
        return {
          icon: <LoadingIcon />,
          title: 'Processing',
          subtitle: 'Please wait...',
          statusText: 'Pending',
          statusColor: 'text-blue-400',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/20',
          timeText: '0s',
          showClose: false
        }
    }
  }

  const handleExplorerLink = () => {
    if (transactionHash && typeof window !== 'undefined') {
      window.open(`https://polygonscan.com/tx/${transactionHash}`, '_blank')
    }
  }

  if (!mounted || !isOpen) return null

  const statusInfo = getStatusInfo()

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
      {/* Sophisticated Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm bg-black/30" />
      
      {/* Status Modal with Sophisticated Design */}
      <div 
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] transition-all duration-200`}
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
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Status Indicator */}
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              status === 'pending' ? 'bg-blue-400 animate-pulse' :
              status === 'success' ? 'bg-green-400' :
              status === 'error' ? 'bg-red-400' : 'bg-gray-600'
            }`} />
            
            {/* Dexetra Icon */}
            <div className="relative group">
              <div 
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
                style={{
                  background: status === 'success' 
                    ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)'
                    : status === 'error'
                    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(245, 101, 101, 0.9) 50%, rgba(220, 38, 38, 0.9) 100%)'
                    : 'linear-gradient(135deg, rgba(96, 165, 250, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                  boxShadow: status === 'success'
                    ? '0 8px 32px rgba(34, 197, 94, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                    : status === 'error'
                    ? '0 8px 32px rgba(239, 68, 68, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                    : '0 8px 32px rgba(96, 165, 250, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                <img 
                  src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png" 
                  alt="Dexetra" 
                  className="w-5 h-5"
                />
              </div>
            </div>
            
            {/* Status Info */}
            <div className="text-center">
              <div className="flex items-center gap-2 justify-center">
                <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Deposit Status
                </span>
                <div className={`text-[9px] px-1 py-0.5 rounded ${statusInfo.statusColor} ${statusInfo.bgColor}`}>
                  {statusInfo.statusText}
                </div>
              </div>
              <div className="text-[10px] text-[#606060] mt-0.5">
                {statusInfo.timeText} elapsed
              </div>
            </div>
          </div>

          {/* Close Button */}
          {statusInfo.showClose && (
            <button
              onClick={onClose}
              className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-red-500/10 rounded-lg text-[#808080] hover:text-red-300"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* Scrollable Content Area */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 scrollbar-none ${cssStyles.statusScrollable}`}>
          {/* Hero Status Section */}
          <div className="text-center py-6">
            <div className="mb-4 flex justify-center">
              {statusInfo.icon}
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{statusInfo.title}</h1>
            <p className="text-[11px] font-medium text-[#808080]">{statusInfo.subtitle}</p>
          </div>

          {/* Amount Display */}
          <div className={`group bg-[#0F0F0F] rounded-md border ${statusInfo.borderColor} transition-all duration-200`}>
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  status === 'success' ? 'bg-green-400' :
                  status === 'error' ? 'bg-red-400' : 'bg-blue-400'
                }`} />
                <span className="text-[11px] font-medium text-[#808080]">Amount</span>
              </div>
              <span className="text-[10px] text-white font-mono">${amount}</span>
            </div>
          </div>

          {/* Transaction Details */}
          <div className="space-y-2">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Transaction Details
              </h4>
              <div className={`text-[10px] px-1.5 py-0.5 rounded ${statusInfo.statusColor} ${statusInfo.bgColor}`}>
                {status === 'pending' ? 'Processing' : status === 'success' ? 'Confirmed' : 'Failed'}
              </div>
            </div>

            {/* From */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                  <span className="text-[11px] font-medium text-[#808080]">From</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white">Wallet (...{walletAddress})</span>
                </div>
              </div>
            </div>

            {/* To */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                  <span className="text-[11px] font-medium text-[#808080]">To</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white">{targetToken.name || 'Dexetra Vault'}</span>
                </div>
              </div>
            </div>

            {/* Transaction Hash */}
            {transactionHash && (
              <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                <div className="flex items-center justify-between p-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                    <span className="text-[11px] font-medium text-[#808080]">Transaction</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExplorerLink}
                      className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors duration-200"
                    >
                      <span className="font-mono">{transactionHash.slice(0, 6)}...{transactionHash.slice(-4)}</span>
                      <ExternalLinkIcon />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Estimated Time */}
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <span className="text-[11px] font-medium text-[#808080]">Duration</span>
                </div>
                <span className="text-[10px] text-white">{statusInfo.timeText}</span>
              </div>
            </div>

            {/* Advanced Details Toggle */}
            <button
              className="w-full flex items-center justify-between p-2.5 rounded-md border border-[#222222] bg-[#0F0F0F] transition-all duration-200"
              onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
            >
              <span className="text-xs font-medium text-[#9CA3AF]">Network Details</span>
              <ChevronDownIcon isOpen={isDetailsExpanded} />
            </button>

            {/* Advanced Details Content */}
            <div 
              className={`overflow-hidden transition-all duration-300 ${
                isDetailsExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="space-y-2 mt-2">
                {/* Network */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Network</span>
                    </div>
                    <span className="text-[10px] text-white">Polygon</span>
                  </div>
                </div>

                {/* Gas Fee */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Gas fee</span>
                    </div>
                    <span className="text-[10px] text-white">~$2.50</span>
                  </div>
                </div>

                {/* Confirmation Count */}
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">Confirmations</span>
                    </div>
                    <span className="text-[10px] text-white">
                      {status === 'success' ? '12/12' : status === 'pending' ? '8/12' : '0/12'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Help Section for Errors */}
          {status === 'error' && (
            <div className="group bg-[#0F0F0F] rounded-md border border-red-500/20 hover:border-red-500/30 transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <InfoIcon />
                <div className="flex-1">
                  <span className="text-[11px] font-medium text-red-400">Need Help?</span>
                  <p className="text-[10px] text-[#606060] mt-1">
                    If this error persists, try refreshing or{' '}
                    <button className="text-red-400 hover:text-red-300 underline">
                      contact support
                    </button>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="px-6 py-4 border-t border-[#1A1A1A] bg-[#0F0F0F] space-y-3">
          {status === 'success' && (
            <>
              <button
                onClick={onNewDeposit}
                className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-[#333333] bg-[#1A1A1A] hover:bg-[#2A2A2A] hover:border-[#444444] transition-all duration-200"
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                <span className="text-[11px] font-medium text-white">Make Another Deposit</span>
                <svg className="w-3 h-3 text-white group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={onClose}
                className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-green-500 bg-green-500 hover:bg-green-600 hover:border-green-600 transition-all duration-200"
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                <span className="text-[11px] font-medium text-black">Continue Trading</span>
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <button
                onClick={onNewDeposit}
                className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-blue-500 bg-blue-500 hover:bg-blue-600 hover:border-blue-600 transition-all duration-200"
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                <span className="text-[11px] font-medium text-white">Try Again</span>
                <svg className="w-3 h-3 text-white group-hover:translate-x-0.5 transition-transform duration-200" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={onClose}
                className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-[#333333] bg-[#1A1A1A] hover:bg-[#2A2A2A] hover:border-[#444444] transition-all duration-200"
              >
                <span className="text-[11px] font-medium text-white">Close</span>
              </button>
            </>
          )}

          {status === 'pending' && (
            <div className="group relative w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-blue-500/50 bg-blue-500/10 cursor-not-allowed">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <span className="text-[11px] font-medium text-blue-400">Processing Transaction...</span>
              <LoadingIcon />
            </div>
          )}
        </div>
      </div>
    </div>,
    typeof document !== 'undefined' ? document.body : null as any
  )
}