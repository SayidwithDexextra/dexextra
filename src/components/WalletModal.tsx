'use client'

import { useState } from 'react'
import useWallet from '@/hooks/useWallet'
import { debugWalletDetection } from '@/lib/wallet'

interface WalletModalProps {
  isOpen: boolean
  onClose: () => void
}

// Professional wallet icons with official brand colors and designs
const WalletIcons = {
  'MetaMask': () => (
    <img 
      src="https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//MetaMask_Fox.svg.png"
      alt="MetaMask"
      width="32"
      height="32"
      style={{ borderRadius: '8px' }}
      onError={(e) => {
        // Fallback to original SVG if image fails
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        target.insertAdjacentHTML('afterend', `
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#F6851B"/>
            <path d="M26.2 8.5L17.8 14.3L19.4 10.2L26.2 8.5Z" fill="#E2761B" stroke="#E2761B" strokeWidth="0.1"/>
            <path d="M5.8 8.5L14.1 14.4L12.6 10.2L5.8 8.5Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1"/>
            <path d="M22.8 21.6L20.6 24.9L25.8 26.3L27.2 21.7L22.8 21.6Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1"/>
            <path d="M4.8 21.7L6.2 26.3L11.4 24.9L9.2 21.6L4.8 21.7Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1"/>
            <path d="M11.1 15.8L9.8 17.8L15 18L14.8 12.3L11.1 15.8Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1"/>
            <path d="M20.9 15.8L17.1 12.2L17 18L22.2 17.8L20.9 15.8Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1"/>
          </svg>
        `);
      }}
    />
  ),
  'Coinbase Wallet': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#0052FF"/>
      <path d="M16 24C20.4183 24 24 20.4183 24 16C24 11.5817 20.4183 8 16 8C11.5817 8 8 11.5817 8 16C8 20.4183 11.5817 24 16 24Z" fill="white"/>
      <path d="M13.5 13.5H18.5V18.5H13.5V13.5Z" fill="#0052FF"/>
    </svg>
  ),
  'Trust Wallet': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#trustGradient)"/>
      <path d="M16 6L24 10V16C24 20.5 20.5 24.5 16 26C11.5 24.5 8 20.5 8 16V10L16 6Z" fill="white"/>
      <path d="M16 8L22 11.5V16C22 19.5 19.5 22.5 16 24C12.5 22.5 10 19.5 10 16V11.5L16 8Z" fill="#3375BB"/>
      <defs>
        <linearGradient id="trustGradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#3375BB"/>
          <stop offset="1" stopColor="#1A5490"/>
        </linearGradient>
      </defs>
    </svg>
  ),
  'Zerion': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#zerionGradient)"/>
      <path d="M8 16L16 8V24L8 16Z" fill="white"/>
      <path d="M24 16L16 24V8L24 16Z" fill="white" fillOpacity="0.7"/>
      <defs>
        <linearGradient id="zerionGradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#2962FF"/>
          <stop offset="1" stopColor="#1565C0"/>
        </linearGradient>
      </defs>
    </svg>
  ),
  'Rainbow': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#rainbowGradient)"/>
      <path d="M6 20C6 12.268 12.268 6 20 6V10C14.477 10 10 14.477 10 20H6Z" fill="white"/>
      <path d="M10 20C10 16.686 12.686 14 16 14V18C14.895 18 14 18.895 14 20H10Z" fill="white"/>
      <circle cx="20" cy="20" r="2" fill="white"/>
      <defs>
        <linearGradient id="rainbowGradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#FF6B6B"/>
          <stop offset="0.25" stopColor="#4ECDC4"/>
          <stop offset="0.5" stopColor="#45B7D1"/>
          <stop offset="0.75" stopColor="#96CEB4"/>
          <stop offset="1" stopColor="#FFEAA7"/>
        </linearGradient>
      </defs>
    </svg>
  ),
  'Phantom': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#phantomGradient)"/>
      <path d="M16 8C20.4 8 24 11.6 24 16C24 20.4 20.4 24 16 24C11.6 24 8 20.4 8 16C8 11.6 11.6 8 16 8Z" fill="white"/>
      <path d="M11 15C11.5523 15 12 14.5523 12 14C12 13.4477 11.5523 13 11 13C10.4477 13 10 13.4477 10 14C10 14.5523 10.4477 15 11 15Z" fill="#AB9FF2"/>
      <path d="M21 15C21.5523 15 22 14.5523 22 14C22 13.4477 21.5523 13 21 13C20.4477 13 20 13.4477 20 14C20 14.5523 20.4477 15 21 15Z" fill="#AB9FF2"/>
      <path d="M16 20C18 20 19.5 18.5 19.5 16.5H12.5C12.5 18.5 14 20 16 20Z" fill="#AB9FF2"/>
      <defs>
        <linearGradient id="phantomGradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#AB9FF2"/>
          <stop offset="1" stopColor="#7B68EE"/>
        </linearGradient>
      </defs>
    </svg>
  ),
  'WalletConnect': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#3B99FC"/>
      <path d="M10.5 13.5C13.5 10.5 18.5 10.5 21.5 13.5L22 14L20.5 15.5L20 15C17.8 12.8 14.2 12.8 12 15L11.5 15.5L10 14L10.5 13.5Z" fill="white"/>
      <circle cx="12.5" cy="18.5" r="1.5" fill="white"/>
      <circle cx="19.5" cy="18.5" r="1.5" fill="white"/>
    </svg>
  ),
  'Rabby': () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#7C3AED"/>
      <path d="M16 8C20.4 8 24 11.6 24 16C24 20.4 20.4 24 16 24C11.6 24 8 20.4 8 16C8 11.6 11.6 8 16 8Z" fill="white"/>
      <path d="M14 12L18 14L16 18L14 16V12Z" fill="#7C3AED"/>
      <circle cx="13" cy="14" r="1" fill="#7C3AED"/>
      <circle cx="19" cy="14" r="1" fill="#7C3AED"/>
    </svg>
  ),
}

