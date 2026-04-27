'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Image from 'next/image'
import useWallet from '@/hooks/useWallet'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'
import WalletModal from './WalletModal'
import WalletAccountModal from './WalletAccountModal'
import { isMagicSelectedWallet, showMagicWalletUI } from '@/lib/magic'

// Icon components - using SVG for now, can be replaced with icon library
const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const OverviewIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="7" height="7" fill="currentColor" opacity="0.8"/>
    <rect x="14" y="3" width="7" height="7" fill="currentColor" opacity="0.6"/>
    <rect x="3" y="14" width="7" height="7" fill="currentColor" opacity="0.4"/>
    <rect x="14" y="14" width="7" height="7" fill="currentColor" opacity="0.2"/>
  </svg>
)

const ExploreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88 16.24,7.76" fill="currentColor"/>
  </svg>
)

const RewardsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 15.09,8.26 22,9 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9 8.91,8.26 12,2" fill="currentColor"/>
  </svg>
)

const FavoritesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 15.09,8.26 22,9 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9 8.91,8.26 12,2" stroke="currentColor" strokeWidth="2" fill="none"/>
  </svg>
)

const WatchlistIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
)

const SupportIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2a8 8 0 0 0-8 8v1a3 3 0 0 0 3 3h1v-3a4 4 0 1 1 8 0v3h1a3 3 0 0 0 3-3v-1a8 8 0 0 0-8-8Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 17v1a4 4 0 0 0 8 0v-1"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2"/>
    <polygon points="22,2 15,22 11,13 2,9 22,2" fill="currentColor"/>
  </svg>
)

const SwapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 3L21 8L16 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 8H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 21L3 16L8 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 16H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const EarnIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

const BridgeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 12H18M6 12C6 15.31 8.69 18 12 18C15.31 18 18 15.31 18 12M6 12C6 8.69 8.69 6 12 6C15.31 6 18 8.69 18 12M2 12H6M18 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

const AnalyticsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 19V13M5 19V16M13 19V9M17 19V5M21 19V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 19H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

interface NavItem {
  id: string
  label: string
  icon: React.ComponentType
  route: string
}

const navigationItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: OverviewIcon, route: '/' },
  { id: 'explore', label: 'Explore', icon: ExploreIcon, route: '/explore' },
  { id: 'watchlist', label: 'Watchlist', icon: WatchlistIcon, route: '/watchlist' },
  { id: 'analytics', label: 'Analytics', icon: AnalyticsIcon, route: '/analytics' },
  // { id: 'rewards', label: 'Rewards', icon: RewardsIcon, route: '/rewards' },
  // { id: 'favorites', label: 'Favorites', icon: FavoritesIcon, route: '/favorites' },
  // { id: 'send', label: 'Send', icon: SendIcon, route: '/send' },
  // { id: 'swap', label: 'Swap', icon: SwapIcon, route: '/swap' },
  // { id: 'earn', label: 'Earn', icon: EarnIcon, route: '/earn' },
  // { id: 'bridge', label: 'Bridge', icon: BridgeIcon, route: '/bridge' },
  { id: 'support', label: 'Support', icon: SupportIcon, route: '/support' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, route: '/settings' },
]

interface NavbarProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function Navbar({ isOpen, onOpenChange }: NavbarProps) {
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const { walletData, formatAddress, formatBalance } = useWallet()
  const router = useRouter()
  const pathname = usePathname()

  // Two-phase mount/unmount for smooth slide animation (mirrors PortfolioSidebar)
  const [mobileRendered, setMobileRendered] = useState(false)
  const [mobileEntered, setMobileEntered] = useState(false)
  const raf1Ref = useRef<number | null>(null)
  const raf2Ref = useRef<number | null>(null)

