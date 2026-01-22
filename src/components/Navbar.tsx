'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import useWallet from '@/hooks/useWallet'
import WalletModal from './WalletModal'
import WalletAccountModal from './WalletAccountModal'

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

interface NavItem {
  id: string
  label: string
  icon: React.ComponentType
  route: string
}

const navigationItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: OverviewIcon, route: '/' },
  // { id: 'explore', label: 'Explore', icon: ExploreIcon, route: '/explore' },
  { id: 'rewards', label: 'Rewards', icon: RewardsIcon, route: '/rewards' },
  // { id: 'favorites', label: 'Favorites', icon: FavoritesIcon, route: '/favorites' },
  // { id: 'send', label: 'Send', icon: SendIcon, route: '/send' },
  // { id: 'swap', label: 'Swap', icon: SwapIcon, route: '/swap' },
  // { id: 'earn', label: 'Earn', icon: EarnIcon, route: '/earn' },
  // { id: 'bridge', label: 'Bridge', icon: BridgeIcon, route: '/bridge' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, route: '/settings' },
]

interface NavbarProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function Navbar({ isOpen, onOpenChange }: NavbarProps) {
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const { walletData, formatAddress, formatBalance } = useWallet()
  const router = useRouter()
  const pathname = usePathname()

  // Token page: shrink navbar to give more room to charts/tables
  const isTokenPage = pathname?.startsWith('/token/')
  const collapsedWidth = isTokenPage ? 52 : 60
  const expandedWidth = isTokenPage ? 208 : 240

  // Determine active item based on current pathname
  const getActiveItem = () => {
    const currentItem = navigationItems.find(item => {
      if (item.route === '/' && pathname === '/') return true
      if (item.route !== '/' && pathname.startsWith(item.route)) return true
      return false
    })
    return currentItem?.id || 'overview'
  }

      return (
      <>
                <nav 
          className="fixed left-0 top-0 h-full bg-gradient-to-b from-[#1a1a1a] to-[#0f0f0f] border-r border-[#333333] transition-all duration-300 ease-in-out"
          style={{
            width: isOpen ? `${expandedWidth}px` : `${collapsedWidth}px`,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            overflowX: 'hidden',
            overflowY: 'auto',
            zIndex: 9999, // High z-index to ensure it overlays all content
            boxShadow: isOpen ? '4px 0 20px rgba(0, 0, 0, 0.3)' : '2px 0 10px rgba(0, 0, 0, 0.2)', // Add shadow when expanded
          }}
          onMouseEnter={() => onOpenChange(true)}
          onMouseLeave={() => onOpenChange(false)}
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
              backgroundColor: '#2a2a2a',
            }}
            onClick={async () => {
              if (walletData.isConnected) {
                setShowAccountModal(true)
              } else {
                setShowWalletModal(true)
              }
            }}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                style={{
                  background: walletData.isConnected 
                    ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                    : 'linear-gradient(135deg, #666 0%, #888 100%)',
                }}
              >
                <span>
                  {walletData.isConnecting 
                    ? '⏳' 
                    : walletData.avatar || '👤'
                  }
                </span>
              </div>
              <div>
                <div className="text-white font-medium text-sm">
                  {walletData.isConnecting 
                    ? 'Connecting...'
                    : walletData.isConnected 
                      ? formatAddress(walletData.address || '')
                      : 'Connect Wallet'
                  }
                </div>
                <div style={{ color: '#a0a0a0', fontSize: '12px' }}>
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
        {!isOpen && (
          <div className="mb-5 flex justify-center">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold cursor-pointer"
              style={{
                background: walletData.isConnected 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                  : 'linear-gradient(135deg, #666 0%, #888 100%)',
              }}
              onClick={async () => {
                if (walletData.isConnected) {
                  setShowAccountModal(true)
                } else {
                  setShowWalletModal(true)
                }
              }}
              title={walletData.isConnected 
                ? `${formatAddress(walletData.address || '')} - ${formatBalance(walletData.balance || '0')}`
                : 'Connect Wallet'
              }
            >
              <span>
                {walletData.isConnecting 
                  ? '⏳' 
                  : walletData.avatar || '👤'
                }
              </span>
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
                  onClick={() => router.push(item.route)}
                  className={`w-full flex items-center transition-all duration-200 ${
                    isOpen ? 'gap-2' : 'justify-center'
                  }`}
                  style={{
                    height: '40px',
                    padding: isOpen ? '10px 12px' : '10px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '400',
                    backgroundColor: isActive 
                      ? 'rgba(74, 144, 226, 0.1)' 
                      : 'transparent',
                    color: isActive ? '#4a90e2' : '#a0a0a0',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                      e.currentTarget.style.color = '#ffffff'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                      e.currentTarget.style.color = '#a0a0a0'
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
             onClick={() => router.push('/markets/create')}
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
             <span>➕ Create Market</span>
           </button>
         )}

         {/* Create Market Icon - Only show when collapsed */}
         {!isOpen && (
           <button
             onClick={() => router.push('/create-market')}
             className="flex items-center justify-center text-white font-semibold transition-all duration-200 hover:opacity-80 cursor-pointer"
             style={{
               height: '40px',
               width: '40px',
               borderRadius: '10px',
               background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)',
               margin: '0 auto',
               border: 'none',
             }}
             title="Create Market"
           >
             <span>➕</span>
           </button>
         )}
          </div>
        </nav>

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