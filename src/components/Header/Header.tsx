'use client'

/**
 * HEADER COMPONENT - HYPERLIQUID VAULTROUTER INTEGRATION
 * 
 * This header component integrates with the HyperLiquid VaultRouter system to display:
 * - Live portfolio value (total collateral + realized PnL + unrealized PnL)
 * - Available cash (collateral available for new positions)
 * - Unrealized PnL across all positions (color-coded: green for profits, red for losses)
 * - VaultRouter connection status indicator
 * 
 * Key Features:
 * - Real-time data refresh every 10 seconds
 * - Automatic formatting of MockUSDC values
 * - Error handling and connection status display
 * - Integration with HyperLiquid deployment
 */

import { useState, useMemo, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import UserProfileModal from '../UserProfileModal'
import SearchModal from '../SearchModal'
import DepositModal from '../DepositModal/DepositModal'
import { useWallet } from '@/hooks/useWallet'
// Removed direct contract reads; align with useCoreVault hook outputs
import DecryptedText from './DecryptedText';
// Removed NetworkStatus import (only used in commented code)
// Removed direct contract config imports
import { useCoreVault } from '@/hooks/useCoreVault'

// Search Icon Component
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="8" stroke="#ffffff" strokeWidth="2"/>
    <path d="m21 21-4.35-4.35" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

// Notification Icon Component
const NotificationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" stroke="currentColor" strokeWidth="2"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

// Chevron Down Icon Component
const ChevronDownIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function Header() {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)
  const { walletData } = useWallet()
  const router = useRouter()
  const [hasMounted, setHasMounted] = useState(false)
  const [vaultEvent, setVaultEvent] = useState<any | null>(null)
  
  // Align with useCoreVault data as single source of truth
  const core = useCoreVault(walletData.address || undefined)
  const isVaultConnected = !!core.isConnected
  const vaultAvailableCollateral = parseFloat((vaultEvent?.availableCollateral ?? core.availableBalance) || '0')
  // Portfolio value approximation consistent with TokenHeader broadcasting:
  // totalCollateral (6d) + realizedPnL (24d formatted) + unrealizedPnL (24d formatted)
  // All are already formatted to decimal strings by useCoreVault
  const totalCollateralNum = parseFloat((vaultEvent?.totalCollateral ?? core.totalCollateral) || '0')
  const realizedPnLNum = parseFloat((vaultEvent?.realizedPnL ?? core.realizedPnL) || '0')
  const unrealizedPnLNum = parseFloat((vaultEvent?.unrealizedPnL ?? core.unrealizedPnL) || '0')
  // Avoid double counting losses: negative realized is already deducted from collateral on-chain
  const realizedForPortfolio = Math.max(0, realizedPnLNum)
  const vaultPortfolioValue = totalCollateralNum + realizedForPortfolio + unrealizedPnLNum
  const unrealizedPnL = unrealizedPnLNum

  // Removed: direct ABIs and on-chain queries; rely on useCoreVault

  // Removed: manual fetchVaultData; rely on useCoreVault polling and formatting

  // No manual polling; useCoreVault already polls and debounces
  useEffect(() => {
    setHasMounted(true)
  }, [])

  // React to coreVaultSummary events to update UI immediately
  useEffect(() => {
    const onSummary = (e: any) => {
      try {
        // Minimal guard: only accept updates for connected user
        setVaultEvent(e.detail || null)
        console.log('[Dispatch] 🎧 [EVT][Header] Received coreVaultSummary', e.detail)
      } catch {}
    }
    const onOrdersUpdated = (e: any) => {
      try {
        console.log('[Dispatch] 🎧 [EVT][Header] Received ordersUpdated', e?.detail)
        // could trigger a lightweight state nudge if needed
      } catch {}
    }
    console.log('[Dispatch] 🔗 [EVT][Header] Subscribing to coreVaultSummary')
    if (typeof window !== 'undefined') {
      window.addEventListener('coreVaultSummary', onSummary)
      window.addEventListener('ordersUpdated', onOrdersUpdated)
    }
    return () => {
      console.log('[Dispatch] 🧹 [EVT][Header] Unsubscribing from coreVaultSummary')
      if (typeof window !== 'undefined') {
        window.removeEventListener('coreVaultSummary', onSummary)
        window.removeEventListener('ordersUpdated', onOrdersUpdated)
      }
    }
  }, [])

  // Debug logs removed to prevent any rendering interference 

  // Ensure certain UI renders only after client mount to avoid hydration issues

  // Format portfolio and cash values from centralized vault
  const formatCurrency = (value: string, showSign = false) => {
    const num = parseFloat(value || '0')
    const formatted = num.toLocaleString('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    })
    return showSign && num > 0 ? `+${formatted}` : formatted
  }

  // Calculate portfolio value from VaultRouter
  const totalPortfolioValue = useMemo(() => {
    const portfolioVal = vaultPortfolioValue || 0
    console.log('[Dispatch] 🔁 [UI][Header] Recompute totalPortfolioValue', { portfolioVal })
    return formatCurrency(portfolioVal.toString())
  }, [vaultPortfolioValue])

  // Trace derived values that trigger UI rendering
  useEffect(() => {
    console.log('[Dispatch] 🔁 [UI][Header] Derived values changed', {
      isVaultConnected,
      vaultAvailableCollateral,
      totalCollateralNum,
      realizedPnLNum,
      unrealizedPnLNum,
      vaultPortfolioValue
    })
  }, [isVaultConnected, vaultAvailableCollateral, totalCollateralNum, realizedPnLNum, unrealizedPnLNum, vaultPortfolioValue])

  // Handle different states for display values
  const displayPortfolioValue = !walletData.isConnected 
    ? '$0.00'
    : totalPortfolioValue
        
  const displayCashValue = !walletData.isConnected 
    ? '$0.00'
    : formatCurrency(String(vaultAvailableCollateral))

  // Helper function to get display name
  const getDisplayName = () => {
    if (!walletData.isConnected) return 'Connect Wallet'
    if (walletData.userProfile?.display_name) return walletData.userProfile.display_name
    if (walletData.userProfile?.username) return walletData.userProfile.username
    if (walletData.address) return `${walletData.address.slice(0, 6)}...${walletData.address.slice(-4)}`
    return 'User'
  }

  // Helper function to get avatar
  const getAvatarContent = () => {
    if (walletData.userProfile?.profile_image_url) {
      return (
        <Image 
          src={walletData.userProfile.profile_image_url} 
          alt="Profile" 
          width={20}
          height={20}
          className="w-full h-full object-cover rounded-full"
        />
      )
    }
    
    // Fallback to initials or default
    const displayName = getDisplayName()
    const initial = displayName.charAt(0).toUpperCase()
    return (
      <span style={{ color: '#000000', fontSize: '10px', fontWeight: 600 }}>
        {initial}
      </span>
    )
  }

  return (
    <>
      <header 
        className="fixed top-0 right-0 z-40 flex items-center justify-between transition-all duration-300 ease-in-out"
        style={{
          height: '48px',
          backgroundColor: '#1a1a1a',
          padding: '0 16px',
          borderBottom: '1px solid #333333',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          left: '60px', // Fixed position for collapsed navbar only
          width: 'calc(100vw - 60px)' // Fixed width for collapsed navbar only
        }}
      >
        {/* Search Section */}
        <div className="flex items-center flex-1 max-w-xl">
          <div className="relative w-full max-w-sm">
            <div 
              className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10 pointer-events-none"
              style={{ color: '#ffffff' }}
            >
              <SearchIcon />
            </div>
            {hasMounted ? (
              <input
                type="text"
                placeholder="Search Active Markets"
                value=""
                readOnly
                onClick={() => setIsSearchModalOpen(true)}
                className="w-full pl-10 pr-12 py-2 rounded-md border transition-all duration-200 focus:outline-none cursor-pointer"
                style={{
                  height: '30px',
                  backgroundColor: '#2a2a2a',
                  borderColor: '#444444',
                  color: '#ffffff',
                  fontSize: '14px',
                  minWidth: '240px'
                }}
                onMouseEnter={(e) => {
                  const target = e.target as any
                  target.style.borderColor = '#555555'
                  target.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.05)'
                }}
                onMouseLeave={(e) => {
                  const target = e.target as any
                  target.style.borderColor = '#444444'
                  target.style.boxShadow = 'none'
                }}
              />
            ) : (
              <button
                type="button"
                aria-label="Open search"
                onClick={() => setIsSearchModalOpen(true)}
                className="w-full pl-10 pr-12 py-2 rounded-md border transition-all duration-200 focus:outline-none cursor-pointer text-left"
                style={{
                  height: '30px',
                  backgroundColor: '#2a2a2a',
                  borderColor: '#444444',
                  color: '#ffffff',
                  fontSize: '14px',
                  minWidth: '240px'
                }}
                onMouseEnter={(e) => {
                  const target = e.currentTarget as any
                  target.style.borderColor = '#555555'
                  target.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.05)'
                }}
                onMouseLeave={(e) => {
                  const target = e.currentTarget as any
                  target.style.borderColor = '#444444'
                  target.style.boxShadow = 'none'
                }}
              >
                Search Active Markets
              </button>
            )}
            <div 
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs px-1.5 py-0.5 rounded"
              style={{
                color: '#666666',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                fontSize: '11px'
              }}
            >
              /
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Portfolio & Cash Display */}
          <div className="hidden md:flex items-center gap-4">
            <div 
              className="flex flex-col items-center cursor-pointer transition-opacity duration-200 hover:opacity-80"
              onClick={() => router.push('/portfolio')}
            >
              <span 
                style={{
                  fontSize: '12px',
                  color: '#b3b3b3',
                  fontWeight: 400
                }}
              >
                Portfolio
              </span>
              <DecryptedText
                text={displayPortfolioValue}
                style={{
                  fontSize: '14px',
                  color: '#FFFFFFFF',
                  fontWeight: 600
                }}
                characters="0123456789$.,+-"
                speed={100}
                maxIterations={12}
                animateOnMount={true}
                animateOnChange={true}
              />
            </div>
            
            <div 
              className="flex flex-col items-center cursor-pointer transition-opacity duration-200 hover:opacity-80"
              onClick={() => router.push('/portfolio')}
            >
              <div className="flex items-center gap-1">
                <span 
                  style={{
                    fontSize: '12px',
                    color: '#b3b3b3',
                    fontWeight: 400
                  }}
                >
                  Available Cash
                </span>
                {/* VaultRouter connection indicator */}
                <div 
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: isVaultConnected ? '#00d4aa' : '#ff6b6b',
                    opacity: walletData.isConnected ? 1 : 0.3
                  }}
                  title={isVaultConnected ? 'Connected to CoreVault' : 'Vault disconnected'}
                />
              </div>
              <DecryptedText
                text={displayCashValue}
                style={{
                  fontSize: '14px',
                  color: '#FFFFFFFF',
                  fontWeight: 600
                }}
                characters="0123456789$.,+-"
                speed={100}
                maxIterations={12}
                animateOnMount={true}
                animateOnChange={true}
              />
            </div>

            {/* Unrealized PnL Display (only show if there's actual PnL and user is connected) */}
            {walletData.isConnected && 
             unrealizedPnL !== 0 && 
             unrealizedPnL !== null && 
             unrealizedPnL !== undefined && (
              <div 
                className="flex flex-col items-center cursor-pointer transition-opacity duration-200 hover:opacity-80"
                onClick={() => router.push('/portfolio')}
              >
                <span 
                  style={{
                    fontSize: '12px',
                    color: '#b3b3b3',
                    fontWeight: 400
                  }}
                >
                  Unrealized PnL
                </span>
                <DecryptedText
                  text={formatCurrency(String(unrealizedPnL), true)}
                  style={{
                    fontSize: '14px',
                    color: unrealizedPnL >= 0 ? '#00d4aa' : '#ff6b6b',
                    fontWeight: 600
                  }}
                  characters="0123456789$.,+-"
                  speed={100}
                  maxIterations={12}
                  animateOnMount={true}
                />
              </div>
            )}

            {/* Deposit Button */}
            <button 
              className="px-4 py-1.5 rounded-md transition-all duration-200 font-medium"
              style={{
                backgroundColor: '#4a9eff',
                color: '#ffffff',
                fontSize: '13px',
                border: 'none',
                minWidth: '70px'
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as any).style.backgroundColor = '#3d8ae6'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as any).style.backgroundColor = '#4a9eff'
              }}
              onClick={() => {
                console.log('Deposit button clicked');
                setIsDepositModalOpen(true);
              }}
            >
              Deposit
            </button>
          </div>

          {/* Notification Icon */}
          <button 
            className="p-1.5 rounded-md transition-all duration-200"
            style={{ color: '#ffffff' }}
            onMouseEnter={(e) => {
              (e.currentTarget as any).style.color = '#b3b3b3';
              (e.currentTarget as any).style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as any).style.color = '#ffffff';
              (e.currentTarget as any).style.backgroundColor = 'transparent';
            }}
          >
            <NotificationIcon />
          </button>

          {/* User Profile Section */}
          <div 
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer transition-all duration-200"
            onMouseEnter={(e) => {
              (e.currentTarget as any).style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as any).style.backgroundColor = 'transparent'
            }}
            onClick={() => setIsProfileModalOpen(true)}
          >
            {/* Avatar */}
            <div 
              className="flex items-center justify-center rounded-full overflow-hidden"
              style={{
                width: '30px',
                height: '30px',
                backgroundColor: '#00d4aa',
                border: '2px solid #00d4aa'
              }}
            >
              {getAvatarContent()}
            </div>

            {/* Username (hidden on mobile) */}
            <span 
              className="hidden sm:block text-sm font-medium"
              style={{ color: '#ffffff', fontSize: '13px' }}
            >
              {getDisplayName()}
            </span>

            {/* Dropdown Arrow */}
            <div style={{ color: '#b3b3b3' }}>
              <ChevronDownIcon />
            </div>
          </div>
        </div>
      </header>

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        walletAddress={walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-4)}` : 'Not connected'}
        balance={walletData.balance ? `${parseFloat(walletData.balance).toFixed(4)} ETH` : '$0.00'}
        isConnected={walletData.isConnected}
        profilePhotoUrl={walletData.userProfile?.profile_image_url}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
      />

      {/* Deposit Modal */}
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
      />

      {/* {walletData.address && (
        <NetworkStatus userAddress={walletData.address} showDetails={true} />
      )} */}
    </>
  )
} 