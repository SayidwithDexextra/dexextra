'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DepositModalStatusProps } from './types'
import { designSystem, styles } from './DepositModal.styles'
import cssStyles from './DepositModal.module.css'

// Icon Components
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const SuccessIcon = () => (
  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#00d4aa" stroke="#00d4aa" strokeWidth="2"/>
    <path d="M9 12L11 14L15 10" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const LoadingIcon = () => (
  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="#4a9eff" strokeWidth="2" fill="none" opacity="0.3"/>
    <path d="M22 12A10 10 0 0 1 12 22" stroke="#4a9eff" strokeWidth="2" strokeLinecap="round">
      <animateTransform 
        attributeName="transform" 
        type="rotate" 
        values="0 12 12;360 12 12" 
        dur="1s" 
        repeatCount="indefinite"
      />
    </path>
  </svg>
)

const ErrorIcon = () => (
  <svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#ff6b6b" stroke="#ff6b6b" strokeWidth="2"/>
    <path d="M15 9L9 15M9 9L15 15" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 13V19A2 2 0 0 1 16 21H5A2 2 0 0 1 3 19V8A2 2 0 0 1 5 6H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 3H21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const DollarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#4a9eff" stroke="#4a9eff" strokeWidth="2"/>
    <path d="M12 6V18M9 9H12.5A2.5 2.5 0 0 1 12.5 14H9" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const VaultIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#00d4aa" stroke="#00d4aa" strokeWidth="2"/>
    <path d="M12 6V12L16 14" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Status-specific styles
const statusStyles = {
  ...styles,
  
  // Override modal for status display
  modal: {
    ...styles.modal,
    height: '580px',
    maxHeight: '90vh',
    overflow: 'hidden' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'flex-start'
  },

  // Scrollable content area
  scrollableContent: {
    flex: 1,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    paddingBottom: '0px',
    // Hide scrollbar but keep functionality
    scrollbarWidth: 'none' as const, // Firefox
    msOverflowStyle: 'none' as const, // IE/Edge
    // Note: webkit scrollbar hiding will be handled by CSS class
  },

  // Sticky footer for buttons
  stickyFooter: {
    flexShrink: 0,
    backgroundColor: designSystem.colors.background.primary,
    borderTop: `1px solid ${designSystem.colors.interactive.border}`,
    padding: '16px',
    marginTop: 'auto'
  },
  
  // Header section
  statusHeader: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '12px',
    padding: '12px 0 8px 0',
    flexShrink: 0,
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  statusTitle: {
    ...designSystem.typography.hierarchy.modalTitle,
    margin: 0,
    marginBottom: '4px'
  },
  
  statusSubtitle: {
    ...designSystem.typography.hierarchy.modalSubtitle,
    margin: 0,
    opacity: 0.8
  },
  
  // Icon section
  iconSection: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '10px',
    padding: '6px 0'
  },
  
  // Status info section
  statusInfoSection: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '10px',
    marginBottom: '10px',
    border: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  statusRowLast: {
    borderBottom: 'none'
  },
  
  statusLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    color: designSystem.colors.text.secondary
  },
  
  statusValue: {
    ...designSystem.typography.hierarchy.primaryText,
    fontWeight: 600
  },
  
  statusValueSuccess: {
    color: '#00d4aa'
  },
  
  statusValuePending: {
    color: '#4a9eff'
  },
  
  statusValueError: {
    color: '#ff6b6b'
  },
  
  // Transaction details section
  transactionSection: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '10px',
    marginBottom: '10px',
    border: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  transactionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`
  },
  
  transactionRowLast: {
    borderBottom: 'none'
  },
  
  transactionLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    color: designSystem.colors.text.secondary
  },
  
  transactionValue: {
    ...designSystem.typography.hierarchy.primaryText,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  externalLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    color: designSystem.colors.text.primary,
    textDecoration: 'none',
    transition: designSystem.effects.transitions.default,
    '&:hover': {
      opacity: 0.8
    }
  },
  
  // Result section
  resultSection: {
    backgroundColor: designSystem.colors.interactive.cardBackground,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '10px',
    marginBottom: '8px',
    border: `1px solid ${designSystem.colors.interactive.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  
  resultLabel: {
    ...designSystem.typography.hierarchy.secondaryText,
    color: designSystem.colors.text.secondary
  },
  
  resultValue: {
    ...designSystem.typography.hierarchy.primaryText,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '18px',
    fontWeight: 600
  },
  
  // Expandable details
  moreDetailsToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 0',
    cursor: 'pointer',
    fontSize: '14px',
    color: designSystem.colors.text.secondary,
    border: 'none',
    backgroundColor: 'transparent',
    width: '100%',
    marginBottom: '6px'
  },
  
  // Help section
  helpSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    backgroundColor: 'rgba(74, 158, 255, 0.1)',
    borderRadius: designSystem.effects.borderRadius.medium,
    border: '1px solid rgba(74, 158, 255, 0.2)',
    marginBottom: '10px'
  },
  
  helpText: {
    fontSize: '13px',
    color: '#4a9eff'
  },
  
  helpLink: {
    color: '#4a9eff',
    textDecoration: 'underline',
    fontWeight: 500
  },
  
  // Button container (moved to stickyFooter)
  buttonContainer: {
    display: 'flex',
    gap: '12px'
  },
  
  closeButton: {
    flex: 1,
    backgroundColor: designSystem.colors.interactive.cardBackground,
    color: designSystem.colors.text.primary,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 600,
    border: `1px solid ${designSystem.colors.interactive.border}`,
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default
  },
  
  newDepositButton: {
    flex: 1,
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default
  }
}

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
  isAnimating = false,
  animationDirection = 'forward'
}: DepositModalStatusProps) {
  const [mounted, setMounted] = useState(false)
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)

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
      if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
        (globalThis as any).document.body.style.overflow = 'hidden'
      }
    } else {
      if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
        (globalThis as any).document.body.style.overflow = 'unset'
      }
    }

    return () => {
      if (typeof globalThis !== 'undefined' && (globalThis as any).document) {
        (globalThis as any).document.body.style.overflow = 'unset'
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
    if (seconds < 60) return `${seconds} seconds`
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
          subtitle: isDirectDeposit ? 'Depositing to vault...' : 'Swapping and depositing...',
          statusText: 'Pending',
          statusColor: statusStyles.statusValuePending,
          timeText: formatTime(elapsedTime)
        }
      case 'success':
        return {
          icon: <SuccessIcon />,
          title: 'Deposit',
          subtitle: `Dexetra Balance: $${amount}`,
          statusText: 'Successful',
          statusColor: statusStyles.statusValueSuccess,
          timeText: actualTime || formatTime(elapsedTime)
        }
      case 'error':
        return {
          icon: <ErrorIcon />,
          title: 'Deposit Failed',
          subtitle: 'Transaction was rejected',
          statusText: 'Failed',
          statusColor: statusStyles.statusValueError,
          timeText: formatTime(elapsedTime)
        }
      default:
        return {
          icon: <LoadingIcon />,
          title: 'Processing',
          subtitle: 'Please wait...',
          statusText: 'Pending',
          statusColor: statusStyles.statusValuePending,
          timeText: '0 seconds'
        }
    }
  }

  const handleExplorerLink = () => {
    if (transactionHash && typeof globalThis !== 'undefined' && (globalThis as any).open) {
      (globalThis as any).open(`https://polygonscan.com/tx/${transactionHash}`, '_blank')
    }
  }

  const statusInfo = getStatusInfo()

  // Animation classes
  const getModalClasses = () => {
    const baseClasses = cssStyles.depositModal
    
    if (!isAnimating) {
      return baseClasses
    }
    
    const animationClass = animationDirection === 'forward' 
      ? cssStyles.modalSlideInFromRight
      : cssStyles.modalSlideOutRight
      
    return `${baseClasses} ${animationClass}`
  }

  // Don't render portal if not mounted or document is not available
  if (!mounted || !isOpen || typeof globalThis === 'undefined' || !(globalThis as any).document) {
    return null
  }

  return createPortal(
    <div style={statusStyles.overlay} onClick={handleBackdropClick}>
      <div 
        style={{
          ...statusStyles.modal,
          backgroundColor: '#1a1a1a',
          border: '1px solid #333333'
        }} 
        className={getModalClasses()}
      >
        {/* Close Button - Only show if not pending */}
        {status !== 'pending' && (
          <button
            onClick={onClose}
            style={styles.closeButton}
            className={cssStyles.closeButtonHover}
          >
            <CloseIcon />
          </button>
        )}

        {/* Scrollable Content Area */}
        <div style={statusStyles.scrollableContent} className={cssStyles.hideScrollbar}>
          {/* Header Section */}
          <div style={statusStyles.statusHeader}>
            <h2 style={statusStyles.statusTitle}>{statusInfo.title}</h2>
            <p style={statusStyles.statusSubtitle}>{statusInfo.subtitle}</p>
          </div>

        {/* Icon Section */}
        <div style={statusStyles.iconSection}>
          {statusInfo.icon}
        </div>

        {/* Status Info Section */}
        <div style={{
          ...statusStyles.statusInfoSection,
          backgroundColor: '#2a2a2a',
          border: '1px solid #333333'
        }}>
          <div style={statusStyles.statusRow}>
            <span style={statusStyles.statusLabel}>Fill status</span>
            <span style={{
              ...statusStyles.statusValue,
              ...statusInfo.statusColor
            }}>
              {statusInfo.statusText}
            </span>
          </div>
          <div style={{...statusStyles.statusRow, ...statusStyles.statusRowLast}}>
            <span style={statusStyles.statusLabel}>Total time</span>
            <span style={statusStyles.statusValue}>{statusInfo.timeText}</span>
          </div>
        </div>

        {/* Transaction Details Section */}
        <div style={{
          ...statusStyles.transactionSection,
          backgroundColor: '#2a2a2a',
          border: '1px solid #333333'
        }}>
          <div style={statusStyles.transactionRow}>
            <span style={statusStyles.transactionLabel}>Source</span>
            <div style={statusStyles.transactionValue}>
              <span>

              <img 
                      src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//MetaMask_Fox.svg.png"
                      alt="MetaMask"
                      style={{ width: '15px', height: '15px' }}

                    />

              </span>
              <span>Wallet (...{walletAddress})</span>
              <ExternalLinkIcon />
            </div>
          </div>
          <div style={{...statusStyles.transactionRow, ...statusStyles.transactionRowLast}}>
            <span style={statusStyles.transactionLabel}>Destination</span>
            <div style={statusStyles.transactionValue}>
              <span>
              <img 
                      src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png"
                      alt="MetaMask"
                      style={{ width: '15px', height: '15px' }}

                    />

              </span>
              <span>{isDirectDeposit ? (targetToken.name || 'Dexetra Vault') : 'Dexetra Wallet'}</span>
              <ExternalLinkIcon />
            </div>
          </div>
        </div>

        {/* Result Section */}
        <div style={{
          ...statusStyles.resultSection,
          backgroundColor: '#2a2a2a',
          border: '1px solid #333333'
        }}>
          <span style={statusStyles.resultLabel}>You receive</span>
          <div style={statusStyles.resultValue}>
            {isDirectDeposit ? <VaultIcon /> : <DollarIcon />}
            <span>
              {isDirectDeposit 
                ? `${amount} ${sourceToken.symbol} collateral`
                : `$${parseFloat(amount).toFixed(5)}`
              }
            </span>
          </div>
        </div>

        {/* More Details Toggle */}
        <button
          style={statusStyles.moreDetailsToggle}
          onClick={() => setShowMoreDetails(!showMoreDetails)}
        >
          <span>More details</span>
          <ChevronRightIcon />
        </button>

          {/* Help Section */}
          {status === 'error' && (
            <div style={statusStyles.helpSection}>
              <InfoIcon />
              <span style={statusStyles.helpText}>
                Experiencing problems?{' '}
                <a href="#" style={statusStyles.helpLink}>Get help.</a>
              </span>
            </div>
          )}
        </div>

        {/* Sticky Footer with Buttons */}
        {status !== 'pending' && (
          <div style={statusStyles.stickyFooter}>
            <div style={statusStyles.buttonContainer}>
              <button
                onClick={onClose}
                style={{
                  ...statusStyles.closeButton,
                  backgroundColor: '#2a2a2a',
                  border: '1px solid #333333'
                }}
                className={cssStyles.closeButtonHover}
              >
                Close
              </button>
              <button
                onClick={onNewDeposit}
                style={statusStyles.newDepositButton}
                className={cssStyles.continueButtonHover}
              >
                New Deposit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    (globalThis as any).document.body
  )
} 