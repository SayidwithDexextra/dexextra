'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

const WAITLIST_ENDPOINT = '/api/waitlist'
const CRYPTO_TICKER_ENDPOINT = '/api/crypto-ticker'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type EmailStatus = 'idle' | 'submitting' | 'success' | 'error'

interface OrbitIcon {
  symbol: string
  image: string
}

// Scatter positions for the floating in-market icon tiles, kept clear of the
// centre where the logo + headline live. Percentages are relative to the hero
// stage, so the whole cluster scales with the viewport.
const ORBIT_SLOTS: {
  top: string
  left: string
  size: number
  delay: string
  duration: string
  rotate: number
}[] = [
  // Large, irregular scatter around the centre logo — sized and spaced to
  // mimic the OpenSea hero (bold ~90–130px tiles hugging the perimeter of a
  // bounded composition box). Radii, sizes and tilts all vary; every slot
  // stays out of the centre column (~30%–70% horizontally, ~22%–76%
  // vertically) so nothing overlaps the logo/copy.
  { top: '8%', left: '14%', size: 88, delay: '0s', duration: '6.4s', rotate: -14 }, // top-left
  { top: '3%', left: '72%', size: 74, delay: '0.9s', duration: '7.7s', rotate: 11 }, // top-right
  { top: '34%', left: '3%', size: 68, delay: '0.35s', duration: '6.9s', rotate: -8 }, // left, flanking logo
  { top: '26%', left: '94%', size: 96, delay: '1.3s', duration: '8.0s', rotate: 16 }, // right, biggest
  { top: '70%', left: '4%', size: 78, delay: '0.6s', duration: '6.2s', rotate: -12 }, // lower-left
  { top: '68%', left: '95%', size: 70, delay: '0.15s', duration: '7.4s', rotate: 10 }, // lower-right
  { top: '92%', left: '20%', size: 90, delay: '1.6s', duration: '6.7s', rotate: -16 }, // bottom-left
  { top: '94%', left: '74%', size: 66, delay: '0.75s', duration: '8.2s', rotate: 20 }, // bottom-right
]

interface Reward {
  id: string
  title: string
  tag: string
  summary: string
  detail: string
  dot: string
  icon: ReactNode
}

const REWARDS: Reward[] = [
  {
    id: 'early-rate',
    title: 'Early rate',
    tag: 'Locked in',
    summary: 'The lowest fee tier on the platform, locked in for good.',
    detail:
      'Everyone who arrives before launch trades at our founding-member rate. That fee tier never expires and never resets — even as public pricing rises around it.',
    dot: 'bg-green-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V4a1 1 0 011-1z" />
      </svg>
    ),
  },
  {
    id: 'free-marketing',
    title: 'Free marketing',
    tag: 'Amplified',
    summary: 'We put your markets in front of our whole audience.',
    detail:
      'Markets you create or seed early get featured across our channels, newsletter, and in-app spotlights — real distribution, at zero cost, while volume is easiest to win.',
    dot: 'bg-blue-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
  },
  {
    id: 'token-drop',
    title: 'Discounted token drop',
    tag: '−% at TGE',
    summary: 'Early allocation at a discount when the token launches.',
    detail:
      'Early Access members receive a reserved allocation of the platform token at a discount to the public launch price — priced for the people who showed up first.',
    dot: 'bg-yellow-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'smart-money',
    title: 'Smart Money Prediction Market',
    tag: 'Exclusive',
    summary: 'Access to our Smart Money signal system.',
    detail:
      'See where informed capital is positioning before the crowd. Early Access unlocks our Smart Money Prediction Market system — the same edge our sharpest traders use to front-run consensus.',
    dot: 'bg-green-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    id: 'deposit-match',
    title: '1:1 deposit match',
    tag: 'Match 100%',
    summary: 'We match your deposit, dollar for dollar.',
    detail:
      'Fund your account during Early Access and we match it 1 to 1 — double your starting balance to trade the earliest, least-crowded markets with real size.',
    dot: 'bg-green-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
]

const STATS: { value: string; label: string }[] = [
  { value: '1:1', label: 'Deposit match' },
  { value: '5', label: 'Member perks' },
  { value: '−%', label: 'Token drop price' },
  { value: '24/7', label: 'Smart Money edge' },
  { value: '$0', label: 'To join' },
]

