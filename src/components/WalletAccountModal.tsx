'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import useWallet from '@/hooks/useWallet'
import { TokenBalance } from '@/types/wallet'
import TokenList from './TokenList'

interface WalletAccountModalProps {
  isOpen: boolean
  onClose: () => void
}



export default function WalletAccountModal({ isOpen, onClose }: WalletAccountModalProps) {
  const router = useRouter()
  const { walletData, portfolio, refreshPortfolio, formatAddress } = useWallet()
  const [activeTab, setActiveTab] = useState<'crypto' | 'items'>('crypto')
  const [isClosing, setIsClosing] = useState(false)

  const tokens = useMemo(() => portfolio.tokens || [], [portfolio.tokens])
  const totalValue = parseFloat(portfolio.totalValue) || tokens.reduce((sum: number, token: TokenBalance) => sum + (token.value || 0), 0)
  // Hyperliquid native token labeling
  const nativeSymbol = walletData.chainId === 999 ? 'HYPE' : 'ETH'
  const nativeBalance = portfolio.ethBalanceFormatted || '0.00'
  const networkLabel = walletData.chainId === 999 ? 'Hyperliquid' : 'Connected'

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

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 200)
  }

  const handleActionClick = (action: string) => {
    console.log(`${action} clicked`)
    handleClose()
    
    // Navigation logic with Next.js router
    setTimeout(() => {
      switch (action) {
        case 'send':
          router.push('/send')
          break
        case 'swap':
          router.push('/swap')
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
    }, 300)
  }



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Sophisticated Backdrop with Subtle Blur */}
      <div 
        className={`absolute inset-0 transition-all duration-300 backdrop-blur-sm ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
        onClick={handleClose}
      />
      
      {/* Main Modal Container - Sophisticated Minimal Design */}
      <div 
        className={`group relative z-10 w-full max-w-sm transition-all duration-300 transform ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        } bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-xl border border-[#222222] hover:border-[#333333]`}
        style={{ 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)'
        }}
      >
        {/* Sophisticated Header Section */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Connection Status Indicator */}
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
            
            {/* Wallet Avatar with Sophisticated Gradient */}
            <div className="relative group">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, rgba(74, 222, 128, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                  boxShadow: '0 8px 32px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                {walletData.userProfile?.profile_image_url ? (
                  <Image
                    src={walletData.userProfile.profile_image_url}
                    alt="Profile"
                    width={48}
                    height={48}
                    className="w-full h-full object-cover rounded-xl"
                    unoptimized={walletData.userProfile.profile_image_url.startsWith('data:') || walletData.userProfile.profile_image_url.startsWith('blob:')}
                  />
                ) : (
                  <span>{walletData.avatar || '👤'}</span>
                )}
              </div>
              {/* Subtle Ring Effect */}
              <div className="absolute inset-0 rounded-xl border border-white/10 group-hover:border-white/20 transition-colors duration-200" />
            </div>
            
            {/* Wallet Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Wallet
                </span>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {networkLabel}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] font-medium text-white font-mono">
                  {formatAddress(walletData.address || '')}
                </span>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-blue-500/10 rounded text-blue-400 hover:text-blue-300">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          {/* Close Button with Sophisticated Styling */}
          <button
            onClick={handleClose}
            className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-red-500/10 rounded-lg text-[#808080] hover:text-red-300"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Sophisticated Tab Navigation */}
        <div className="relative px-6 py-3 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1">
            {['crypto', 'items'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as 'crypto' | 'items')}
                className={`relative flex-1 px-4 py-2 rounded-md text-xs font-medium transition-all duration-200 ${
                  activeTab === tab
                    ? 'bg-[#0F0F0F] text-white shadow-sm'
                    : 'text-[#808080] hover:text-[#9CA3AF] hover:bg-[#2A2A2A]'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  {tab === 'crypto' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  )}
                  {tab === 'items' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  )}
                  <span className="capitalize">{tab}</span>
                  {tab === 'crypto' && (
                    <div className="text-[10px] text-[#606060] bg-[#2A2A2A] px-1.5 py-0.5 rounded ml-1">
                      {tokens.length}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Sophisticated Balance Display */}
        <div className="relative px-6 py-8 text-center group">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-5 group-hover:opacity-10 transition-opacity duration-300">
            <div className="absolute inset-0" style={{
              backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(74, 222, 128, 0.1) 0%, transparent 50%)'
            }} />
          </div>
          
          {/* Main Balance Display */}
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white font-mono tracking-tight">
                  {nativeBalance}
                </span>
                <span className="text-sm font-medium text-[#9CA3AF] uppercase tracking-wider">
                  {nativeSymbol}
                </span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            </div>
            
            {/* Fiat Value with Sophisticated Styling */}
            <div className="flex items-center justify-center gap-2 text-[#808080]">
              <span className="text-lg font-medium">
                ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-1 rounded">
                USD
              </div>
            </div>
            
            {/* Portfolio Status Indicator */}
            <div className="flex items-center justify-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-400 transition-all duration-300"
                  style={{ width: `${Math.min((totalValue / 10000) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-[#606060]">
                Portfolio Health
              </span>
            </div>
          </div>
        </div>

        {/* Sophisticated Action Buttons */}
        <div className="px-6 py-4 border-b border-[#1A1A1A]">
          <div className="grid grid-cols-4 gap-3">
            {[
              { 
                icon: (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M7 17L17 7M17 7H7M17 7V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ), 
                label: 'Send', 
                action: 'send',
                color: 'red'
              },
              { 
                icon: (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M7 4V2A1 1 0 018 1H16A1 1 0 0117 2V4M7 4H5A2 2 0 003 6V20A2 2 0 005 22H19A2 2 0 0021 20V6A2 2 0 0019 4H17M7 4H17M9 9L12 12L15 9M12 12V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ), 
                label: 'Swap', 
                action: 'swap',
                color: 'blue'
              },
              { 
                icon: (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L12 22M19 9L12 2L5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ), 
                label: 'Deposit', 
                action: 'deposit',
                color: 'green'
              },
              { 
                icon: (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5V19M5 12L19 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ), 
                label: 'Buy', 
                action: 'buy',
                color: 'yellow'
              }
            ].map((button) => (
              <button
                key={button.action}
                onClick={() => handleActionClick(button.action)}
                className={`group relative flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all duration-200 hover:scale-105 active:scale-95 ${
                  button.color === 'red' ? 'border-[#222222] hover:border-red-500/30 hover:bg-red-500/5' :
                  button.color === 'blue' ? 'border-[#222222] hover:border-blue-500/30 hover:bg-blue-500/5' :
                  button.color === 'green' ? 'border-[#222222] hover:border-green-500/30 hover:bg-green-500/5' :
                  'border-[#222222] hover:border-yellow-500/30 hover:bg-yellow-500/5'
                } bg-[#1A1A1A] hover:bg-[#2A2A2A]`}
              >
                {/* Status Indicator */}
                <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
                  button.color === 'red' ? 'bg-red-400' :
                  button.color === 'blue' ? 'bg-blue-400' :
                  button.color === 'green' ? 'bg-green-400' :
                  'bg-yellow-400'
                }`} />
                
                {/* Icon */}
                <div className={`transition-colors duration-200 ${
                  button.color === 'red' ? 'text-[#808080] group-hover:text-red-400' :
                  button.color === 'blue' ? 'text-[#808080] group-hover:text-blue-400' :
                  button.color === 'green' ? 'text-[#808080] group-hover:text-green-400' :
                  'text-[#808080] group-hover:text-yellow-400'
                }`}>
                  {button.icon}
                </div>
                
                {/* Label */}
                <span className="text-[10px] font-medium text-[#808080] group-hover:text-white transition-colors duration-200">
                  {button.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Sophisticated Content Section */}
        <div className="px-6 pb-6">
          {activeTab === 'crypto' ? (
            <div className="space-y-3">
              {/* Content Header */}
              <div className="group flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Token Holdings
                </h4>
                <div className="flex items-center gap-1.5">
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {tokens.length} tokens
                  </div>
                  {portfolio.isLoading ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  ) : tokens.length > 0 ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                  )}
                  <button 
                    onClick={refreshPortfolio}
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-blue-500/10 rounded text-blue-400 hover:text-blue-300"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <path d="M4 4V9H9M20 20V15H15M20.49 9A9 9 0 0111 2.1L13.77 4.87M3.51 15A9 9 0 0013 21.9L10.23 19.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              
              {/* Token List with Sophisticated Container */}
              <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                <TokenList
                  tokens={tokens}
                  isLoading={portfolio.isLoading}
                  walletConnected={walletData.isConnected}
                  onRefresh={refreshPortfolio}
                />
              </div>
            </div>
          ) : (
            /* NFT/Items Empty State with Sophisticated Design */
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      No NFTs found
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                  <svg className="w-3 h-3 text-[#404040]" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="2"/>
                    <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">NFT collections and digital assets will appear here</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 