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

function CircleCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 18.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <path
        d="M6.2 10.2 8.7 12.7 13.8 7.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CircleDotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 18.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <path d="M10 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" fill="currentColor" />
    </svg>
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

  const isConnected = Boolean(walletData?.isConnected && walletData?.address)
  const addressShort = walletData?.address ? formatAddress(walletData.address) : null
  const gaslessEnabled = useMemo(
    () => (process.env.NEXT_PUBLIC_GASLESS_ENABLED === 'true'),
    []
  )

  const shouldRender = isOpen

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

    if (!gaslessEnabled) return
    if (sessionActive) return

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
    if (!gaslessEnabled) return 'Gasless Disabled'
    if (loading || isWorking) return 'Signing...'
    if (sessionActive) return 'Activated'
    return 'Sign to Activate'
  }, [isConnected, loading, isWorking, sessionActive])

  const primaryDisabled = useMemo(() => {
    if (!isConnected) return false
    if (!gaslessEnabled) return true
    return loading || isWorking || sessionActive
  }, [isConnected, loading, isWorking, sessionActive, gaslessEnabled])

  // Ensure hooks above always run; decide rendering after hooks are declared
  if (!shouldRender) {
    return null
  }

  const walletRowLeftIcon = isConnected ? (
    <CircleCheckIcon className="h-5 w-5 text-green-400" />
  ) : (
    <CircleDotIcon className="h-5 w-5 text-[#404040]" />
  )

  const sessionRowLeftIcon = sessionActive ? (
    <CircleCheckIcon className="h-5 w-5 text-green-400" />
  ) : (
    <CircleDotIcon className="h-5 w-5 text-[#404040]" />
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-200" onClick={onClose} />

      {/* Container */}
      <div className="relative z-10 w-full max-w-[30rem] bg-[#0F0F0F] rounded-md border border-[#222222] shadow-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
          aria-label="Close"
        >
          <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="p-4 border-b border-[#1A1A1A]">
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-[#1A1A1A] border border-[#222222] flex items-center justify-center shadow-inner">
              <img src="/Dexicon/LOGO-Dexetera-05.svg" alt="Dexetera" className="w-6 h-6 opacity-90" />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-white tracking-wide text-center">Activate Gasless Mode</span>
              <span className="text-[10px] text-[#606060] text-center">
                {isConnected ? 'Wallet Connected' : 'Wallet Not Connected'}
              </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-4">
          <div className="space-y-3">
            {/* Wallet row */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="flex items-center justify-center">{walletRowLeftIcon}</div>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#9CA3AF] min-w-0 truncate">Wallet Connected</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white font-mono truncate max-w-[10rem]">
                    {isConnected ? addressShort : '—'}
                  </span>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060] block">
                      {isConnected ? 'Wallet is ready.' : 'Connect your wallet to continue.'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Session row */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="flex items-center justify-center">{sessionRowLeftIcon}</div>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#9CA3AF] min-w-0 truncate">Trading Session</span>
                    {(loading || isWorking) && !sessionActive ? (
                      <span className="text-[10px] text-blue-400">Signing…</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`text-[10px] px-1.5 py-0.5 rounded border
                      ${sessionActive ? 'text-green-400 bg-[#1A1A1A] border-[#333333]' : 'text-[#606060] bg-[#1A1A1A] border-[#222222]'}
                    `}
                  >
                    {sessionActive ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060] block">
                      {sessionActive
                        ? sessionId
                          ? `Session: ${sessionId.slice(0, 10)}…`
                          : 'Session is active.'
                        : gaslessEnabled
                          ? 'Sign once to create a short-lived gasless trading session.'
                          : 'Gasless trading is disabled by configuration.'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error / Config hint */}
          {errorMessage && (
            <div className="mt-4 bg-[#1A1A1A] border border-[#333333] rounded-md p-3">
              <span className="text-[10px] text-red-400">{errorMessage}</span>
            </div>
          )}
          {!gaslessEnabled && (
            <div className="mt-4 bg-[#1A1A1A] border border-[#333333] rounded-md p-3">
              <span className="text-[10px] text-[#606060]">
                Gasless trading is disabled. Set <span className="font-mono text-white">NEXT_PUBLIC_GASLESS_ENABLED=true</span> to enable.
              </span>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handlePrimary}
            disabled={primaryDisabled}
            className={`mt-4 w-full h-10 rounded-md text-white text-sm font-medium transition-all duration-200
              ${sessionActive
                ? 'bg-green-600/70 cursor-default'
                : primaryDisabled
                  ? 'bg-[#2A2A2A] text-[#808080] cursor-not-allowed'
                  : 'bg-[#166534] hover:bg-[#15803D]'}
            `}
          >
            {primaryCta}
          </button>

          <p className="mt-2 text-[10px] text-[#606060] text-center">
            By signing, you agree to our
            <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">
              Terms
            </a>
            and
            <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors duration-200 mx-1 underline">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}