export default function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { providers, connect } = useWallet()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  if (!isOpen) return null

  const handleConnect = async (providerName: string) => {
    setConnecting(providerName)
    try {
      await connect(providerName)
      onClose()
    } catch (error: unknown) {
      console.error('Connection failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      // Use a more sophisticated error display instead of alert
      console.error(`Connection failed: ${errorMessage}`)
    } finally {
      setConnecting(null)
    }
  }

  const getWalletUrl = (walletName: string): string => {
    const walletUrls: Record<string, string> = {
      'MetaMask': 'https://metamask.io',
      'Coinbase Wallet': 'https://www.coinbase.com/wallet',
      'Trust Wallet': 'https://trustwallet.com',
      'Zerion': 'https://zerion.io',
      'Rainbow': 'https://rainbow.me',
      'Phantom': 'https://phantom.app',
      'WalletConnect': 'https://walletconnect.com',
      'Rabby': 'https://rabby.io',
    }
    return walletUrls[walletName] || 'https://ethereum.org/wallets'
  }

  const openExternalLink = (url: string) => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank')
    }
  }

  // Show top 6 wallets (prioritize installed ones)
  const installedWallets = providers.filter(p => p.isInstalled)
  const notInstalledWallets = providers.filter(p => !p.isInstalled)
  const topWallets = [...installedWallets, ...notInstalledWallets].slice(0, 6)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Sophisticated Backdrop with Subtle Gradient */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300"
        onClick={onClose}
      />
      
      {/* Main Modal Container - Sophisticated Minimal Design */}
      <div className="relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] shadow-2xl transform transition-all duration-300 hover:shadow-3xl">
        
        {/* Header Section with Dexetra Branding */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3">
            {/* Dexetra Logo */}
            <div className="w-7 h-7 bg-[#1A1A1A] rounded-md flex items-center justify-center flex-shrink-0">
              <img 
                src="/Dexicon/LOGO-Dexetera-05.svg" 
                alt="Dexetra" 
                className="w-5 h-5 opacity-90"
              />
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <h2 className="text-sm font-medium text-white tracking-wide">
              Connect to Dexetra
            </h2>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-1 rounded">
              {topWallets.length}
            </div>
            
            {/* Refresh Detection Button */}
            <button
              onClick={async () => {
                setIsRefreshing(true)
                try {
                  // Wait a moment for animation
                  await new Promise(resolve => setTimeout(resolve, 500))
                  // Force re-detection of wallets
                  if (typeof window !== 'undefined') {
                    window.location.reload()
                  }
                } finally {
                  setIsRefreshing(false)
                }
              }}
              disabled={isRefreshing}
              className="opacity-70 hover:opacity-100 transition-all duration-200 p-1 hover:bg-green-500/10 rounded text-green-400 hover:text-green-300 disabled:opacity-50"
              title="Refresh wallet detection"
            >
              <svg 
                className={`w-3 h-3 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Debug Control - Development Only */}
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={() => {
                  debugWalletDetection()
                  console.log('🔍 Current providers detected:', providers.map(p => ({ name: p.name, installed: p.isInstalled })))
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-blue-500/10 rounded text-blue-400 hover:text-blue-300"
                title="Debug wallet detection (check console)"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Close Button with Sophisticated Hover */}
          <button
            onClick={onClose}
            className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
          >
            <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Sophisticated Wallet Grid */}
        <div className="p-6">
          {/* Section Header */}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Available Wallets
            </h4>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-[#606060]">{installedWallets.length} Ready</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3 mb-6">
            {topWallets.map((provider) => {
              const IconComponent = WalletIcons[provider.name as keyof typeof WalletIcons]
              
              return (
                <div
                  key={provider.name}
                  className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
                >
                  {/* Main Content */}
                  <div 
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => provider.isInstalled ? handleConnect(provider.name) : openExternalLink(getWalletUrl(provider.name))}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${provider.isInstalled ? 'bg-green-400' : 'bg-[#404040]'}`} />
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="flex-shrink-0">
                          {IconComponent ? <IconComponent /> : provider.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] font-medium text-white block truncate">
                            {provider.name}
                          </span>
                          <span className={`text-[10px] ${provider.isInstalled ? 'text-green-400' : 'text-[#606060]'}`}>
                            {provider.isInstalled ? 'Ready' : 'Install'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {connecting === provider.name && (
                        <div className="w-3 h-3">
                          <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      <svg className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  
                  {/* Expandable Details on Hover */}
                  <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-16 overflow-hidden transition-all duration-200">
                    <div className="px-3 pb-3 border-t border-[#1A1A1A]">
                      <div className="text-[9px] pt-2">
                        <span className="text-[#606060]">
                          {provider.isInstalled ? 'Click to connect' : 'Click to install wallet'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Sophisticated Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#1A1A1A]"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#0F0F0F] px-3 text-[#606060] uppercase tracking-wide">
                Alternative Options
              </span>
            </div>
          </div>

          {/* Alternative Authentication - Sophisticated Button */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <button className="w-full flex items-center justify-between p-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-[#1A1A1A] rounded-md flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-white block truncate">
                      Continue with Google
                    </span>
                    <span className="text-[10px] text-blue-400">
                      Social Login
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
            
            {/* Expandable Details on Hover */}
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-16 overflow-hidden transition-all duration-200">
              <div className="px-3 pb-3 border-t border-[#1A1A1A]">
                <div className="text-[9px] pt-2">
                  <span className="text-[#606060]">
                    Quick access with your Google account
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sophisticated Footer with Dexetra Branding */}
        <div className="px-6 py-4 border-t border-[#1A1A1A] bg-[#0A0A0A] rounded-b-xl">
          <div className="flex items-center justify-between">
            {/* Brand Section */}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-[#1A1A1A] rounded flex items-center justify-center">
                <img 
                  src="/Dexicon/LOGO-Dexetera-05.svg" 
                  alt="Dexetra" 
                  className="w-2.5 h-2.5 opacity-70"
                />
              </div>
              <span className="text-[10px] text-[#808080] font-medium">
                Dexetra
              </span>
            </div>
            
            {/* Legal Links */}
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-[#606060]">
                By connecting, you agree to our
                <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">
                  Terms
                </a>
                and
                <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 