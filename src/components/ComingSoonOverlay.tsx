'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase-browser'

const STATUS_ENDPOINT = '/api/site-settings/coming-soon'
// Local mirror of the global flag — purely for skipping a network round-trip on
// repeat visits. Server state always wins; this is just an optimistic cache.
const LOCAL_CACHE_KEY = 'dexetera_coming_soon_unlocked_global'

interface ComingSoonGateProps {
  children: React.ReactNode
}

interface UnlockState {
  unlocked: boolean
  unlocked_at: string | null
}

export default function ComingSoonGate({ children }: ComingSoonGateProps) {
  const [isUnlocked, setIsUnlocked] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isShaking, setIsShaking] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mountedRef = useRef(true)

  const applyState = useCallback((unlocked: boolean) => {
    if (!mountedRef.current) return
    setIsUnlocked(unlocked)
    if (typeof window !== 'undefined') {
      try {
        if (unlocked) {
          localStorage.setItem(LOCAL_CACHE_KEY, 'true')
        } else {
          localStorage.removeItem(LOCAL_CACHE_KEY)
        }
      } catch {
        // localStorage may be unavailable (private mode, quota, etc.)
      }
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(STATUS_ENDPOINT, { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as UnlockState
      applyState(Boolean(json?.unlocked))
    } catch (e) {
      // Network failure: don't blow away an existing unlocked state — fall back
      // to whatever we already have (server-trust still wins on next attempt).
      if (mountedRef.current && isUnlocked === null) {
        setIsUnlocked(false)
      }
    }
  }, [applyState, isUnlocked])

  useEffect(() => {
    mountedRef.current = true
    if (typeof window === 'undefined') return

    // Optimistic render from local cache so returning users never see a flash.
    let cached: string | null = null
    try {
      cached = localStorage.getItem(LOCAL_CACHE_KEY)
    } catch {
      cached = null
    }
    if (cached === 'true') {
      setIsUnlocked(true)
    }

    fetchStatus()

    // Subscribe to global flag changes so every open browser unlocks the moment
    // any user enters the right code.
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
            applyState(Boolean(value.unlocked))
          } else {
            // Schema we didn't expect — refetch authoritative state.
            fetchStatus()
          }
        },
      )
      .subscribe()

    // Re-check whenever the tab regains focus to catch unlocks that happened
    // while this tab was backgrounded.
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
  }, [applyState, fetchStatus])

  const handleUnlock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (isSubmitting) return
      const code = password.trim()
      if (!code) return

      setIsSubmitting(true)
      setError('')
      try {
        const res = await fetch(STATUS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        const json = await res.json().catch(() => ({}))

        if (res.ok && (json?.unlocked === true)) {
          applyState(true)
          setError('')
          return
        }

        if (res.status === 429) {
          setError(json?.error || 'Too many attempts. Try again shortly.')
        } else if (res.status === 401) {
          setError('Invalid access code')
        } else {
          setError(json?.error || 'Something went wrong. Try again.')
        }
        setIsShaking(true)
        setTimeout(() => mountedRef.current && setIsShaking(false), 500)
      } catch {
        setError('Network error. Try again.')
        setIsShaking(true)
        setTimeout(() => mountedRef.current && setIsShaking(false), 500)
      } finally {
        if (mountedRef.current) setIsSubmitting(false)
      }
    },
    [applyState, isSubmitting, password],
  )

  if (isUnlocked === null) {
    return (
      <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#333333] border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (isUnlocked) {
    return <>{children}</>
  }

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center overflow-auto">
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center max-w-lg">
        <div className="mb-8">
          <img
            src="/Dexicon/LOGO-Dexetera-03.svg"
            alt="Dexetera"
            className="w-16 h-16 mx-auto"
          />
        </div>

        <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-1 rounded uppercase tracking-widest mb-6 border border-[#222222]">
          Coming Soon
        </div>

        <h1 className="text-3xl md:text-4xl font-medium text-white mb-3 tracking-tight">
          Dexetera
        </h1>

        <p className="text-[#808080] text-sm md:text-base mb-6 leading-relaxed">
          Gas-free trading on Hyperliquid.<br />
          Create and trade any measurable market.
        </p>

        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] text-[#606060] uppercase tracking-wide">
              Release Date: May 8th, 2026
            </span>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="w-full max-w-xs mb-8">
          <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden">
            <div className="flex items-center">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
                placeholder="Enter access code"
                disabled={isSubmitting}
                className={`flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-[#404040] outline-none transition-all duration-200 disabled:opacity-60 ${
                  isShaking ? 'animate-shake' : ''
                }`}
                autoFocus
              />
              <button
                type="submit"
                disabled={isSubmitting || password.trim().length === 0}
                className="px-4 py-3 text-[#808080] hover:text-white transition-colors duration-200 border-l border-[#222222] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-[#333333] border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-[11px] mt-2 text-left px-1">
              {error}
            </p>
          )}
        </form>

        <div className="flex flex-col items-center gap-3">
          <span className="text-[10px] text-[#404040] uppercase tracking-widest">
            Learn more
          </span>
          <a
            href="https://dexetera.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] rounded-md border border-[#222222] hover:border-[#333333] px-4 py-2.5 transition-all duration-200"
          >
            <span className="text-sm text-[#9CA3AF] group-hover:text-white transition-colors duration-200">
              dexetera.org
            </span>
            <svg
              className="w-3.5 h-3.5 text-[#606060] group-hover:text-[#808080] transition-colors duration-200"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        <div className="mt-12 w-24 h-px bg-gradient-to-r from-transparent via-[#333333] to-transparent" />
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
      `}</style>
    </div>
  )
}
