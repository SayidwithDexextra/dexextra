'use client'

import { useMemo, useState } from 'react'
import useWallet from '@/hooks/useWallet'
import { useSession } from '@/contexts/SessionContext'

export interface EnableTradingModalProps {
  isOpen: boolean
  onClose: () => void
  // Optional: open an external wallet selector (e.g., your WalletModal)
  onOpenWallets?: () => void
  // Optional success callback when trading gets enabled
  onSuccess?: (sessionId: string) => void
}

// Minimal, professional system icon for the header area
function EnableTradingIcon() {
  return (
    <div className="w-12 h-12 rounded-xl bg-[#1A1A1A] border border-[#222222] flex items-center justify-center shadow-inner">
      <img
        src="/Dexicon/LOGO-Dexetera-05.svg"
        alt="Dexetera"
        className="w-6 h-6 opacity-90"
      />
    </div>
  )
}

export default function EnableTradingModal({
  isOpen,
  onClose,
  onOpenWallets,
  onSuccess,
}: EnableTradingModalProps) {
  const { walletData, providers, connect, formatAddress } = useWallet()
  const { sessionActive, loading, enableTrading, sessionId } = useSession()
  const [isWorking, setIsWorking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const isConnected = Boolean(walletData?.isConnected && walletData?.address)
  const addressShort = walletData?.address ? formatAddress(walletData.address) : null
  const gaslessEnabled = useMemo(
    () => (typeof process !== 'undefined' && (process as any)?.env?.NEXT_PUBLIC_GASLESS_ENABLED === 'true'),
    []
  )

  const shouldRender = isOpen && !sessionActive

  const handlePrimary = async () => {
    setErrorMessage(null)

    // If not connected, try to connect automatically to first installed provider
    if (!isConnected) {
      try {
        const installed = providers.find(p => p.isInstalled)
        if (installed) {
          setIsWorking(true)
          await connect(installed.name)
        } else if (onOpenWallets) {
          onOpenWallets()
        } else {
          setErrorMessage('No wallet detected. Please install or open a wallet.')
        }
      } catch (e: any) {
        setErrorMessage(e?.message || 'Failed to connect wallet')
      } finally {
        setIsWorking(false)
      }
      return
    }

    // If already connected and session is enabled, close out quickly
    if (sessionActive) {
      onClose()
      return
    }

    // Enable trading (gasless session)
    try {
      setIsWorking(true)
      const res = await enableTrading()
      if (res.success) {
        if (res.sessionId && onSuccess) onSuccess(res.sessionId)
      } else {
        setErrorMessage(res.error || 'Failed to enable trading')
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to enable trading')
    } finally {
      setIsWorking(false)
    }
  }

  const primaryCta = useMemo(() => {
    if (!isConnected) return 'Connect Wallet'
    if (loading || isWorking) return 'Enabling...'
    if (sessionActive) return 'Trading Enabled'
    return 'Enable Trading'
  }, [isConnected, loading, isWorking, sessionActive])

  const primaryDisabled = useMemo(() => {
    if (!isConnected) return false
    if (loading || isWorking) return true
    if (sessionActive) return true
    if (!gaslessEnabled) return true
    return false
  }, [isConnected, loading, isWorking, sessionActive, gaslessEnabled])

  // Ensure hooks above always run; decide rendering after hooks are declared
  if (!shouldRender) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300" onClick={onClose} />

      {/* Container */}
      <div className="relative z-10 w-full max-w-[30rem] bg-[#0F0F0F] rounded-xl border border-[#222222] shadow-2xl transform transition-all duration-300 hover:shadow-3xl">
        {/* Header */}
        <div className="relative p-4 border-b border-[#1A1A1A]">
          <div className="flex flex-col items-center justify-center gap-2">
            <EnableTradingIcon />
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-white tracking-wide text-center">Dexetera Gasless Trading</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#606060] text-center">
                  {isConnected ? 'Wallet connected' : 'Wallet not connected'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-400' : 'bg-[#404040]'}`} />
              </div>
            </div>
          </div>

          <div className="absolute right-4 top-4 flex items-center gap-1.5">
            {/* Refresh Detection Button */}
            <button
              onClick={async () => {
                setIsRefreshing(true)
                try {
                  await new Promise(resolve => setTimeout(resolve, 500))
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

            {/* Close */}
            <button
              onClick={onClose}
              className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
            >
              <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* Empty/Primary State */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-center p-2.5">
              <div className="min-w-0 text-center">
                <span className="text-[11px] font-medium text-white block">
                  {sessionActive ? 'Trading Enabled' : 'Enable Trading'}
                </span>
                <span className="text-[10px] text-[#606060] block">
                  {sessionActive
                    ? 'You can now place trades gaslessly'
                    : 'Let’s set up your wallet to trade on Dexetera'}
                </span>
              </div>
              <div className="hidden items-center gap-2"></div>
            </div>

            {/* Expandable details */}
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-16 overflow-hidden transition-all duration-200">
              <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                <div className="text-[9px] pt-1.5">
                  <span className="text-[#606060] block text-center">
                    {isConnected
                      ? gaslessEnabled
                        ? 'We’ll create a short-lived session for gasless trading.'
                        : 'Gasless trading is disabled by configuration.'
                      : 'Connect your wallet to continue.'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Status Row */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-center p-2.5">
                <div className="flex items-center justify-center gap-2 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-400' : 'bg-[#404040]'}`} />
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-white block text-center truncate">Wallet</span>
                    <span className="text-[10px] text-[#606060] block text-center truncate">
                      {isConnected ? addressShort : 'Not connected'}
                    </span>
                  </div>
                </div>
                <svg className="hidden w-3 h-3 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-center p-2.5">
                <div className="flex items-center justify-center gap-2 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sessionActive ? 'bg-green-400' : (loading || isWorking) ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-white block text-center truncate">Trading Session</span>
                    <span className="text-[10px] text-[#606060] block text-center truncate">
                      {sessionActive ? (sessionId ? `Active • ${sessionId.slice(0, 6)}…` : 'Active') : 'Not enabled'}
                    </span>
                  </div>
                </div>
                <svg className="hidden w-3 h-3 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Error */}
          {errorMessage && (
            <div className="mt-4 bg-[#1A1A1A] border border-[#333333] rounded-md p-3">
              <span className="text-[10px] text-red-400">{errorMessage}</span>
            </div>
          )}

          {/* CTA */}
          <div className="mt-4">
            <button
              onClick={handlePrimary}
              disabled={primaryDisabled}
              className={`w-full h-10 rounded-md text-white text-sm font-medium transition-all duration-200
                ${sessionActive ? 'bg-green-600/70 cursor-default' : primaryDisabled ? 'bg-[#2A2A2A] text-[#808080] cursor-not-allowed' : 'bg-[#166534] hover:bg-[#15803D]'}
              `}
            >
              {primaryCta}
            </button>
            {!gaslessEnabled && (
              <p className="mt-2 text-[10px] text-[#606060] text-center">
                Gasless trading is disabled. Set NEXT_PUBLIC_GASLESS_ENABLED=true to enable.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#1A1A1A] bg-[#0A0A0A] rounded-b-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-[#1A1A1A] rounded flex items-center justify-center">
                <img src="/Dexicon/LOGO-Dexetera-05.svg" alt="Dexetera" className="w-2.5 h-2.5 opacity-70" />
              </div>
              <span className="text-[10px] text-[#808080] font-medium">Dexetera</span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-[#606060]">
                By enabling, you agree to our
                <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">Terms</a>
                and
                <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">Privacy Policy</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


