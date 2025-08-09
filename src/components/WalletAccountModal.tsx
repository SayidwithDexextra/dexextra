'use client'

import { useState, useEffect, useMemo } from 'react'
import useWallet from '@/hooks/useWallet'
import { TokenBalance } from '@/types/wallet'
import TokenList from './TokenList'

// Import the design system
import designSystem from '../../design/AccountBar.json'

interface WalletAccountModalProps {
  isOpen: boolean
  onClose: () => void
}



export default function WalletAccountModal({ isOpen, onClose }: WalletAccountModalProps) {
  const { walletData, portfolio, refreshPortfolio, formatAddress } = useWallet()
  const [activeTab, setActiveTab] = useState<'crypto' | 'items'>('crypto')

  // Use real portfolio data from Alchemy API

  const tokens = useMemo(() => portfolio.tokens || [], [portfolio.tokens])
   console.log('🔍 Tokens:', tokens)
  const totalValue = parseFloat(portfolio.totalValue) || tokens.reduce((sum: number, token: TokenBalance) => sum + (token.value || 0), 0)
  const ethBalance = portfolio.ethBalanceFormatted || '0.013'

  // Debug logging
  useEffect(() => {
     console.log('🔍 Portfolio Debug:', {
      portfolioTokens: portfolio.tokens,
      tokensLength: portfolio.tokens?.length,
      isLoading: portfolio.isLoading,
      finalTokens: tokens,
      walletConnected: walletData.isConnected
    })
  }, [portfolio, tokens, walletData.isConnected])

  // Refresh portfolio data when modal opens
  useEffect(() => {
    if (isOpen && walletData.isConnected) {
       console.log('📊 Refreshing portfolio data...')
      refreshPortfolio()
    }
  }, [isOpen, walletData.isConnected, refreshPortfolio])

  if (!isOpen) return null

  const handleActionClick = (action: string) => {
     console.log(`${action} clicked`)
    // Handle action routing here
    onClose() // Close modal when navigating
    
    // Navigation logic
    switch (action) {
      case 'send':
        window.location.href = '/send'
        break
      case 'swap':
        window.location.href = '/swap'
        break
      case 'deposit':
        // Could open a deposit modal or navigate to deposit page
        break
      case 'buy':
        // Could open a buy modal or navigate to buy page
        break
      default:
        break
    }
  }



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 transition-opacity duration-300"
        style={{ backgroundColor: 'transparent' }}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative z-10 w-full transition-all duration-300 transform"
        style={{ 
          maxWidth: designSystem.layout.maxWidth,
          minWidth: designSystem.layout.minWidth,
          backgroundColor: designSystem.colorPalette.primary.background,
          borderRadius: designSystem.borderRadius.lg,
          boxShadow: designSystem.shadows.lg,
          fontFamily: designSystem.typography.fontFamily.primary
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between"
          style={{ 
            padding: designSystem.layout.header.padding,
            backgroundColor: designSystem.colorPalette.primary.background
          }}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, #4ade80 0%, #06b6d4 50%, #8b5cf6 100%)',
                borderRadius: designSystem.borderRadius.sm
              }}
            >
              {walletData.avatar || '👤'}
            </div>
            <div>
              <div 
                className="flex items-center gap-1"
                style={{ 
                  fontSize: designSystem.typography.hierarchy.walletAddress.fontSize,
                  fontWeight: designSystem.typography.hierarchy.walletAddress.fontWeight,
                  fontFamily: designSystem.typography.hierarchy.walletAddress.fontFamily,
                  color: designSystem.typography.hierarchy.walletAddress.color
                }}
              >
                {formatAddress(walletData.address || '')}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 14L17 12L19 10M5 10L7 12L5 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-all duration-200 hover:scale-110"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: designSystem.colorPalette.interactive.buttonBackground,
              borderRadius: designSystem.borderRadius.sm,
              color: designSystem.colorPalette.primary.text
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div 
          className="flex"
          style={{ 
            borderBottom: `1px solid ${designSystem.colorPalette.primary.backgroundSecondary}`,
            padding: designSystem.layout.tabBar.padding
          }}
        >
          <button
            onClick={() => setActiveTab('crypto')}
            className="transition-all duration-200"
            style={{
              padding: designSystem.components.tab.padding,
              marginRight: designSystem.components.tab.marginRight,
              borderBottom: activeTab === 'crypto' ? 
                `2px solid ${designSystem.components.tab.active.borderBottomColor}` : 
                `2px solid transparent`,
              fontSize: designSystem.components.tab.fontSize,
              fontWeight: designSystem.components.tab.fontWeight,
              color: activeTab === 'crypto' ? 
                designSystem.components.tab.active.color : 
                designSystem.components.tab.inactive.color
            }}
          >
            Crypto
          </button>
          <button
            onClick={() => setActiveTab('items')}
            className="transition-all duration-200"
            style={{
              padding: designSystem.components.tab.padding,
              fontSize: designSystem.components.tab.fontSize,
              fontWeight: designSystem.components.tab.fontWeight,
              color: activeTab === 'items' ? 
                designSystem.components.tab.active.color : 
                designSystem.components.tab.inactive.color,
              borderBottom: activeTab === 'items' ? 
                `2px solid ${designSystem.components.tab.active.borderBottomColor}` : 
                `2px solid transparent`
            }}
          >
            Items
          </button>
        </div>

        {/* Balance Display */}
        <div 
          className="text-center"
          style={{ 
            padding: designSystem.components.balanceDisplay.padding,
            backgroundColor: designSystem.components.balanceDisplay.backgroundColor
          }}
        >
          <div 
            className="flex items-center justify-center gap-2 mb-2"
            style={{
              fontSize: designSystem.typography.hierarchy.balanceAmount.fontSize,
              fontWeight: designSystem.typography.hierarchy.balanceAmount.fontWeight,
              color: designSystem.typography.hierarchy.balanceAmount.color,
              lineHeight: designSystem.typography.hierarchy.balanceAmount.lineHeight
            }}
          >
            {ethBalance}
            <span 
              style={{
                fontSize: designSystem.typography.hierarchy.balanceLabel.fontSize,
                fontWeight: designSystem.typography.hierarchy.balanceLabel.fontWeight,
                color: designSystem.typography.hierarchy.balanceLabel.color
              }}
            >
              ETH
            </span>
          </div>
          <div 
            style={{
              fontSize: designSystem.typography.hierarchy.fiatValue.fontSize,
              fontWeight: designSystem.typography.hierarchy.fiatValue.fontWeight,
              color: designSystem.typography.hierarchy.fiatValue.color
            }}
          >
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Action Buttons */}
        <div 
          className="grid grid-cols-4 gap-3"
          style={{ 
            padding: designSystem.layout.actionButtons.padding,
            gap: designSystem.layout.actionButtons.gap
          }}
        >
          {[
            { icon: '▶', label: 'Send', action: 'send' },
            { icon: '🔄', label: 'Swap', action: 'swap' },
            { icon: '⬇', label: 'Deposit', action: 'deposit' },
            { icon: '+', label: 'Buy', action: 'buy' }
          ].map((button) => (
            <button
              key={button.action}
              onClick={() => handleActionClick(button.action)}
              className="transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                width: designSystem.components.actionButton.width,
                height: designSystem.components.actionButton.height,
                borderRadius: designSystem.components.actionButton.borderRadius,
                backgroundColor: designSystem.components.actionButton.backgroundColor,
                border: designSystem.components.actionButton.border,
                display: designSystem.components.actionButton.display,
                                 flexDirection: designSystem.components.actionButton.flexDirection as 'column',
                alignItems: designSystem.components.actionButton.alignItems,
                justifyContent: designSystem.components.actionButton.justifyContent,
                gap: designSystem.components.actionButton.gap,
                color: designSystem.colorPalette.primary.text
              }}
            >
              <div style={{ fontSize: '20px' }}>{button.icon}</div>
              <div style={{ fontSize: '12px', fontWeight: '500' }}>{button.label}</div>
            </button>
          ))}
        </div>

        {/* Content */}
        <div 
          style={{ 
            padding: designSystem.layout.tokenList.padding
          }}
        >
          {activeTab === 'crypto' ? (
            <TokenList
              tokens={tokens}
              isLoading={portfolio.isLoading}
              walletConnected={walletData.isConnected}
              onRefresh={refreshPortfolio}
            />
              ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <span className="text-2xl">🖼️</span>
                      </div>
              <p 
                className="text-center"
                style={{
                  fontSize: designSystem.typography.fontSize.sm,
                  color: designSystem.colorPalette.primary.textSecondary
                }}
              >
                NFTs coming soon...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 