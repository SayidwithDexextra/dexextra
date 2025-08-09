'use client'

import { useState } from 'react'
import useWallet from '@/hooks/useWallet'
import { debugWalletDetection } from '@/lib/wallet'

interface WalletModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { providers, connect } = useWallet()
  const [connecting, setConnecting] = useState<string | null>(null)

  if (!isOpen) return null

  const handleConnect = async (providerName: string) => {
    setConnecting(providerName)
    try {
      await connect(providerName)
      onClose()
    } catch (error: unknown) {
      console.error('Connection failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      alert(`Connection failed: ${errorMessage}`)
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

  // Show top 6 wallets (prioritize installed ones)
  const installedWallets = providers.filter(p => p.isInstalled)
  const notInstalledWallets = providers.filter(p => !p.isInstalled)
  const topWallets = [...installedWallets, ...notInstalledWallets].slice(0, 6)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 transition-opacity duration-200"
                  style={{ backgroundColor: 'transparent' }}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative z-10 w-full transition-all duration-200 transform"
        style={{ 
          maxWidth: '360px',
          backgroundColor: '#2b3139',
          borderRadius: '16px',
          border: '1px solid #404854',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: '#404854' }}
        >
          <div className="flex items-center gap-3">
            <h2 
              className="font-semibold"
              style={{ 
                fontSize: '18px',
                color: '#ffffff',
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}
            >
              Connect Wallet
            </h2>
            {/* Debug button */}
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={() => {
                  debugWalletDetection()
                   console.log('🔍 Current providers detected:', providers.map(p => ({ name: p.name, installed: p.isInstalled })))
                }}
                className="text-xs px-2 py-1 rounded transition-colors duration-200"
                style={{
                  backgroundColor: '#363d47',
                  color: '#a7b1bc',
                  border: '1px solid #404854'
                }}
                title="Debug wallet detection (check console)"
              >
                🔍
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-all duration-200 hover:scale-110"
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: '#363d47',
              borderRadius: '6px',
              border: '1px solid #404854',
              color: '#a7b1bc'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Wallet Grid */}
        <div className="p-5">
          <div 
            className="grid gap-3 mb-4"
            style={{ 
              gridTemplateColumns: 'repeat(2, 1fr)'
            }}
          >
            {topWallets.map((provider) => (
              <button
                key={provider.name}
                onClick={() => provider.isInstalled ? handleConnect(provider.name) : window.open(getWalletUrl(provider.name), '_blank')}
                disabled={connecting === provider.name}
                className="relative group transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  backgroundColor: provider.isInstalled ? '#363d47' : '#1e2329',
                  borderRadius: '12px',
                  border: '1px solid #404854',
                  padding: '12px',
                  opacity: connecting === provider.name ? 0.7 : 1,
                }}
              >
                {/* Connecting Overlay */}
                {connecting === provider.name && (
                  <div 
                    className="absolute inset-0 flex items-center justify-center rounded-xl"
                    style={{ backgroundColor: 'rgba(66, 133, 244, 0.1)' }}
                  >
                    <div 
                      className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: '#4285f4' }}
                    />
                  </div>
                )}

                <div className="flex flex-col items-center text-center gap-2">
                  <div 
                    className="text-xl"
                    style={{ 
                      width: '32px', 
                      height: '32px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      backgroundColor: '#2b3139',
                      borderRadius: '8px'
                    }}
                  >
                    {provider.icon}
                  </div>
                  
                  <div>
                    <div 
                      className="font-medium text-xs mb-1"
                      style={{ 
                        color: '#ffffff',
                        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                      }}
                    >
                      {provider.name}
                    </div>
                    <div 
                      className="text-xs"
                      style={{ color: provider.isInstalled ? '#4285f4' : '#6b7280' }}
                    >
                      {provider.isInstalled ? 'Ready' : 'Install'}
                    </div>
                  </div>
                </div>

                {/* Hover Effect */}
                <div 
                  className="absolute inset-0 rounded-xl transition-opacity duration-200 opacity-0 group-hover:opacity-100"
                  style={{ 
                    background: provider.isInstalled 
                      ? 'linear-gradient(135deg, rgba(66, 133, 244, 0.05) 0%, rgba(51, 103, 214, 0.05) 100%)'
                      : 'linear-gradient(135deg, rgba(107, 114, 128, 0.05) 0%, rgba(107, 114, 128, 0.05) 100%)',
                    border: `1px solid ${provider.isInstalled ? 'rgba(66, 133, 244, 0.2)' : 'rgba(107, 114, 128, 0.2)'}`
                  }}
                />
              </button>
            ))}
          </div>

          {/* Alternative Sign In */}
          <div 
            className="relative mb-4"
            style={{ 
              height: '1px',
              backgroundColor: '#404854'
            }}
          >
            <div 
              className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 px-3"
              style={{ backgroundColor: '#2b3139' }}
            >
              <span 
                className="text-xs"
                style={{ color: '#6b7280' }}
              >
                OR
              </span>
            </div>
          </div>

          <button
            className="w-full flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
            style={{
              backgroundColor: '#4285f4',
              color: '#ffffff',
              borderRadius: '10px',
              padding: '12px 16px',
              fontSize: '14px',
              fontWeight: 500,
              border: 'none',
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Footer */}
        <div 
          className="px-5 py-3 border-t text-center"
          style={{ borderColor: '#404854' }}
        >
          <p 
            className="text-xs"
            style={{ 
              color: '#a7b1bc',
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            By connecting, you agree to our{' '}
            <a 
              href="#" 
              className="underline"
              style={{ color: '#4285f4' }}
            >
              Terms
            </a>
            {' '}and{' '}
            <a 
              href="#" 
              className="underline"
              style={{ color: '#4285f4' }}
            >
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  )
} 