  // Token page: shrink navbar to give more room to charts/tables
  const isTokenPage = pathname?.startsWith('/token/')
  const collapsedWidth = isTokenPage ? 52 : 60
  const expandedWidth = isTokenPage ? 208 : 240

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateMobileState = () => {
      setIsMobile(mediaQuery.matches)
    }
    updateMobileState()
    mediaQuery.addEventListener('change', updateMobileState)
    return () => mediaQuery.removeEventListener('change', updateMobileState)
  }, [])

  // Listen for mobile menu toggle events from Header
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleMobileMenuToggle = (e: CustomEvent<{ isOpen: boolean }>) => {
      onOpenChange(e.detail.isOpen)
    }
    window.addEventListener('mobileMenu:toggle', handleMobileMenuToggle as EventListener)
    return () => window.removeEventListener('mobileMenu:toggle', handleMobileMenuToggle as EventListener)
  }, [onOpenChange])

  // Animate mobile menu enter/exit (same pattern as PortfolioSidebar)
  useEffect(() => {
    if (!isMobile) return
    if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
    if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
    raf1Ref.current = null
    raf2Ref.current = null

    if (isOpen) {
      setMobileRendered(true)
      setMobileEntered(false)
      raf1Ref.current = requestAnimationFrame(() => {
        raf2Ref.current = requestAnimationFrame(() => setMobileEntered(true))
      })
      return () => {
        if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
        if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
        raf1Ref.current = null
        raf2Ref.current = null
      }
    }
    setMobileEntered(false)
    const t = setTimeout(() => setMobileRendered(false), 320)
    return () => clearTimeout(t)
  }, [isOpen, isMobile])

  // Lock background scroll while mobile menu is rendered
  useEffect(() => {
    if (!isMobile || !mobileRendered) return
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
    }
  }, [isMobile, mobileRendered])

  // Determine active item based on current pathname
  const getActiveItem = () => {
    const currentItem = navigationItems.find(item => {
      if (item.route === '/' && pathname === '/') return true
      if (item.route !== '/' && pathname.startsWith(item.route)) return true
      return false
    })
    return currentItem?.id || ''
  }

  // Dispatch close event to sync with Header
  const closeMobileMenu = () => {
    onOpenChange(false)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mobileMenu:close'))
    }
  }

  const openWalletSurface = async () => {
    // If the user is using Magic, prefer Magic's built-in wallet UI.
    if (walletData.isConnected && isMagicSelectedWallet()) {
      const res = await showMagicWalletUI()
      if (res.success) return
      try {
        console.warn('[Navbar] showMagicWalletUI failed:', res.error)
      } catch {}
      // Fall through to existing modals if Magic UI isn't available.
    }
    if (walletData.isConnected) setShowAccountModal(true)
    else setShowWalletModal(true)
  }

  // On mobile when not rendered (after exit animation completes), only keep modals
  if (isMobile && !mobileRendered) {
    return (
      <>
        <WalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
        />

        <WalletAccountModal
          isOpen={showAccountModal}
          onClose={() => setShowAccountModal(false)}
        />
      </>
    )
  }

      return (
      <>
        {/* Mobile: full-screen sliding overlay - encapsulates entire screen */}
        {isMobile && mobileRendered && (
          <>
            {/* Backdrop - fades in when menu opens */}
            <button
              type="button"
              aria-label="Close navigation menu"
              className={`fixed inset-0 z-[9997] transition-opacity duration-300 ease-in-out ${mobileEntered ? 'opacity-100' : 'opacity-0'}`}
              style={{
                background: 'var(--t-overlay)',
              }}
              onClick={closeMobileMenu}
            />
            {/* Full-screen sliding panel */}
            <nav 
              className={[
                'fixed left-0 top-0 border-r',
                'transform-gpu transition-transform duration-300 ease-in-out will-change-transform',
                mobileEntered ? 'translate-x-0' : '-translate-x-full',
              ].join(' ')}
              data-walkthrough="navbar"
              style={{
                width: '100vw',
                height: '100dvh',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                overflowX: 'hidden',
                overflowY: 'auto',
                zIndex: 9999,
                boxShadow: '4px 0 24px rgba(0, 0, 0, 0.4)',
                background: 'linear-gradient(to bottom, var(--t-chrome), var(--t-page))',
                borderColor: 'var(--t-chrome-border)',
              }}
            >
              <div 
                className="h-full flex flex-col pt-14"
                style={{
                  padding: '20px 16px',
                  minWidth: 0,
                  width: '100%',
                }}
              >
                {isMobile && isOpen && (
                  <div className="mb-4 flex items-center justify-between -mt-2">
                    <span className="text-base font-semibold" style={{ color: 'var(--t-chrome-fg)' }}>Menu</span>
                    <button
                      onClick={closeMobileMenu}
                      className="w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200"
                      style={{
                        borderColor: 'var(--t-chrome-border-sub)',
                        color: 'var(--t-chrome-fg-sub)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--t-chrome-fg)'
                        e.currentTarget.style.borderColor = 'var(--t-chrome-border)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--t-chrome-fg-sub)'
                        e.currentTarget.style.borderColor = 'var(--t-chrome-border-sub)'
                      }}
                      aria-label="Close navigation menu"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {/* Wallet Header - shown when mobile menu is open */}
                <div 
                  className="flex items-center justify-between mb-6 cursor-pointer"
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--t-chrome-surface)',
                  }}
                  onClick={openWalletSurface}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden text-sm font-bold"
                      style={{
                        color: 'var(--t-chrome-fg)',
                        background: walletData.isConnected 
                          ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                          : 'linear-gradient(135deg, #666 0%, #888 100%)',
                      }}
                    >
                      {walletData.isConnecting 
                        ? <span>⏳</span>
                        : <Image src={walletData.userProfile?.profile_image_url || DEFAULT_PROFILE_IMAGE} alt="Profile" width={40} height={40} className="w-full h-full object-cover" />
                      }
                    </div>
                    <div>
                      <div className="font-medium text-base" style={{ color: 'var(--t-chrome-fg)' }}>
                        {walletData.isConnecting 
                          ? 'Connecting...'
                          : walletData.isConnected 
                            ? formatAddress(walletData.address || '')
                            : 'Connect Wallet'
                        }
                      </div>
                      <div style={{ color: 'var(--t-chrome-fg-sub)', fontSize: '13px' }}>
                        {walletData.isConnected 
                          ? formatBalance(walletData.balance || '0')
                          : 'Tap to connect'
                        }
                      </div>
                    </div>
                  </div>
                  <ChevronDownIcon />
                </div>
                {/* Navigation Items */}
                <div className="flex flex-col space-y-1">
                  {navigationItems.map((item) => {
                    const Icon = item.icon
                    const isActive = getActiveItem() === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          router.push(item.route)
                          closeMobileMenu()
                        }}
                        className="w-full flex items-center gap-3"
                        data-walkthrough={`nav:${item.id}`}
                        style={{
                          height: '48px',
                          padding: '0 14px',
                          borderRadius: '10px',
                          fontSize: '15px',
                          fontWeight: '500',
                          backgroundColor: isActive 
                            ? 'rgba(74, 144, 226, 0.15)' 
                            : 'transparent',
                          color: isActive ? '#4a90e2' : 'var(--t-chrome-fg)',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = 'var(--t-chrome-hover)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }
                        }}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
                {/* New Market Button */}
                <div className="mt-8">
                  <button
                    onClick={() => {
                      router.push('/new-market')
                      closeMobileMenu()
                    }}
                    data-walkthrough="new-market"
                    className="flex items-center justify-center text-white font-semibold text-base w-full transition-all duration-200 hover:opacity-90"
                    style={{
                      height: '52px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)',
                      border: 'none',
                    }}
                  >
                    ➕ New Market
                  </button>
                </div>
              </div>
            </nav>
          </>
        )}

        {/* Desktop Navbar */}
        {!isMobile && (
        <nav 
          className="fixed left-0 top-0 h-full border-r transition-all duration-300 ease-in-out"
          data-walkthrough="navbar"
          style={{
            width: isOpen ? `${expandedWidth}px` : `${collapsedWidth}px`,
            height: '100%',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            overflowX: 'hidden',
            overflowY: 'auto',
            zIndex: 9999,
            boxShadow: isOpen ? '4px 0 20px rgba(0, 0, 0, 0.3)' : 'none',
            background: 'linear-gradient(to bottom, var(--t-chrome), var(--t-page))',
            borderColor: 'var(--t-chrome-border)',
          }}
          onMouseEnter={() => {
            if (!isMobile) onOpenChange(true)
          }}
          onMouseLeave={() => {
            if (!isMobile) onOpenChange(false)
          }}
        >
          <div 
            className="h-full flex flex-col"
            style={{
              padding: isOpen
                ? (isTokenPage ? '16px 10px' : '20px 12px')
                : (isTokenPage ? '16px 6px' : '20px 8px'),
              minWidth: 0, // Prevents flex items from growing beyond container
              width: '100%'
            }}
          >
            {/* Wallet Header */}
            {isOpen && (
          <div 
            className="flex items-center justify-between mb-5 cursor-pointer"
            style={{
              padding: '12px',
              borderRadius: '10px',
              backgroundColor: 'var(--t-chrome-surface)',
            }}
            onClick={openWalletSurface}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden text-sm font-bold"
                style={{
                  color: 'var(--t-chrome-fg)',
                  background: walletData.isConnected 
                    ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                    : 'linear-gradient(135deg, #666 0%, #888 100%)',
                }}
              >
                {walletData.isConnecting 
                  ? <span>⏳</span>
                  : <Image src={walletData.userProfile?.profile_image_url || DEFAULT_PROFILE_IMAGE} alt="Profile" width={36} height={36} className="w-full h-full object-cover" />
                }
              </div>
              <div>
                <div className="font-medium text-sm" style={{ color: 'var(--t-chrome-fg)' }}>
                  {walletData.isConnecting 
                    ? 'Connecting...'
                    : walletData.isConnected 
                      ? formatAddress(walletData.address || '')
                      : 'Connect Wallet'
                  }
                </div>
                <div style={{ color: 'var(--t-chrome-fg-sub)', fontSize: '12px' }}>
                  {walletData.isConnected 
                    ? formatBalance(walletData.balance || '0')
                    : 'Click to connect'
                  }
                </div>
              </div>
            </div>
            <ChevronDownIcon />
          </div>
        )}

        {/* Wallet Avatar/Connection */}
        {!isOpen && !isMobile && (
          <div className="mb-5 flex justify-center">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden text-xs font-bold cursor-pointer"
              style={{
                color: 'var(--t-chrome-fg)',
                background: walletData.isConnected 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                  : 'linear-gradient(135deg, #666 0%, #888 100%)',
              }}
              onClick={openWalletSurface}
              title={walletData.isConnected 
                ? `${formatAddress(walletData.address || '')} - ${formatBalance(walletData.balance || '0')}`
                : 'Connect Wallet'
              }
            >
              {walletData.isConnecting 
                ? <span>⏳</span>
                : <Image src={walletData.userProfile?.profile_image_url || DEFAULT_PROFILE_IMAGE} alt="Profile" width={32} height={32} className="w-full h-full object-cover" />
              }
            </div>
          </div>
        )}

        {/* Navigation Items */}
        <nav className="flex-1 flex flex-col justify-between">
          <div className="flex flex-col justify-start space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const isActive = getActiveItem() === item.id
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    router.push(item.route)
                    if (isMobile) closeMobileMenu()
                  }}
                  className={`w-full flex items-center transition-all duration-200 ${
                    isOpen ? 'gap-2' : 'justify-center'
                  }`}
                  data-walkthrough={`nav:${item.id}`}
                  style={{
                    height: '40px',
                    padding: isOpen ? '10px 12px' : '10px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '400',
                    backgroundColor: isActive 
                      ? 'rgba(74, 144, 226, 0.1)' 
                      : 'transparent',
                    color: isActive ? '#4a90e2' : 'var(--t-chrome-fg-sub)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--t-chrome-hover)'
                      e.currentTarget.style.color = 'var(--t-chrome-fg)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                      e.currentTarget.style.color = 'var(--t-chrome-fg-sub)'
                    }
                  }}
                  title={!isOpen ? item.label : undefined}
                >
                  <Icon />
                  {isOpen && <span>{item.label}</span>}
                </button>
              )
            })}
          </div>
          
          {/* Spacer to push Create Market button down, but not too far */}
          <div className="flex-1 min-h-[20px] max-h-[60px]"></div>
        </nav>

                 {/* Create Market Button - Only show when open */}
         {isOpen && (
           <button
             onClick={() => {
               router.push('/new-market')
               if (isMobile) closeMobileMenu()
             }}
             data-walkthrough="new-market"
             className="flex items-center justify-center text-white font-semibold text-base transition-all duration-200 hover:opacity-80 cursor-pointer"
             style={{
               height: '50px',
               borderRadius: '10px',
               background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)',
               padding: '12px',
               border: 'none',
               width: '100%',
             }}
           >
             <span>➕ New Market</span>
           </button>
         )}

         {/* Create Market Icon - Only show when collapsed */}
         {!isOpen && !isMobile && (
           <button
             onClick={() => {
               router.push('/new-market')
             }}
             data-walkthrough="new-market"
             className="flex items-center justify-center text-white font-semibold transition-all duration-200 hover:opacity-80 cursor-pointer"
             style={{
               height: '40px',
               width: '40px',
               borderRadius: '10px',
               background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)',
               margin: '0 auto',
               border: 'none',
             }}
             title="New Market"
           >
             <span>➕</span>
           </button>
         )}
          </div>
        </nav>
        )}
      {/* Wallet Connection Modal */}
      <WalletModal 
        isOpen={showWalletModal} 
        onClose={() => setShowWalletModal(false)} 
      />

      {/* Wallet Account Modal */}
      <WalletAccountModal 
        isOpen={showAccountModal} 
        onClose={() => setShowAccountModal(false)} 
      />
    </>
  )
} 