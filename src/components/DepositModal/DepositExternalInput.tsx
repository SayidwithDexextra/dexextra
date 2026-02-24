'use client'

import { createPortal } from 'react-dom'
import { env } from '@/lib/env'
import { useMemo, useState, useEffect } from 'react'
import { Wallet } from 'lucide-react'

type ExternalDepositToken = { symbol: string; icon: string; name?: string; chain?: string }

// Cache QR image object URLs per address to avoid repeat network fetch + delay
const qrCache = new Map<string, string>()

interface DepositExternalInputProps {
  isOpen: boolean
  onClose: () => void
  onBack: () => void
  selectedToken: ExternalDepositToken
  /**
   * Optional handler to trigger a contract/function-based deposit from the UI.
   * When provided, the component will render a primary "Deposit" CTA.
   */
  onFunctionDeposit?: (token: ExternalDepositToken) => Promise<void>
  /**
   * Optional loading flag for the deposit button when managed by parent.
   */
  isFunctionDepositLoading?: boolean
  /**
   * Optional override for the CTA label.
   */
  functionDepositLabel?: string
}

export default function DepositExternalInput({
  isOpen,
  onClose,
  onBack,
  selectedToken,
  onFunctionDeposit,
  isFunctionDepositLoading,
  functionDepositLabel
}: DepositExternalInputProps) {
  if (!isOpen) return null

  const chain = (selectedToken?.chain || 'External')
  const depositAddress = useMemo(() => {
    const c = chain.toLowerCase()
    if (c === 'polygon') return env.SPOKE_POLYGON_VAULT_ADDRESS || ''
    if (c === 'arbitrum') return env.SPOKE_ARBITRUM_VAULT_ADDRESS || ''
    if (c === 'ethereum') return env.SPOKE_ETHEREUM_VAULT_ADDRESS || ''
    if (c === 'hyperliquid') return env.SPOKE_HYPERLIQUID_VAULT_ADDRESS || ''
    return ''
  }, [chain])

  const [copied, setCopied] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [qrSrc, setQrSrc] = useState(() => {
    const cached = depositAddress ? qrCache.get(depositAddress) : null
    return (
      cached ||
      `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(depositAddress || 'NOT_CONFIGURED')}`
    )
  })
  const [qrLoaded, setQrLoaded] = useState(false)

  // Preload QR image once and reuse cached object URL to remove visible delay
  useEffect(() => {
    const addr = depositAddress || 'NOT_CONFIGURED'
    const cached = qrCache.get(addr)
    if (cached) {
      setQrSrc(cached)
      setQrLoaded(true)
      return
    }

    const controller = new AbortController()
    const qrHost = 'https://api.qrserver.com'
    const existingPreconnect = document.head.querySelector(
      `link[rel="preconnect"][href="${qrHost}"]`
    )
    if (!existingPreconnect) {
      const link = document.createElement('link')
      link.rel = 'preconnect'
      link.href = qrHost
      link.crossOrigin = ''
      document.head.appendChild(link)
    }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(addr)}`

    fetch(qrUrl, { signal: controller.signal })
      .then((res) => res.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob)
        qrCache.set(addr, objectUrl)
        setQrSrc(objectUrl)
        setQrLoaded(true)
      })
      .catch(() => {
        // Fallback to direct URL if prefetch fails
        setQrSrc(qrUrl)
        setQrLoaded(false)
      })

    return () => controller.abort()
  }, [depositAddress])

  const copyAddress = async () => {
    try {
      if (depositAddress) {
        await navigator.clipboard.writeText(depositAddress)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }
    } catch {}
  }

  const handleFunctionDeposit = async () => {
    if (!onFunctionDeposit || isSubmitting || isFunctionDepositLoading) return
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await onFunctionDeposit(selectedToken)
    } catch (err: any) {
      const message = err?.message || 'Failed to start deposit. Please try again.'
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasFunctionHandler = Boolean(onFunctionDeposit)
  const showFunctionCta = true
  const functionDepositCtaLabel = functionDepositLabel || 'Deposit'
  const functionCtaLoading = Boolean(isSubmitting || isFunctionDepositLoading)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300" />

      {/* Container */}
      <div
        className="group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] transition-all duration-200"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1A1A1A]">
          <button
            onClick={onBack}
            className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" viewBox="0 0 24 24" fill="none">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="flex items-center gap-3 min-w-0 flex-1 justify-center">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            <div className="relative group">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, rgba(96, 165, 250, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                  boxShadow: '0 8px 32px rgba(96, 165, 250, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                <img
                  src={selectedToken.icon}
                  alt={selectedToken.symbol}
                  className="w-5 h-5 rounded-full"
                />
              </div>
            </div>
            <div className="min-w-0 text-center">
              <div className="flex items-center gap-2 justify-center">
                <h2 className="text-sm font-medium text-white tracking-wide uppercase">
                  {chain} Deposit
                </h2>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-0.5 rounded">
                  {selectedToken.symbol}
                </div>
              </div>
              <div className="text-[10px] text-[#606060]">
                Scan QR or copy the address to deposit on {chain}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="group flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 border bg-red-500/10 border-red-500/20 hover:bg-red-500/15 hover:border-red-500/30"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-red-400 group-hover:text-red-300 transition-colors duration-200" viewBox="0 0 24 24" fill="none">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-4">
          {/* Unified Deposit Container */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            {/* Address header + pill */}
            <div className="p-3 border-b border-[#1A1A1A]">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Deposit Address
                </h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {chain}
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-[#222222] bg-[#0F0F0F] px-3 py-2">
                <span className="text-[10px] text-white font-mono truncate flex-1">
                  {depositAddress || 'Not configured'}
                </span>
                <button
                  onClick={copyAddress}
                  className="opacity-100 transition-opacity duration-200 p-1 hover:bg-[#2A2A2A] rounded border border-[#222222] hover:border-[#333333] disabled:opacity-50"
                  aria-label="Copy deposit address"
                  disabled={!depositAddress}
                  title={copied ? 'Copied' : 'Copy address'}
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-green-400" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none">
                      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* QR + Notice row */}
            <div className="p-3">
              <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-3">
                {/* QR code left */}
                <div className="flex items-center justify-center">
                  <div className="p-2 rounded-md border border-[#222222] bg-white">
                    {!qrLoaded && (
                      <div className="absolute -mt-1 -ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    )}
                    <img
                      src={qrSrc}
                      alt="Deposit QR Code"
                      width={180}
                      height={180}
                      className="rounded"
                      decoding="async"
                      loading="eager"
                      fetchPriority="high"
                      onLoad={() => setQrLoaded(true)}
                    />
                  </div>
                </div>
                {/* Notice right */}
                <div className="rounded-md border border-[#222222] bg-[#1A1A1A] px-4 py-4 flex flex-col gap-3 justify-center">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasFunctionHandler ? 'bg-green-400' : 'bg-[#404040]'}`} />
                    <div className="text-xs text-white">Deposit {selectedToken?.symbol}</div>
                  </div>
                  <div className="text-[10px] text-[#9CA3AF]">
                    Send only {selectedToken?.symbol} on the {chain} network.
                  </div>
                  {showFunctionCta && (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <button
                        type="button"
                        onClick={handleFunctionDeposit}
                        data-walkthrough="deposit-function-cta"
                        disabled={functionCtaLoading || !hasFunctionHandler}
                        aria-busy={functionCtaLoading}
                        className={[
                          'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full',
                          'border border-[#222222] bg-[#0F0F0F] px-5 py-2.5 text-[11px] font-medium text-white',
                          'transition-all duration-200 hover:bg-[#1A1A1A] hover:border-[#333333]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A2A2A] focus-visible:ring-offset-0',
                          'disabled:opacity-50 disabled:cursor-not-allowed disabled:border-[#222222]/60 disabled:bg-[#0F0F0F]/80'
                        ].join(' ')}
                        style={{
                          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.03)'
                        }}
                      >
                        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                        {functionCtaLoading ? (
                          <>
                            <div className="relative h-3 w-3">
                              <div className="absolute inset-0 rounded-full border border-white/10" />
                              <div className="absolute inset-0 rounded-full border-2 border-t-white/90 border-r-white/40 border-b-white/20 border-l-white/10 animate-spin" />
                            </div>
                            <span className="tracking-wide">Processing</span>
                          </>
                        ) : (
                          <>
                            <div className="relative w-1.5 h-1.5 flex-shrink-0">
                              <div className={`absolute inset-0 rounded-full ${hasFunctionHandler ? 'bg-green-400' : 'bg-[#404040]'}`} />
                              <div
                                className={`absolute inset-0 rounded-full ${
                                  hasFunctionHandler ? 'shadow-[0_0_0_6px_rgba(74,222,128,0.18)]' : ''
                                } opacity-0 group-hover:opacity-100 transition-opacity duration-200`}
                                aria-hidden="true"
                              />
                            </div>
                            <span className="tracking-wide">{functionDepositCtaLabel}</span>
                            <Wallet className="h-4 w-4 text-white" aria-hidden="true" />
                          </>
                        )}
                      </button>
                      {!hasFunctionHandler && (
                        <div className="text-[10px] text-[#606060]">
                          Connect a wallet to enable deposits.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Warning if not configured */}
          {!depositAddress && (
            <div className="group bg-[#0F0F0F] rounded-md border border-yellow-500/30 transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <div className="text-[11px] text-[#808080]">
                  This chain’s spoke vault address is not configured. Please set it via environment variables.
                </div>
              </div>
            </div>
          )}
          {submitError && (
            <div className="group bg-[#1A0F0F] rounded-md border border-red-500/30 transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <div className="text-[11px] text-red-200">
                  {submitError}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1A1A1A] bg-[#0F0F0F]">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onBack}
              className="group relative w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-[#333333] bg-[#1A1A1A] hover:bg-[#2A2A2A] hover:border-[#444444] transition-all duration-200"
            >
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
              <span className="text-[11px] font-medium text-white">Back to Chain Selection</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

