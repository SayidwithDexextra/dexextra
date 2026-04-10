'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useAnalyticsPrivacy } from '@/hooks/useAnalyticsPrivacy'
import { useOnChainTrades, OnChainTrade } from '@/hooks/useOnChainTrades'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters'
import type { AnalyticsPrivacySettings, DEFAULT_ANALYTICS_PRIVACY } from '@/types/userProfile'

interface UserAnalyticsTabProps {
  walletAddress: string
}

export default function UserAnalyticsTab({ walletAddress }: UserAnalyticsTabProps) {
  const { walletData } = useWallet() as any
  const currentWallet = walletData?.address

  const isSelf = useMemo(() => {
    if (!currentWallet || !walletAddress) return false
    return currentWallet.toLowerCase() === walletAddress.toLowerCase()
  }, [currentWallet, walletAddress])

  const {
    privacySettings,
    isHiddenFromPublic,
    isLoading: privacyLoading,
  } = useAnalyticsPrivacy({ targetWallet: walletAddress })

  const [publicStats, setPublicStats] = useState<{
    totalTrades: number
    totalVolume: number
    totalFees: number
    winRate: number
    marketsTraded: number
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    const fetchPublicStats = async () => {
      setStatsLoading(true)
      setStatsError(null)

      try {
        const response = await fetch(`/api/analytics/public?wallet=${encodeURIComponent(walletAddress)}`)
        const data = await response.json()

        if (data.success) {
          setPublicStats(data.stats)
        } else if (response.status === 403) {
          setStatsError('Analytics are private')
        } else {
          setStatsError(data.error || 'Failed to load analytics')
        }
      } catch (err) {
        console.error('[UserAnalyticsTab] Error fetching stats:', err)
        setStatsError('Failed to load analytics')
      } finally {
        setStatsLoading(false)
      }
    }

    if (walletAddress) {
      void fetchPublicStats()
    }
  }, [walletAddress])

  if (privacyLoading || statsLoading) {
    return (
      <div className="flex items-center gap-2 py-8">
        <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
        <span className="text-[11px] text-[#707070]">Loading analytics...</span>
      </div>
    )
  }

  if (isHiddenFromPublic && !isSelf) {
    return (
      <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#606060]">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div className="text-[12px] text-[#808080]">Analytics are private</div>
          <div className="text-[10px] text-[#606060]">
            This user has chosen to hide their analytics from public view
          </div>
        </div>
      </div>
    )
  }

  if (statsError && statsError !== 'Analytics are private') {
    return (
      <div className="group bg-[#0F0F0F] rounded-md border border-red-500/20 p-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-[11px] text-red-400">{statsError}</span>
        </div>
      </div>
    )
  }

  const shouldHide = (key: keyof AnalyticsPrivacySettings) => {
    if (isSelf) return false
    return privacySettings[key] === true
  }

  const displayValue = (value: number, opts?: { showSign?: boolean; compact?: boolean }) => {
    if (shouldHide('hide_portfolio_value')) return '$••••••'
    return formatCurrency(value, opts)
  }

  return (
    <div className="space-y-4">
      {isSelf && (
        <div className="bg-[#0F0F0F] rounded-md border border-[#3b82f6]/20 p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
            <span className="text-[11px] text-[#3b82f6]">
              This is a preview of your public analytics profile
            </span>
          </div>
          <p className="mt-1 text-[10px] text-[#606060]">
            Go to your full <a href="/analytics" className="text-[#3b82f6] hover:underline">Analytics Dashboard</a> for detailed data and privacy controls.
          </p>
        </div>
      )}

      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Trading Statistics</h4>
            {privacySettings.hide_from_public && (
              <div className="text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Private
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="Total Trades"
              value={publicStats?.totalTrades ?? 0}
              formatFn={formatNumber}
              hide={false}
            />
            <StatCard
              label="Volume"
              value={publicStats?.totalVolume ?? 0}
              formatFn={(v) => displayValue(v, { compact: true })}
              hide={shouldHide('hide_portfolio_value')}
            />
            <StatCard
              label="Fees Paid"
              value={publicStats?.totalFees ?? 0}
              formatFn={(v) => displayValue(v)}
              hide={shouldHide('hide_portfolio_value')}
            />
            <StatCard
              label="Win Rate"
              value={publicStats?.winRate ?? 0}
              formatFn={(v) => shouldHide('hide_pnl') ? '••%' : formatPercent(v)}
              hide={shouldHide('hide_pnl')}
              color={
                shouldHide('hide_pnl')
                  ? 'text-[#606060]'
                  : (publicStats?.winRate ?? 0) >= 50
                    ? 'text-[#4ade80]'
                    : 'text-[#f87171]'
              }
            />
            <StatCard
              label="Markets Traded"
              value={publicStats?.marketsTraded ?? 0}
              formatFn={formatNumber}
              hide={false}
            />
          </div>
        </div>
      </div>

      {shouldHide('hide_trade_history') ? (
        <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#606060]">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <div className="text-[11px] text-[#606060]">Trade history is hidden</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  formatFn,
  hide,
  color = 'text-white',
}: {
  label: string
  value: number
  formatFn: (v: number) => string
  hide: boolean
  color?: string
}) {
  return (
    <div className="bg-[#1A1A1A] border border-[#333333] rounded-md p-3">
      <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-[13px] font-mono ${hide ? 'text-[#606060]' : color}`}>
        {hide ? '••••••' : formatFn(value)}
      </div>
    </div>
  )
}
