'use client'

import { createPortal } from 'react-dom'
import { env } from '@/lib/env'
import { useMemo, useState } from 'react'

type ExternalDepositToken = { symbol: string; icon: string; name?: string; chain?: string }

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
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(depositAddress || 'NOT_CONFIGURED')}`

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
                    <img
                      src={qrSrc}
                      alt="Deposit QR Code"
                      width={180}
                      height={180}
                      className="rounded"
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
                        onClick={handleFunctionDeposit}
                        disabled={functionCtaLoading || !hasFunctionHandler}
                        className="group relative inline-flex items-center justify-center gap-2 rounded-md border border-[#333333] bg-[#121212] px-5 py-2.5 text-[11px] font-medium text-white hover:bg-[#1A1A1A] hover:border-[#444444] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                      >
                        {functionCtaLoading ? (
                          <>
                            <div className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
                            <span>Processing</span>
                          </>
                        ) : (
                          <>
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasFunctionHandler ? 'bg-green-400' : 'bg-[#404040]'}`} />
                            <span>{functionDepositCtaLabel}</span>
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

