'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { PublicUserProfile } from '@/types/userProfile'
import { useWallet } from '@/hooks/useWallet'

export interface UserPageProps {
  walletAddress: string
  initialProfile: PublicUserProfile | null
  className?: string
}

type UserMarketRow = {
  id: string
  market_identifier?: string | null
  symbol?: string | null
  name?: string | null
  icon_image_url?: string | null
  banner_image_url?: string | null
  market_address?: string | null
  market_id_bytes32?: string | null
  created_at?: string | null
  settlement_date?: string | null
  market_status?: string | null
  deployment_status?: string | null
  creator_wallet_address?: string | null
}

function shortAddr(addr: string | null | undefined) {
  if (!addr) return '—'
  const a = String(addr)
  if (!a.startsWith('0x') || a.length < 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function safeUrl(u: string | null | undefined): string | null {
  const s = String(u || '').trim()
  if (!s) return null
  try {
    // Allow http(s) only
    const parsed = new URL(s)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export default function UserPage({ walletAddress, initialProfile, className }: UserPageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { walletData } = useWallet()

  const [profile, setProfile] = useState<PublicUserProfile | null>(initialProfile)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [walletCopied, setWalletCopied] = useState(false)

  const [userMarkets, setUserMarkets] = useState<UserMarketRow[]>([])
  const [userMarketsLoading, setUserMarketsLoading] = useState(false)
  const [userMarketsError, setUserMarketsError] = useState<string | null>(null)
  const [userMarketsSearch, setUserMarketsSearch] = useState('')
  const fetchedForCreatorRef = useRef<string | null>(null)

  const isSelf = useMemo(() => {
    const me = String(walletData.address || '').toLowerCase()
    const target = String(walletAddress || '').toLowerCase()
    return Boolean(me && target && me === target)
  }, [walletData.address, walletAddress])

  type UserTabId = 'profile' | 'links' | 'markets'
  const tabs = useMemo(
    () =>
      [
        { id: 'profile' as const, label: 'Profile' },
        { id: 'links' as const, label: 'Links' },
        { id: 'markets' as const, label: 'Markets' },
      ] satisfies Array<{ id: UserTabId; label: string }>,
    []
  )

  const tabParamRaw = String(searchParams?.get('tab') || '').toLowerCase().trim()
  const tabParam = tabs.find((t) => t.id === (tabParamRaw as any))?.id || null
  const [activeTab, setActiveTab] = useState<UserTabId>(tabParam || 'profile')
  useEffect(() => {
    if (tabParam) setActiveTab(tabParam)
  }, [tabParam])

  const navigateTab = (id: UserTabId) => {
    setActiveTab(id)
    try {
      const next = new URLSearchParams(searchParams?.toString() || '')
      next.set('tab', id)
      router.replace(`${pathname}?${next.toString()}`)
    } catch {
      // ignore
    }
  }

  // Fetch latest profile (client-side) to keep page fresh
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setProfileLoading(true)
      setProfileError(null)
      try {
        const res = await fetch(`/api/profile?wallet=${encodeURIComponent(walletAddress)}`)
        if (res.status === 404) {
          if (!cancelled) setProfile(null)
          return
        }
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.success) throw new Error(String(json?.error || 'Failed to load profile'))
        if (!cancelled) setProfile(json.data as PublicUserProfile)
      } catch (e: any) {
        if (!cancelled) setProfileError(String(e?.message || e || 'Failed to load profile'))
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  const fetchUserMarkets = async (opts?: { force?: boolean }) => {
    const creator = walletAddress
    if (!creator) return
    if (!opts?.force && fetchedForCreatorRef.current === creator && userMarkets.length > 0) return

    setUserMarketsLoading(true)
    setUserMarketsError(null)
    try {
      const params = new URLSearchParams({
        creator,
        limit: '200',
        offset: '0',
      })
      const res = await fetch(`/api/markets?${params.toString()}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || json?.message || 'Failed to fetch markets')
      }
      const rows = Array.isArray(json?.markets) ? (json.markets as any[]) : []
      const cleaned: UserMarketRow[] = rows
        .filter(Boolean)
        .map((m: any) => ({
          id: String(m?.id || ''),
          market_identifier: m?.market_identifier ?? null,
          symbol: m?.symbol ?? null,
          name: m?.name ?? null,
          icon_image_url: m?.icon_image_url ?? null,
          banner_image_url: m?.banner_image_url ?? null,
          market_address: m?.market_address ?? null,
          market_id_bytes32: m?.market_id_bytes32 ?? null,
          created_at: m?.created_at ?? null,
          settlement_date: m?.settlement_date ?? null,
          market_status: m?.market_status ?? null,
          deployment_status: m?.deployment_status ?? null,
          creator_wallet_address: m?.creator_wallet_address ?? null,
        }))
        .filter((m) => Boolean(m.id))

      setUserMarkets(cleaned)
      fetchedForCreatorRef.current = creator
    } catch (e: any) {
      setUserMarketsError(String(e?.message || e || 'Failed to fetch markets'))
      setUserMarkets([])
    } finally {
      setUserMarketsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'markets') return
    void fetchUserMarkets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, walletAddress])

  const profileLabel = useMemo(() => {
    const p = profile
    return String(p?.display_name || p?.username || shortAddr(walletAddress))
  }, [profile, walletAddress])

  const profileInitial = useMemo(() => {
    return (profileLabel.trim().slice(0, 1) || 'D').toUpperCase()
  }, [profileLabel])

  const bannerImage = profile?.banner_image_url ? String(profile.banner_image_url) : null
  const profileImage = profile?.profile_image_url ? String(profile.profile_image_url) : null

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return '—'
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  }

  const links = useMemo(() => {
    const p = profile
    return [
      { id: 'website', label: 'Website', url: safeUrl(p?.website), raw: p?.website || '' },
      { id: 'twitter', label: 'Twitter', url: safeUrl(p?.twitter_url), raw: p?.twitter_url || '' },
      { id: 'discord', label: 'Discord', url: safeUrl(p?.discord_url), raw: p?.discord_url || '' },
      { id: 'instagram', label: 'Instagram', url: safeUrl(p?.instagram_url), raw: p?.instagram_url || '' },
      { id: 'youtube', label: 'YouTube', url: safeUrl(p?.youtube_url), raw: p?.youtube_url || '' },
      { id: 'facebook', label: 'Facebook', url: safeUrl(p?.facebook_url), raw: p?.facebook_url || '' },
    ]
  }, [profile])

  const copyWalletAddress = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress)
      setWalletCopied(true)
      setTimeout(() => setWalletCopied(false), 1200)
    } catch {
      // ignore
    }
  }

  return (
    <div className={`dex-page-enter-up w-full h-[calc(100vh-96px)] flex bg-transparent overflow-hidden ${className || ''}`}>
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-none text-white font-sans">
        {/* Header (modeled after Settings) */}
        <div className="border-b border-[#1A1A1A] bg-gradient-to-b from-[#141414] to-[#0F0F0F]">
          <div className="relative h-[190px] md:h-[240px] overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(560px 200px at 18% 30%, rgba(74,158,255,0.18), transparent 60%),
                  radial-gradient(520px 200px at 80% 38%, rgba(16,185,129,0.14), transparent 62%),
                  linear-gradient(180deg, rgba(20,20,20,0.92) 0%, rgba(15,15,15,0.96) 100%)
                `,
              }}
            />
            {bannerImage ? (
              <img src={bannerImage} alt="Profile banner" className="absolute inset-0 w-full h-full object-cover opacity-65" />
            ) : null}
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0" style={{ boxShadow: 'inset 0 -1px 0 rgba(34,34,34,0.9)' }} />

            {/* Profile icon (bottom-left) */}
            <div className="absolute left-6 bottom-5">
              <div className="w-[92px] h-[92px] md:w-[112px] md:h-[112px] rounded-full overflow-hidden border border-[#222222] bg-[#0F0F0F] shadow-2xl">
                {profileImage ? (
                  <Image src={profileImage} alt={profileLabel} width={112} height={112} className="w-full h-full object-cover" />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center text-[28px] md:text-[34px] font-semibold text-white"
                    style={{
                      background: 'linear-gradient(135deg, rgba(74,158,255,0.22), rgba(16,185,129,0.16))',
                    }}
                  >
                    {profileInitial}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Header row */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${profile ? 'bg-blue-400' : 'bg-[#404040]'}`} />
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate">User</h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {isSelf ? 'This is you' : 'Public'}
              </div>
              {profileLoading ? (
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Loading…</div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {isSelf ? (
                <button
                  type="button"
                  onClick={() => router.push('/settings')}
                  className="px-3 py-2 rounded-md text-[11px] border border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white transition-all duration-200"
                >
                  Open settings
                </button>
              ) : null}
              <button
                type="button"
                onClick={copyWalletAddress}
                aria-label={walletCopied ? 'Wallet address copied' : 'Copy wallet address'}
                className={[
                  'w-8 h-8 rounded-md border flex items-center justify-center transition-all duration-200',
                  walletCopied
                    ? 'border-green-500/30 text-green-400 bg-green-500/5'
                    : 'border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white',
                ].join(' ')}
                title="Copy wallet address"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="4"
                    y="8"
                    width="12"
                    height="12"
                    rx="2"
                    ry="2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded font-mono">{shortAddr(walletAddress)}</div>
            </div>
          </div>

          <div className="px-6 pb-5">
            <div className="text-white text-xl font-medium tracking-tight truncate">{profileLabel}</div>
            <p className="text-[#606060] text-[11px] mt-1 max-w-2xl">
              {profileError
                ? `Profile error: ${profileError}`
                : profile?.bio
                  ? profile.bio
                  : profile
                    ? 'No bio provided.'
                    : 'No public profile found for this wallet.'}
            </p>

            {/* Horizontal nav */}
            <div className="mt-4 -mx-6 px-6 border-b border-[#1A1A1A]">
              <div className="flex items-center gap-4 overflow-x-auto scrollbar-none">
                {tabs.map((t) => {
                  const isActive = activeTab === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => navigateTab(t.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'relative py-3 text-[12px] font-medium whitespace-nowrap transition-colors duration-200',
                        isActive ? 'text-white' : 'text-[#808080] hover:text-white',
                      ].join(' ')}
                    >
                      {t.label}
                      <span
                        className={[
                          'pointer-events-none absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full transition-opacity duration-200',
                          isActive ? 'bg-white/80 opacity-100' : 'opacity-0',
                        ].join(' ')}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <div className={['w-full', activeTab === 'markets' ? 'max-w-none' : 'mx-auto max-w-4xl'].join(' ')}>
            <div key={activeTab} className="dex-page-enter-up">
              {activeTab === 'profile' ? (
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Basic Information</h4>
                      <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Public</div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="block text-[11px] font-medium text-[#808080] mb-2">Username</div>
                        <div className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white">
                          {profile?.username || '—'}
                        </div>
                      </div>

                      <div>
                        <div className="block text-[11px] font-medium text-[#808080] mb-2">Display Name</div>
                        <div className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white">
                          {profile?.display_name || '—'}
                        </div>
                      </div>

                      <div>
                        <div className="block text-[11px] font-medium text-[#808080] mb-2">Bio</div>
                        <div className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white whitespace-pre-wrap min-h-[88px]">
                          {profile?.bio || '—'}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="block text-[11px] font-medium text-[#808080] mb-2">Wallet</div>
                          <div className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white font-mono">
                            {walletAddress}
                          </div>
                        </div>
                        <div>
                          <div className="block text-[11px] font-medium text-[#808080] mb-2">Joined</div>
                          <div className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white font-mono">
                            {fmtDate(profile?.created_at || null)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'links' ? (
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Social & Web Links</h4>
                      <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Public</div>
                    </div>

                    <div className="space-y-2">
                      {links.map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center justify-between gap-3 bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5"
                        >
                          <div className="text-[11px] text-[#808080]">{l.label}</div>
                          <div className="min-w-0 text-right">
                            {l.url ? (
                              <a
                                href={l.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[11px] text-white hover:underline break-all"
                                title={l.url}
                              >
                                {l.raw}
                              </a>
                            ) : (
                              <span className="text-[11px] text-[#606060]">—</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'markets' ? (
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <div className="min-w-0">
                        <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Markets</h4>
                        <div className="mt-1 text-[10px] text-[#606060] font-mono truncate">
                          Creator: {walletAddress}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <div className="relative flex-1 max-w-md">
                        <svg
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#606060]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Search markets"
                          value={userMarketsSearch}
                          onChange={(e) => setUserMarketsSearch(e.target.value)}
                          className="w-full bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] focus:border-[#333333] rounded-md pl-8 pr-3 py-2 text-[11px] text-white placeholder-[#606060] focus:outline-none transition-all duration-200"
                        />
                      </div>
                      <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{userMarkets.length}</div>
                      <button
                        type="button"
                        onClick={() => void fetchUserMarkets({ force: true })}
                        className="px-3 py-2 rounded-md text-[11px] border border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white transition-all duration-200"
                        disabled={userMarketsLoading}
                      >
                        {userMarketsLoading ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </div>

                    {userMarketsError ? (
                      <div className="group bg-[#0F0F0F] rounded-md border border-red-500/20 p-3 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                          <span className="text-[11px] text-red-400">Markets error: {userMarketsError}</span>
                        </div>
                      </div>
                    ) : null}

                    {(() => {
                      const q = userMarketsSearch.trim().toLowerCase()
                      const rows = q
                        ? userMarkets.filter((m) => {
                            const hay = `${m.market_identifier || ''} ${m.symbol || ''} ${m.name || ''}`.toLowerCase()
                            return hay.includes(q)
                          })
                        : userMarkets

                      if (userMarketsLoading && userMarkets.length === 0) {
                        return (
                          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                              <span className="text-[11px] text-[#808080]">Loading markets…</span>
                            </div>
                          </div>
                        )
                      }

                      if (rows.length === 0) {
                        return (
                          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                              <span className="text-[11px] text-[#606060]">{q ? 'No markets match your search' : 'No markets found for this creator'}</span>
                            </div>
                          </div>
                        )
                      }

                      const goToMarket = (m: UserMarketRow) => {
                        const id = String(m.market_identifier || m.symbol || '').trim()
                        if (!id) return
                        router.push(`/token/${encodeURIComponent(id)}`)
                      }

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                          {rows.map((m) => {
                            const label = String(m.name || m.symbol || m.market_identifier || 'Market')
                            const status = String(m.market_status || '—').toUpperCase()
                            const icon = String(m.icon_image_url || '').trim()
                            const banner = String(m.banner_image_url || '').trim()
                            const sym = String(m.symbol || '').toUpperCase()
                            const ident = String(m.market_identifier || '').toUpperCase()
                            const statusDot =
                              status === 'ACTIVE'
                                ? 'bg-green-400'
                                : status === 'PENDING'
                                  ? 'bg-yellow-400'
                                  : status === 'SETTLED'
                                    ? 'bg-blue-400'
                                    : 'bg-[#404040]'

                            return (
                              <div
                                key={m.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => goToMarket(m)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') goToMarket(m)
                                }}
                                className="group text-left bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden min-h-[240px] cursor-pointer"
                              >
                                <div className="relative h-[104px] overflow-hidden border-b border-[#1A1A1A]">
                                  <div
                                    className="absolute inset-0"
                                    style={{
                                      background: `
                                        radial-gradient(220px 80px at 20% 30%, rgba(74,158,255,0.16), transparent 60%),
                                        radial-gradient(220px 80px at 80% 40%, rgba(16,185,129,0.10), transparent 62%),
                                        linear-gradient(180deg, #141414 0%, #0F0F0F 100%)
                                      `,
                                    }}
                                  />
                                  {banner ? <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-55" loading="lazy" /> : null}
                                  <div className="absolute inset-0 bg-black/20" />
                                </div>

                                <div className="p-2.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
                                      <div className="w-7 h-7 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
                                        {icon ? (
                                          <Image src={icon} alt={label} width={28} height={28} className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-[9px] font-medium text-[#808080]">
                                            {(sym || ident || label).slice(0, 2).toUpperCase()}
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-[11px] font-medium text-white truncate">{label}</span>
                                          <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{status || '—'}</span>
                                        </div>
                                        <div className="text-[10px] text-[#606060] font-mono truncate">{sym || ident || '—'}</div>
                                      </div>
                                    </div>

                                    <svg className="w-3 h-3 text-[#404040] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="min-w-0">
                                      <div className="text-[9px] text-[#606060] uppercase tracking-wide">Created</div>
                                      <div className="mt-1 text-[10px] text-white font-mono truncate">{fmtDate(m.created_at)}</div>
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[9px] text-[#606060] uppercase tracking-wide">Settlement</div>
                                      <div className="mt-1 text-[10px] text-white font-mono truncate">{fmtDate(m.settlement_date)}</div>
                                    </div>
                                  </div>

                                  <div className="mt-2">
                                    <div className="text-[9px] text-[#606060] uppercase tracking-wide">Identifier</div>
                                    <div className="mt-1 text-[10px] text-[#9CA3AF] font-mono truncate">{ident || sym || '—'}</div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

