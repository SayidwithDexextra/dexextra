'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase-browser'
import CryptoMarketTicker, { type MarketTickerItem } from '@/components/CryptoMarketTicker/CryptoMarketTicker'

const STATUS_ENDPOINT = '/api/site-settings/coming-soon'
const WAITLIST_ENDPOINT = '/api/waitlist'

// Local mirror of the GLOBAL launch flag — purely to skip a network round-trip
// on repeat visits. Server state always wins; this is just an optimistic cache.
const LOCAL_GLOBAL_CACHE_KEY = 'dexetera_coming_soon_unlocked_global'
// Per-device whitelist access. Set once a whitelisted visitor enters a valid
// access code. Unlocks THIS browser only — the public gate stays up for others.
const DEVICE_UNLOCK_KEY = 'dexetera_whitelist_access'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ComingSoonGateProps {
  children: React.ReactNode
}

interface GlobalUnlockState {
  unlocked: boolean
  unlocked_at: string | null
}

type EmailStatus = 'idle' | 'submitting' | 'success' | 'error'

export default function ComingSoonGate({ children }: ComingSoonGateProps) {
  // Global launch flag (null = still loading from server).
  const [globalUnlocked, setGlobalUnlocked] = useState<boolean | null>(null)
  // Per-device whitelist access.
  const [deviceUnlocked, setDeviceUnlocked] = useState(false)
  // Drives the fade/scale-out before the gate unmounts.
  const [isExiting, setIsExiting] = useState(false)

  // Email capture state.
  const [email, setEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle')
  const [emailError, setEmailError] = useState('')

  // Whitelist access state.
  const [showWhitelist, setShowWhitelist] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [isShaking, setIsShaking] = useState(false)

  // Live crypto prices for the bottom ticker (a new instance of the home-page
  // ticker, fed externally from /api/crypto-ticker).
  const [cryptoItems, setCryptoItems] = useState<MarketTickerItem[]>([])

  const mountedRef = useRef(true)

  const applyGlobalState = useCallback((unlocked: boolean) => {
    if (!mountedRef.current) return
    setGlobalUnlocked(unlocked)
    if (typeof window !== 'undefined') {
      try {
        if (unlocked) localStorage.setItem(LOCAL_GLOBAL_CACHE_KEY, 'true')
        else localStorage.removeItem(LOCAL_GLOBAL_CACHE_KEY)
      } catch {
        // localStorage may be unavailable (private mode, quota, etc.)
      }
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(STATUS_ENDPOINT, { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as GlobalUnlockState
      applyGlobalState(Boolean(json?.unlocked))
    } catch {
      // Network failure: don't blow away an existing unlocked state — assume
      // still locked only if we have nothing better yet.
      if (mountedRef.current && globalUnlocked === null) setGlobalUnlocked(false)
    }
  }, [applyGlobalState, globalUnlocked])

  useEffect(() => {
    mountedRef.current = true
    if (typeof window === 'undefined') return

    // Optimistic render from caches so returning users never see a flash.
    try {
      if (localStorage.getItem(DEVICE_UNLOCK_KEY) === 'true') setDeviceUnlocked(true)
      if (localStorage.getItem(LOCAL_GLOBAL_CACHE_KEY) === 'true') setGlobalUnlocked(true)
    } catch {
      // ignore storage errors
    }

    fetchStatus()

    // Subscribe to the global flag so every open browser reveals the site the
    // moment the team flips the launch switch.
    const supabase = getSupabaseClient()
    const channel = supabase
      .channel('site-settings-coming-soon')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'site_settings',
          filter: 'key=eq.coming_soon_unlocked',
        },
        (payload: any) => {
          const value = (payload?.new?.value || payload?.record?.value || null) as
            | { unlocked?: boolean }
            | null
          if (value && typeof value.unlocked === 'boolean') {
            applyGlobalState(Boolean(value.unlocked))
          } else {
            fetchStatus()
          }
        },
      )
      .subscribe()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchStatus()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', handleVisibility)
      try {
        supabase.removeChannel(channel)
      } catch {
        // ignore cleanup errors
      }
    }
  }, [applyGlobalState, fetchStatus])

  // Poll live crypto prices for the ticker (CoinGecko/CMC via our route).
  useEffect(() => {
    if (typeof window === 'undefined') return

    const ctrl = new AbortController()

    const load = async () => {
      try {
        const res = await fetch('/api/crypto-ticker', { signal: ctrl.signal })
        const json = await res.json().catch(() => null)
        const coins: any[] =
          res.ok && json?.success && Array.isArray(json.coins) ? json.coins : []

        const mapped: MarketTickerItem[] = coins
          .map((c) => ({
            marketId: String(c?.symbol || ''),
            symbol: String(c?.symbol || '').toUpperCase(),
            market_identifier: String(c?.symbol || '').toUpperCase(),
            name: String(c?.name || c?.symbol || ''),
            price: Number(c?.price) || 0,
            price_change_percentage_24h: Number(c?.change24h) || 0,
            href: typeof c?.url === 'string' ? c.url : undefined,
            external: true,
            iconUrl: typeof c?.image === 'string' ? c.image : undefined,
          }))
          .filter((m) => m.symbol && Number.isFinite(m.price) && m.price > 0)

        if (mountedRef.current && mapped.length > 0) setCryptoItems(mapped)
      } catch {
        // keep whatever we already have
      }
    }

    load()
    const interval = setInterval(load, 60_000)

    return () => {
      ctrl.abort()
      clearInterval(interval)
    }
  }, [])

  const handleNotify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (emailStatus === 'submitting') return
      const value = email.trim().toLowerCase()
      if (!EMAIL_RE.test(value)) {
        setEmailStatus('error')
        setEmailError('Please enter a valid email address.')
        return
      }

      setEmailStatus('submitting')
      setEmailError('')
      try {
        const res = await fetch(WAITLIST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: value, source: 'coming-soon' }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json?.ok) {
          if (mountedRef.current) setEmailStatus('success')
          return
        }
        if (mountedRef.current) {
          setEmailStatus('error')
          setEmailError(json?.error || 'Something went wrong. Try again.')
        }
      } catch {
        if (mountedRef.current) {
          setEmailStatus('error')
          setEmailError('Network error. Try again.')
        }
      }
    },
    [email, emailStatus],
  )

  const grantDeviceAccess = useCallback(() => {
    try {
      localStorage.setItem(DEVICE_UNLOCK_KEY, 'true')
    } catch {
      // ignore storage errors — access still granted for this session
    }
    setIsExiting(true)
    // Let the exit animation play before unmounting the gate.
    setTimeout(() => {
      if (mountedRef.current) setDeviceUnlocked(true)
    }, 600)
  }, [])

  const handleGainAccess = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (isVerifying) return
      const value = code.trim()
      if (!value) return

      setIsVerifying(true)
      setCodeError('')
      try {
        const res = await fetch(STATUS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: value, mode: 'verify' }),
        })
        const json = await res.json().catch(() => ({}))

        if (res.ok && (json?.valid === true || json?.unlocked === true)) {
          grantDeviceAccess()
          return
        }

        if (res.status === 429) {
          setCodeError(json?.error || 'Too many attempts. Try again shortly.')
        } else if (res.status === 401) {
          setCodeError('Invalid access code.')
        } else {
          setCodeError(json?.error || 'Something went wrong. Try again.')
        }
        setIsShaking(true)
        setTimeout(() => mountedRef.current && setIsShaking(false), 500)
      } catch {
        setCodeError('Network error. Try again.')
        setIsShaking(true)
        setTimeout(() => mountedRef.current && setIsShaking(false), 500)
      } finally {
        if (mountedRef.current) setIsVerifying(false)
      }
    },
    [code, isVerifying, grantDeviceAccess],
  )

  // The gate only exists to hold back the public in production. In any
  // non-production build (local dev, preview, etc.) skip it entirely so
  // developers never have to unlock to navigate the site.
  const bypassGate = process.env.NODE_ENV !== 'production'

  const isOpen = bypassGate || globalUnlocked === true || deviceUnlocked
  const isLoading = !bypassGate && globalUnlocked === null && !deviceUnlocked

  // Dev bypass + returning whitelisted / post-launch users skip to the app.
  if (isOpen && !isExiting) {
    return <>{children}</>
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#333333] border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-[9998] bg-[#0A0A0A] flex flex-col transition-all duration-[600ms] ease-out ${
        isExiting ? 'opacity-0 scale-[1.02] blur-sm pointer-events-none' : 'opacity-100 scale-100 blur-0'
      }`}
    >
      {/* Ambient glow to add depth without breaking the minimal feel */}
      <div
        aria-hidden
        className="ambientGlow pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(100% 70% at 50% -15%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 32%, rgba(255,255,255,0) 65%), radial-gradient(80% 50% at 50% 110%, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 60%)',
        }}
      />

      {/* Live crypto ticker pinned to the top — a new instance of the
          home-page ticker fed external CoinGecko/CMC data. */}
      {cryptoItems.length > 0 && (
        <div className="relative shrink-0 border-b border-[#1A1A1A]">
          <CryptoMarketTicker externalItems={cryptoItems} pauseOnHover speed={70} />
        </div>
      )}

      <div className="relative flex-1 overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-5 py-12 sm:px-6 sm:py-16 text-center">
        <div className="w-full max-w-md mx-auto flex flex-col items-center">
          {/* Logo — square-background mark, matching the header */}
          <img
            src="/Dexicon/LOGO-Dexetera-square-padded.svg"
            alt="Dexetera"
            className="w-14 h-14 sm:w-16 sm:h-16 mb-4 drop-shadow-[0_0_12px_rgba(0,0,0,0.45)]"
          />

          {/* Brand wordmark — matches the header treatment */}
          <span
            className="text-white text-sm uppercase mb-8"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: '0.18em' }}
          >
            Dexetera
          </span>

          {/* Headline */}
          <h1 className="text-xl sm:text-2xl font-medium text-white tracking-tight mb-3">
            Coming soon
          </h1>

          <p className="text-[#808080] text-sm leading-relaxed mb-9 max-w-xs">
            Be the first in when we go live.
          </p>

          {/* Email capture */}
          {emailStatus === 'success' ? (
            <div className="w-full max-w-sm">
              <div className="flex items-center justify-center gap-2.5 bg-[#0F0F0F] border border-[#222222] rounded-md px-4 py-3.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-sm text-[#9CA3AF]">
                  You&apos;re on the list — we&apos;ll be in touch.
                </span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleNotify} className="w-full max-w-sm" noValidate>
              <div className="group flex items-stretch bg-[#0F0F0F] rounded-md border border-[#222222] focus-within:border-[#333333] hover:border-[#333333] transition-all duration-200 overflow-hidden">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (emailStatus === 'error') {
                      setEmailStatus('idle')
                      setEmailError('')
                    }
                  }}
                  placeholder="you@email.com"
                  disabled={emailStatus === 'submitting'}
                  className="flex-1 min-w-0 bg-transparent px-4 py-3.5 text-sm text-white placeholder-[#404040] outline-none disabled:opacity-60"
                  aria-label="Email address"
                />
                <button
                  type="submit"
                  disabled={emailStatus === 'submitting' || email.trim().length === 0}
                  className="flex-shrink-0 px-4 sm:px-5 text-sm font-medium text-[#0F0F0F] bg-white hover:bg-[#E5E5E5] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {emailStatus === 'submitting' ? (
                    <span className="w-4 h-4 border-2 border-[#999999] border-t-[#0F0F0F] rounded-full animate-spin" />
                  ) : (
                    'Notify me'
                  )}
                </button>
              </div>
              {emailStatus === 'error' && emailError && (
                <p className="text-red-400 text-[11px] mt-2 text-left px-1">{emailError}</p>
              )}
            </form>
          )}

          {/* Whitelist access */}
          <div className="mt-10 w-full max-w-sm">
            {!showWhitelist ? (
              <button
                type="button"
                onClick={() => setShowWhitelist(true)}
                className="text-[11px] text-[#606060] hover:text-[#9CA3AF] uppercase tracking-[0.16em] transition-colors duration-200"
              >
                You&apos;re on the whitelist?
              </button>
            ) : (
              <div className="animate-fade-in">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                  <span className="text-[11px] text-[#808080] uppercase tracking-[0.16em]">
                    Whitelist access
                  </span>
                </div>
                <form onSubmit={handleGainAccess}>
                  <div className="group flex items-stretch bg-[#0F0F0F] rounded-md border border-[#222222] focus-within:border-[#333333] hover:border-[#333333] transition-all duration-200 overflow-hidden">
                    <input
                      type="password"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value)
                        if (codeError) setCodeError('')
                      }}
                      placeholder="Enter access code"
                      disabled={isVerifying}
                      autoFocus
                      className={`flex-1 min-w-0 bg-transparent px-4 py-3.5 text-sm text-white placeholder-[#404040] outline-none disabled:opacity-60 ${
                        isShaking ? 'animate-shake' : ''
                      }`}
                      aria-label="Whitelist access code"
                    />
                    <button
                      type="submit"
                      disabled={isVerifying || code.trim().length === 0}
                      className="flex-shrink-0 px-4 sm:px-5 text-sm font-medium text-white bg-[#1A1A1A] hover:bg-[#2A2A2A] border-l border-[#222222] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {isVerifying ? (
                        <span className="w-4 h-4 border-2 border-[#444444] border-t-white rounded-full animate-spin" />
                      ) : (
                        'Gain access'
                      )}
                    </button>
                  </div>
                  {codeError && (
                    <p className="text-red-400 text-[11px] mt-2 text-left px-1">{codeError}</p>
                  )}
                </form>
              </div>
            )}
          </div>

          {/* Footer link */}
          <div className="mt-12 flex flex-col items-center gap-4">
            <div className="w-20 h-px bg-gradient-to-r from-transparent via-[#2A2A2A] to-transparent" />
            <a
              href="https://dexetera.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 text-[11px] text-[#606060] hover:text-[#9CA3AF] transition-colors duration-200"
            >
              dexetera.org
              <svg
                className="w-3 h-3 opacity-70 group-hover:opacity-100 transition-opacity duration-200"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
      </div>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }

        /* Slow breathing drift of the main glow */
        @keyframes glowDrift {
          0%   { transform: translate3d(-3%, -2%, 0) scale(1.05); opacity: 0.85; }
          50%  { transform: translate3d(3%, 2%, 0) scale(1.15); opacity: 1; }
          100% { transform: translate3d(-3%, -2%, 0) scale(1.05); opacity: 0.85; }
        }
        .ambientGlow {
          animation: glowDrift 18s ease-in-out infinite;
          will-change: transform, opacity;
        }

        @media (prefers-reduced-motion: reduce) {
          .ambientGlow {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
