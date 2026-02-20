'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wallet } from 'lucide-react'

interface SpokeDepositModalProps {
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
  onSubmit: (amount: string) => Promise<void> | void
  selectedToken: { symbol: string; icon: string }
  defaultAmount?: string
  isSubmitting?: boolean
  errorMessage?: string | null
  warningMessage?: string | null
}

export default function SpokeDepositModal({
  isOpen,
  onClose,
  onBack,
  onSubmit,
  selectedToken,
  defaultAmount = '1',
  isSubmitting = false,
  errorMessage,
  warningMessage
}: SpokeDepositModalProps) {
  const [amount, setAmount] = useState(defaultAmount)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setAmount(defaultAmount)
      setLocalError(null)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, defaultAmount])

  if (!isOpen) return null

  const handleSubmit = async () => {
    setLocalError(null)
    try {
      await onSubmit(amount)
    } catch (err: any) {
      // Safety net: don't let async click handlers surface as unhandled rejections.
      setLocalError(err?.message || 'Failed to process deposit')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300" />

      <div
        data-walkthrough="deposit-spoke-modal"
        className="group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-xl border border-[#222222] transition-all duration-200"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1A1A1A]">
          {onBack ? (
            <button
              onClick={onBack}
              className="group flex items-center justify-center w-8 h-8 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200"
              aria-label="Back"
            >
              <svg className="w-4 h-4 text-[#808080] group-hover:text-white transition-colors duration-200" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ) : (
            <div className="w-8 h-8" />
          )}

          <div className="flex items-center gap-3 min-w-0 flex-1 justify-center">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            <div className="relative group">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, rgba(96, 165, 250, 0.9) 0%, rgba(6, 182, 212, 0.9) 50%, rgba(139, 92, 246, 0.9) 100%)',
                  boxShadow: '0 8px 32px rgba(96, 165, 250, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                }}
              >
                <img
                  src={selectedToken.icon}
                  alt={selectedToken.symbol}
                  className="w-6 h-6 rounded-full"
                />
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

        {/* Title */}
        <div className="px-6 pt-3 pb-1 text-center space-y-1">
          <h2 className="text-lg font-semibold text-white">Deposit {selectedToken.symbol} (Arbitrum)</h2>
          <p className="text-[11px] text-[#808080]">Enter the amount to deposit to the spoke vault.</p>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-2 space-y-3">
          {warningMessage && (
            <div className="group bg-[#1A140A] rounded-md border border-amber-400/30 transition-all duration-200">
              <div className="flex items-start gap-2 p-2.5">
                <div className="w-1.5 h-1.5 mt-1 rounded-full bg-amber-400" />
                <div className="text-[11px] text-amber-100 leading-relaxed">
                  {warningMessage}
                </div>
              </div>
            </div>
          )}

          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-3 border-b border-[#1A1A1A]">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Amount
              </div>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-0.5 rounded">
                {selectedToken.symbol}
              </div>
            </div>
            <div className="p-3">
              <input
                data-walkthrough="deposit-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-white text-lg font-semibold placeholder:text-[#404040] outline-none"
              />
              <div className="mt-2 text-[10px] text-[#606060]">
                Funds deposit directly to the Arbitrum spoke vault.
              </div>
            </div>
          </div>

          {(errorMessage || localError) && (
            <div className="group bg-[#1A0F0F] rounded-md border border-red-500/30 transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <div className="text-[11px] text-red-200">
                  {errorMessage || localError}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2">
          <button
            type="button"
            onClick={handleSubmit}
            data-walkthrough="deposit-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className={[
              'group relative w-full inline-flex items-center justify-center gap-2 overflow-hidden rounded-full',
              'border border-[#222222] bg-[#0F0F0F] px-5 py-2.5 text-[12px] font-medium text-white',
              'transition-all duration-200 hover:bg-[#1A1A1A] hover:border-[#333333]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A2A2A] focus-visible:ring-offset-0',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:border-[#222222]/60 disabled:bg-[#0F0F0F]/80'
            ].join(' ')}
            style={{
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.03)'
            }}
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            {isSubmitting ? (
              <>
                <div className="relative h-3.5 w-3.5">
                  <div className="absolute inset-0 rounded-full border border-white/10" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-white/90 border-r-white/40 border-b-white/20 border-l-white/10 animate-spin" />
                </div>
                <span className="tracking-wide">Depositing</span>
              </>
            ) : (
              <>
                <div className="relative w-1.5 h-1.5 flex-shrink-0">
                  <div className="absolute inset-0 rounded-full bg-green-400" />
                  <div
                    className="absolute inset-0 rounded-full shadow-[0_0_0_6px_rgba(74,222,128,0.18)] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    aria-hidden="true"
                  />
                </div>
                <span className="tracking-wide">Deposit</span>
                <Wallet className="h-4 w-4 text-white" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}