const STEPS: { k: string; title: string; body: string }[] = [
  {
    k: '01',
    title: 'Join the waitlist',
    body: 'Reserve your spot and lock in the founding rate before the doors open.',
  },
  {
    k: '02',
    title: "You're first in",
    body: 'Early Access opens to you ahead of the public — no queue, no crowd.',
  },
  {
    k: '03',
    title: 'Trade the earliest markets',
    body: 'The least-crowded markets are the cleanest edge — and we match your deposit 1 to 1.',
  },
  {
    k: '04',
    title: 'Get amplified',
    body: 'We put your markets in front of our audience and unlock the Smart Money system.',
  },
  {
    k: '05',
    title: 'Token drop',
    body: 'Claim your reserved allocation at a discount to the public launch price.',
  },
]

interface EarlyAccessRewardsProps {
  /** 'panel' tones down hero sizing for the slide-up sheet; 'page' is full editorial. */
  variant?: 'panel' | 'page'
  /** Hide the built-in waitlist form (e.g. when the host already has one). */
  showWaitlist?: boolean
  /** Optional close handler — renders a dismiss affordance when provided. */
  onClose?: () => void
}

export default function EarlyAccessRewards({
  variant = 'page',
  showWaitlist = true,
  onClose,
}: EarlyAccessRewardsProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<EmailStatus>('idle')
  const [error, setError] = useState('')

  // Live in-market asset icons for the orbiting hero (same source the
  // coming-soon gate ticker uses). Falls back to a bare logo hero if the
  // fetch yields nothing.
  const [orbitIcons, setOrbitIcons] = useState<OrbitIcon[]>([])

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(CRYPTO_TICKER_ENDPOINT, { signal: ctrl.signal })
        const json = await res.json().catch(() => null)
        const coins: any[] = res.ok && json?.success && Array.isArray(json.coins) ? json.coins : []
        const mapped: OrbitIcon[] = coins
          .map((c) => ({ symbol: String(c?.symbol || '').toUpperCase(), image: String(c?.image || '') }))
          .filter((c) => c.symbol && /^https?:\/\//.test(c.image))
          .slice(0, ORBIT_SLOTS.length)
        if (mapped.length > 0) setOrbitIcons(mapped)
      } catch {
        // keep the bare-logo fallback
      }
    })()
    return () => ctrl.abort()
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (status === 'submitting') return
      const value = email.trim().toLowerCase()
      if (!EMAIL_RE.test(value)) {
        setStatus('error')
        setError('Please enter a valid email address.')
        return
      }
      setStatus('submitting')
      setError('')
      try {
        const res = await fetch(WAITLIST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: value, source: 'early-access-rewards' }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json?.ok) {
          setStatus('success')
          return
        }
        setStatus('error')
        setError(json?.error || 'Something went wrong. Try again.')
      } catch {
        setStatus('error')
        setError('Network error. Try again.')
      }
    },
    [email, status],
  )

  const isPanel = variant === 'panel'

  return (
    <div className="w-full">
      {/* ───────────────────────── Hero — floating orbit ───────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Full-page stage — centres the composition vertically. */}
        <div
          className={`relative mx-auto w-full px-5 flex items-center justify-center ${
            isPanel ? 'max-w-3xl min-h-[calc(100svh-4rem)]' : 'max-w-6xl min-h-[100svh]'
          }`}
        >
          {/* Bounded composition box — keeps the large icon cluster compact
              around the logo (mimicking the OpenSea hero) instead of scattering
              across the whole viewport height. */}
          <div
            className={`relative mx-auto w-full ${
              isPanel
                ? 'max-w-3xl h-[min(86vh,640px)]'
                : 'max-w-6xl h-[min(88vh,860px)]'
            }`}
          >
            {/* Orbiting in-market asset tiles */}
            {ORBIT_SLOTS.map((slot, i) => {
              const icon = orbitIcons[i]
              if (!icon) return null
              return (
                <div
                  key={slot.top + slot.left}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ top: slot.top, left: slot.left }}
                  aria-hidden
                >
                  {/* Rotation wrapper — keeps the tilt off the centring
                      transform (anchor) and the float animation (tile). */}
                  <div style={{ transform: `rotate(${slot.rotate}deg)` }}>
                    <div
                      className="dex-orbit-tile rounded-2xl border border-[#222222] bg-gradient-to-b from-[#161616] to-[#0C0C0C] p-2 overflow-hidden"
                      style={{
                        width: slot.size,
                        height: slot.size,
                        animationDelay: slot.delay,
                        animationDuration: slot.duration,
                        boxShadow:
                          '0 0 22px rgba(255,255,255,0.05), 0 10px 30px rgba(0,0,0,0.55)',
                      }}
                      title={icon.symbol}
                    >
                      {/* Artwork tilts with the frame (no counter-rotation). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={icon.image}
                        alt={icon.symbol}
                        className="w-full h-full object-contain"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const tile = e.currentTarget.parentElement as HTMLElement | null
                          const wrapper = tile?.parentElement as HTMLElement | null
                          if (wrapper) wrapper.style.display = 'none'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Radiating glow behind the logo — centering on the outer
                wrapper, pulse on the inner div so the scale animation never
                clobbers the horizontal centering transform. Anchored to the
                logo's vertical position rather than the whole stack. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{
                top: isPanel ? '34%' : '36%',
                width: isPanel ? 460 : 780,
                height: isPanel ? 460 : 780,
              }}
            >
              <div
                className="dex-hero-glow w-full h-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(59,130,246,0.24) 0%, rgba(59,130,246,0.09) 36%, rgba(59,130,246,0) 70%)',
                }}
              />
            </div>

            {/* Centred focal column — deliberately narrow so the perimeter
                icons stay clear of it. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className={`mx-auto ${isPanel ? 'max-w-sm' : 'max-w-md'}`}>
                {/* Dexetera logo focal point */}
                <img
                  src="/Dexicon/LOGO-Dexetera-square-padded.svg"
                  alt="Dexetera"
                  className={`relative mx-auto rounded-3xl drop-shadow-[0_0_48px_rgba(59,130,246,0.5)] ${
                    isPanel ? 'w-32 h-32 sm:w-40 sm:h-40' : 'w-52 h-52 sm:w-64 sm:h-64'
                  }`}
                />

                <div className="relative mt-7 flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-[0.18em]">
                    Early Access
                  </span>
                </div>

                <h1
                  className={`relative mt-3 font-medium text-white tracking-tight leading-[1.05] ${
                    isPanel ? 'text-3xl' : 'text-4xl sm:text-5xl lg:text-6xl'
                  }`}
                >
                  The advantage is{' '}
                  <span className="text-[#808080]">getting here first.</span>
                </h1>

                <p
                  className={`relative mt-4 mx-auto text-[#808080] leading-relaxed ${
                    isPanel ? 'text-sm' : 'text-sm sm:text-base'
                  }`}
                >
                  The exchange for the prediction economy — where the earliest markets are the
                  least crowded, and the cleanest edge belongs to whoever shows up first.
                </p>

                <div className="relative mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
                  <span className="text-sm text-white/90">Every market.</span>
                  <span className="w-1 h-1 rounded-full bg-[#333333]" />
                  <span className="text-sm text-white/90">Every metric.</span>
                  <span className="w-1 h-1 rounded-full bg-[#333333]" />
                  <span className="text-sm text-white/90">First in line.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Stats band ───────────────────────── */}
      <section className="border-y border-[#1A1A1A] bg-[#0C0C0C]">
        <div className="mx-auto max-w-5xl px-5 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-6 gap-x-4">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span
                  className={`font-medium text-white tracking-tight ${
                    isPanel ? 'text-2xl' : 'text-3xl sm:text-4xl'
                  }`}
                >
                  {s.value}
                </span>
                <span className="mt-1 text-[10px] text-[#606060] uppercase tracking-[0.14em]">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── What you unlock ───────────────────────── */}
      <section className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-[0.18em]">
            What you unlock
          </span>
        </div>
        <h2
          className={`font-medium text-white tracking-tight mb-8 ${
            isPanel ? 'text-2xl' : 'text-3xl sm:text-4xl'
          }`}
        >
          Five reasons to get in early.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REWARDS.map((reward, i) => (
            <div
              key={reward.id}
              className={`dex-reward-card group relative overflow-hidden rounded-lg border border-[#222222] bg-[#0F0F0F] hover:bg-[#141414] hover:border-[#333333] transition-all duration-200 p-5 ${
                // Make the first (or a hero) card span full width on the page variant
                !isPanel && i === 0 ? 'md:col-span-2' : ''
              }`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-[11px] font-mono text-[#404040]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="text-[10px] text-[#9CA3AF] bg-[#1A1A1A] border border-[#222222] px-2 py-0.5 rounded">
                  {reward.tag}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center w-11 h-11 rounded-md bg-[#1A1A1A] border border-[#222222] text-[#9CA3AF] group-hover:text-white group-hover:border-[#333333] transition-colors duration-200">
                {reward.icon}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${reward.dot}`} />
                <h3 className="text-lg font-medium text-white tracking-tight">
                  {reward.title}
                </h3>
              </div>
              <p className="mt-1.5 text-[13px] text-[#808080] leading-relaxed">
                {reward.summary}
              </p>
              <p className="mt-3 text-[12px] text-[#606060] leading-relaxed">
                {reward.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────── How it works (journey) ───────────────────────── */}
      <section className="border-t border-[#1A1A1A]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
            <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-[0.18em]">
              How getting in early works
            </span>
          </div>
          <h2
            className={`font-medium text-white tracking-tight mb-10 ${
              isPanel ? 'text-2xl' : 'text-3xl sm:text-4xl'
            }`}
          >
            From waitlist to token drop.
          </h2>

          <ol className="relative border-l border-[#222222] ml-3">
            {STEPS.map((step) => (
              <li key={step.k} className="relative pl-8 pb-9 last:pb-0">
                {/* Node */}
                <span className="absolute -left-[7px] top-1 w-3.5 h-3.5 rounded-full bg-[#0F0F0F] border-2 border-[#333333] group-hover:border-white transition-colors duration-200" />
                <div className="flex items-baseline gap-3">
                  <span className="text-[11px] font-mono text-[#404040]">{step.k}</span>
                  <h3 className="text-base sm:text-lg font-medium text-white tracking-tight">
                    {step.title}
                  </h3>
                </div>
                <p className="mt-1.5 text-[13px] text-[#808080] leading-relaxed max-w-xl">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────────── Waitlist CTA ───────────────────────── */}
      {showWaitlist && (
        <section className="border-t border-[#1A1A1A] bg-[#0C0C0C]">
          <div className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
            <h2
              className={`font-medium text-white tracking-tight ${
                isPanel ? 'text-2xl' : 'text-3xl sm:text-4xl'
              }`}
            >
              Claim your Early Access.
            </h2>
            <p className="mt-3 text-[#808080] text-sm sm:text-base max-w-xl">
              Join the waitlist to lock in your perks. One email when your access opens —
              no spam. Perks apply once you engage in early markets.
            </p>

            <div className="mt-7 max-w-md">
              {status === 'success' ? (
                <div className="flex items-center gap-2.5 bg-[#0F0F0F] border border-[#222222] rounded-md px-4 py-3.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-sm text-[#9CA3AF]">
                    You&apos;re on the list — your Early Access perks are locked in.
                  </span>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <div className="group flex items-stretch bg-[#0F0F0F] rounded-md border border-[#222222] focus-within:border-[#333333] hover:border-[#333333] transition-all duration-200 overflow-hidden">
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (status === 'error') {
                          setStatus('idle')
                          setError('')
                        }
                      }}
                      placeholder="you@email.com"
                      disabled={status === 'submitting'}
                      className="flex-1 min-w-0 bg-transparent px-4 py-3.5 text-sm text-white placeholder-[#404040] outline-none disabled:opacity-60"
                      aria-label="Email address"
                    />
                    <button
                      type="submit"
                      disabled={status === 'submitting' || email.trim().length === 0}
                      className="flex-shrink-0 px-4 sm:px-5 text-sm font-medium text-[#0F0F0F] bg-white hover:bg-[#E5E5E5] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {status === 'submitting' ? (
                        <span className="w-4 h-4 border-2 border-[#999999] border-t-[#0F0F0F] rounded-full animate-spin" />
                      ) : (
                        'Claim early access'
                      )}
                    </button>
                  </div>
                  {status === 'error' && error && (
                    <p className="text-red-400 text-[11px] mt-2 px-1">{error}</p>
                  )}
                </form>
              )}
            </div>

            {onClose && (
              <div className="mt-10">
                <button
                  type="button"
                  onClick={onClose}
                  className="group inline-flex items-center gap-1.5 text-[11px] text-[#606060] hover:text-[#9CA3AF] uppercase tracking-[0.16em] transition-colors duration-200"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Back to coming soon
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <style jsx>{`
        @keyframes dexRewardEnterUp {
          from {
            opacity: 0;
            transform: translate3d(0, 16px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }
        .dex-reward-card {
          animation: dexRewardEnterUp 460ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .dex-reward-card {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
