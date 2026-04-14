'use client'

import React, { useState, useMemo } from 'react'
import Image from 'next/image'
import { useAccountActivity, ActivityRecord, TradeRecord } from '@/hooks/useAccountActivity'
import { useUserFees, FeeDetailRow } from '@/hooks/useUserFees'
import { useOwnerEarnings, OwnerEarningsRow, ProtocolEarningsRow } from '@/hooks/useOwnerEarnings'
import { useUserCreatedMarkets, CreatedMarketRow } from '@/hooks/useUserCreatedMarkets'
import { useOnChainTrades, OnChainTrade } from '@/hooks/useOnChainTrades'
import { useUserOrderHistory, UserOrder } from '@/hooks/useUserOrderHistory'
import { useUserBondedMarkets, BondedMarket } from '@/hooks/useUserBondedMarkets'
import { useWallet } from '@/hooks/useWallet'
import { useCoreVault } from '@/hooks/useCoreVault'
import { useAnalyticsPrivacy, maskCurrency } from '@/hooks/useAnalyticsPrivacy'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'
import { formatCurrency, formatNumber } from '@/lib/formatters'
import ActivityChart from './charts/ActivityChart'
import PortfolioBreakdownChart from './charts/PortfolioBreakdownChart'
import FeesByMarketChart from './charts/FeesByMarketChart'
import CumulativePnlChart from './charts/CumulativePnlChart'
import ActivityTable from './ActivityTable'
import SummaryCards from './SummaryCards'

export interface AnalyticsDashboardProps {
  targetWallet?: string
}

type TabId = 'overview' | 'trades' | 'orders' | 'fees' | 'revenue' | 'markets' | 'pnl' | 'settlements' | 'activity'

export default function AnalyticsDashboard({ targetWallet }: AnalyticsDashboardProps = {}) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
  
  const { walletData } = useWallet() as any
  const isConnected = Boolean(walletData?.isConnected && walletData?.address)
  
  const {
    privacySettings,
    hideValues,
    isPublicView,
    isSelf,
    isHiddenFromPublic,
    updatePrivacySetting,
    toggleHideValues,
    isSaving: privacySaving,
  } = useAnalyticsPrivacy({ targetWallet })

  const { 
    activities,
    trades,
    summary, 
    dailyData, 
    breakdown,
    feesByMarket,
    isLoading, 
    error, 
    refetch 
  } = useAccountActivity({
    enabled: isConnected,
    limit: 500,
    refreshInterval: 0, // Disable polling - user can manually refresh
  })

  const {
    totals: feeTotals,
    recentFees,
    summary: feeSummary,
    liveIds: feeLiveIds,
    isLoading: feesLoading,
  } = useUserFees(isConnected ? walletData?.address : null, { recentLimit: 20, disableRealtime: true })

  const {
    markets: ownerMarkets,
    protocolMarkets,
    totals: ownerTotals,
    protocolTotals,
    liveMarketKeys,
    isMarketOwner,
    isProtocolRecipient,
    hasRevenue,
    isLoading: ownerLoading,
  } = useOwnerEarnings(isConnected ? walletData?.address : null, { disableRealtime: true })

  const {
    markets: createdMarkets,
    totals: creationTotals,
    isLoading: createdMarketsLoading,
  } = useUserCreatedMarkets(isConnected ? walletData?.address : null)

  const {
    trades: onChainTrades,
    uniqueMarkets: tradedMarkets,
    dailyPnl: onChainDailyPnl,
    summary: onChainSummary,
    isLoading: tradesLoading,
    error: tradesError,
    refetch: refetchTrades,
    progress: tradesProgress,
  } = useOnChainTrades()

  // Fetch user order history
  const {
    orders: userOrders,
    summary: ordersSummary,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useUserOrderHistory()

  // Fetch user bonded markets
  const {
    markets: bondedMarkets,
    summary: bondSummary,
    isLoading: bondedMarketsLoading,
    error: bondedMarketsError,
    refetch: refetchBondedMarkets,
  } = useUserBondedMarkets()

  // Get on-chain P&L and margin data from the vault contract (same source as Portfolio sidebar)
  const coreVault = useCoreVault()
  const onChainRealizedPnl = parseFloat(coreVault?.realizedPnL || '0') || 0
  const onChainUnrealizedPnl = parseFloat(coreVault?.unrealizedPnL || '0') || 0

  // Portfolio breakdown data for the pie chart
  const portfolioBreakdown = useMemo(() => {
    const marginUsed = parseFloat(coreVault?.marginUsed || '0') || 0
    const marginReserved = parseFloat(coreVault?.marginReserved || '0') || 0
    const availableCash = parseFloat(coreVault?.availableBalance || '0') || 0
    const totalCollateral = parseFloat(coreVault?.totalCollateral || '0') || 0
    
    return {
      marginUsed,
      marginReserved,
      availableCash,
      unrealizedPnl: onChainUnrealizedPnl,
      totalCollateral,
    }
  }, [coreVault?.marginUsed, coreVault?.marginReserved, coreVault?.availableBalance, coreVault?.totalCollateral, onChainUnrealizedPnl])

  const hasCreatedMarkets = createdMarkets.length > 0

  const tabs: { id: TabId; label: string }[] = useMemo(() => [
    { id: 'overview', label: 'Overview' },
    { id: 'trades', label: 'Trades' },
    { id: 'orders', label: 'Orders' },
    { id: 'fees', label: 'Fees' },
    ...(hasRevenue ? [{ id: 'revenue' as const, label: 'Revenue' }] : []),
    ...(hasCreatedMarkets ? [{ id: 'markets' as const, label: 'Markets' }] : []),
    { id: 'pnl', label: 'P&L' },
    { id: 'settlements', label: 'Settlements' },
    { id: 'activity', label: 'Activity' },
  ], [hasRevenue, hasCreatedMarkets])

  const filteredDailyData = useMemo(() => {
    if (dateRange === 'all') return dailyData
    
    const now = new Date()
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    
    return dailyData.filter(d => new Date(d.date) >= cutoff)
  }, [dailyData, dateRange])

  if (!isConnected) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="bg-[#0A0A0A] rounded border border-[#1a1a1a] p-4 max-w-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-1 rounded-full bg-[#3b82f6]" />
            <span className="text-[10px] font-medium text-[#e0e0e0] uppercase tracking-wide">Analytics</span>
          </div>
          <p className="text-[10px] text-[#707070] leading-relaxed">
            Connect wallet to view account analytics
          </p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="w-full min-h-screen"
      style={{ background: '#050505' }}
    >
      <div className="max-w-[1400px] mx-auto px-6 pt-3 pb-24">
        {/* Hero Section */}
        <AccountHero
          summary={summary}
          activitiesCount={activities.length}
          isLoading={isLoading}
          walletAddress={walletData?.address}
          profileImage={walletData?.userProfile?.profile_image_url}
          displayName={walletData?.userProfile?.display_name || walletData?.userProfile?.username}
          onChainTradesCount={onChainTrades.length}
          tradesLoading={tradesLoading}
          onChainRealizedPnl={onChainRealizedPnl}
          onChainUnrealizedPnl={onChainUnrealizedPnl}
          hideValues={hideValues || (isPublicView && privacySettings.hide_pnl)}
        />

        {/* Controls Row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* Date Range */}
            <div className="flex items-center">
              {(['7d', '30d', '90d', 'all'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                    dateRange === range
                      ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                      : 'text-[#606060] hover:text-[#909090]'
                  }`}
                  style={{ borderRadius: '3px' }}
                >
                  {range === 'all' ? 'All' : range}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Privacy Controls - only show for self view */}
            {isSelf && (
              <>
                {/* Hide Values Toggle (local only) */}
                <button
                  onClick={toggleHideValues}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    hideValues
                      ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                      : 'text-[#606060] hover:text-[#909090] hover:bg-[#141414]'
                  }`}
                  title={hideValues ? 'Show values' : 'Hide values from yourself'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {hideValues ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                  {hideValues ? 'Hidden' : 'Hide'}
                </button>

                <div className="w-px h-4 bg-[#1a1a1a]" />

                {/* Hide from Public Toggle (persisted) */}
                <button
                  onClick={() => updatePrivacySetting('hide_from_public', !privacySettings.hide_from_public)}
                  disabled={privacySaving}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    privacySettings.hide_from_public
                      ? 'text-[#f59e0b] bg-[#f59e0b]/10'
                      : 'text-[#606060] hover:text-[#909090] hover:bg-[#141414]'
                  } ${privacySaving ? 'opacity-50' : ''}`}
                  title={privacySettings.hide_from_public ? 'Analytics visible only to you' : 'Make analytics private'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {privacySettings.hide_from_public ? (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </>
                    ) : (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </>
                    )}
                  </svg>
                  {privacySettings.hide_from_public ? 'Private' : 'Public'}
                </button>
              </>
            )}

            {/* Refresh */}
            <button
              onClick={refetch}
              disabled={isLoading}
              className="text-[12px] text-[#606060] hover:text-[#3b82f6] disabled:opacity-50 transition-colors"
            >
              {isLoading ? '↻' : '↻'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 mb-4 border-b border-[#1a1a1a]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2.5 text-[12px] font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-[#f0f0f0]'
                  : 'text-[#606060] hover:text-[#909090]'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-px bg-[#3b82f6]" />
              )}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 py-2 px-3 bg-[#0A0A0A] border border-[#3b1a1a] rounded text-[11px] text-[#f06060]">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && activities.length === 0 && (
          <div className="flex items-center gap-2 py-8">
            <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
            <span className="text-[11px] text-[#707070]">Loading...</span>
          </div>
        )}

        {/* Content */}
        {(!isLoading || activities.length > 0) && (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-3">
                <SummaryCards 
                  summary={summary} 
                  isLoading={isLoading} 
                  onChainRealizedPnl={onChainRealizedPnl}
                  onChainUnrealizedPnl={onChainUnrealizedPnl}
                  hideValues={hideValues || (isPublicView && privacySettings.hide_portfolio_value)}
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <ActivityChart data={filteredDailyData} isLoading={isLoading} hideValues={hideValues || (isPublicView && privacySettings.hide_portfolio_value)} />
                  <PortfolioBreakdownChart 
                    data={portfolioBreakdown} 
                    isLoading={coreVault?.isLoading} 
                    hideValues={hideValues || (isPublicView && privacySettings.hide_portfolio_value)}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <FeesByMarketChart data={feesByMarket} isLoading={isLoading} hideValues={hideValues || (isPublicView && privacySettings.hide_portfolio_value)} />
                  <CumulativePnlChart 
                    data={onChainDailyPnl.length > 0 ? onChainDailyPnl : filteredDailyData} 
                    isLoading={tradesLoading && onChainDailyPnl.length === 0} 
                    hideValues={hideValues || (isPublicView && privacySettings.hide_pnl)}
                  />
                </div>

                {/* Recent Activity */}
                <div className="bg-[#0A0A0A] rounded border border-[#141414]">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
                    <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Recent</span>
                    <button
                      onClick={() => setActiveTab('activity')}
                      className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
                    >
                      View all →
                    </button>
                  </div>
                  <ActivityTable activities={activities.slice(0, 5)} isLoading={isLoading} compact />
                </div>
              </div>
            )}

            {activeTab === 'trades' && (
              <OnChainTradesTab 
                trades={onChainTrades}
                tradedMarkets={tradedMarkets}
                isLoading={tradesLoading}
                error={tradesError}
                progress={tradesProgress}
                refetch={refetchTrades}
              />
            )}

            {activeTab === 'orders' && (
              <OrdersTab
                orders={userOrders}
                summary={ordersSummary}
                isLoading={ordersLoading}
                error={ordersError}
                refetch={refetchOrders}
              />
            )}

            {activeTab === 'fees' && (
              <FeesTab 
                feeTotals={feeTotals}
                recentFees={recentFees}
                feeLiveIds={feeLiveIds}
                feesLoading={feesLoading}
                feesByMarket={feesByMarket}
              />
            )}

            {activeTab === 'revenue' && (
              <RevenueTab
                ownerMarkets={ownerMarkets}
                protocolMarkets={protocolMarkets}
                ownerTotals={ownerTotals}
                protocolTotals={protocolTotals}
                liveMarketKeys={liveMarketKeys}
                isMarketOwner={isMarketOwner}
                isProtocolRecipient={isProtocolRecipient}
                ownerLoading={ownerLoading}
                walletAddress={walletData?.address}
              />
            )}

            {activeTab === 'markets' && (
              <MarketsTab
                createdMarkets={createdMarkets}
                totals={creationTotals}
                isLoading={createdMarketsLoading}
                bondedMarkets={bondedMarkets}
                bondSummary={bondSummary}
                bondedMarketsLoading={bondedMarketsLoading}
                refetchBondedMarkets={refetchBondedMarkets}
              />
            )}

            {activeTab === 'pnl' && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <MiniStat
                    label="Net P&L"
                    value={formatCurrency(onChainRealizedPnl + onChainUnrealizedPnl, { showSign: true })}
                    positive={(onChainRealizedPnl + onChainUnrealizedPnl) >= 0}
                  />
                  <MiniStat
                    label="Realized"
                    value={formatCurrency(onChainRealizedPnl, { showSign: true })}
                    positive={onChainRealizedPnl >= 0}
                  />
                  <MiniStat
                    label="Unrealized"
                    value={formatCurrency(onChainUnrealizedPnl, { showSign: true })}
                    positive={onChainUnrealizedPnl >= 0}
                  />
                  <MiniStat
                    label="After Fees"
                    value={formatCurrency((onChainRealizedPnl + onChainUnrealizedPnl) - summary.totalFeesPaid, { showSign: true })}
                    positive={((onChainRealizedPnl + onChainUnrealizedPnl) - summary.totalFeesPaid) >= 0}
                  />
                </div>

                <CumulativePnlChart 
                  data={onChainDailyPnl.length > 0 ? onChainDailyPnl : filteredDailyData} 
                  isLoading={tradesLoading && onChainDailyPnl.length === 0} 
                  height={280} 
                />
              </div>
            )}

            {activeTab === 'settlements' && (
              <SettlementsTab 
                activities={activities} 
                summary={summary} 
                isLoading={isLoading} 
              />
            )}

            {activeTab === 'activity' && (
              <div className="bg-[#0A0A0A] rounded border border-[#141414]">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
                  <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Transactions</span>
                  <span className="text-[10px] text-[#3b82f6]">{activities.length}</span>
                </div>
                <ActivityTable activities={activities} isLoading={isLoading} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const valueColor = positive === undefined 
    ? 'text-[#e0e0e0]' 
    : positive 
      ? 'text-[#4ade80]' 
      : 'text-[#f87171]'
  
  return (
    <div className="bg-[#0A0A0A] rounded border border-[#141414] p-2.5">
      <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-[13px] font-mono ${valueColor}`}>{value}</div>
    </div>
  )
}

function AccountHero({
  summary,
  activitiesCount,
  isLoading,
  walletAddress,
  profileImage,
  displayName,
  onChainTradesCount,
  tradesLoading,
  onChainRealizedPnl,
  onChainUnrealizedPnl,
  hideValues = false,
}: {
  summary: {
    netPnl: number
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalFeesPaid: number
    totalDeposits: number
    totalWithdrawals: number
    tradesCount: number
    settledPositionsCount: number
  }
  activitiesCount: number
  isLoading: boolean
  walletAddress?: string
  profileImage?: string | null
  displayName?: string | null
  onChainTradesCount: number
  onChainRealizedPnl: number
  onChainUnrealizedPnl: number
  tradesLoading: boolean
  hideValues?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const realizedPnl = onChainRealizedPnl
  const netPnl = onChainRealizedPnl + onChainUnrealizedPnl
  const profitAfterFees = netPnl - summary.totalFeesPaid
  const isProfit = profitAfterFees >= 0
  
  const displayValue = (value: number, opts?: { showSign?: boolean }) => {
    if (hideValues) return '$••••••'
    return formatCurrency(value, opts)
  }

  const shortAddress = walletAddress 
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : ''

  const profileLabel = displayName || shortAddress

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="-mx-6 -mt-3 mb-6 border-b border-[var(--t-stroke-sub,#1a1a1a)] bg-[var(--t-card,#0a0a0a)]">
      {/* Banner with gradient - matching Settings page exactly */}
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
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 -1px 0 rgba(34,34,34,0.9)' }} />

        {/* Profile avatar (bottom-left, like Settings page) */}
        <div className="absolute left-6 bottom-5">
          <div className="relative">
            <div className="w-[92px] h-[92px] md:w-[112px] md:h-[112px] rounded-full overflow-hidden border border-[var(--t-stroke,#222)] bg-[var(--t-card,#0a0a0a)] shadow-2xl">
              <Image
                src={profileImage || DEFAULT_PROFILE_IMAGE}
                alt={profileLabel}
                width={112}
                height={112}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Header row (matching Settings page exactly) */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLoading ? 'bg-[#fbbf24] animate-pulse' : 'bg-green-400'}`} />
          <h4 className="text-xs font-medium text-[var(--t-fg-label,#808080)] uppercase tracking-wide truncate">Analytics</h4>
          <div className="text-[10px] text-[var(--t-fg-muted,#606060)] bg-[var(--t-inset,#141414)] px-1.5 py-0.5 rounded">
            {activitiesCount} transactions
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyAddress}
            disabled={!walletAddress}
            aria-label={copied ? 'Wallet address copied' : 'Copy wallet address'}
            title="Copy wallet address"
            className={[
              'w-8 h-8 rounded-md border flex items-center justify-center transition-all duration-200',
              !walletAddress
                ? 'border-[var(--t-stroke,#222)] text-[var(--t-fg-muted,#606060)] opacity-60 cursor-not-allowed'
                : copied
                  ? 'border-green-500/30 text-green-400 bg-green-500/5'
                  : 'border-[var(--t-stroke,#222)] text-[var(--t-fg-sub,#909090)] hover:border-[var(--t-stroke-hover,#333)] hover:bg-[var(--t-card-hover,#141414)] hover:text-[var(--t-fg,#e0e0e0)]',
            ].join(' ')}
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
          <div className="text-[10px] text-[var(--t-fg-muted,#606060)] bg-[var(--t-inset,#141414)] px-1.5 py-0.5 rounded font-mono">
            {shortAddress}
          </div>
        </div>
      </div>

      {/* Title and description section */}
      <div className="px-6 pb-5">
        <div className="text-[var(--t-fg,#e0e0e0)] text-xl font-medium tracking-tight truncate">{profileLabel}</div>
        <p className="text-[var(--t-fg-muted,#707070)] text-[11px] mt-1 max-w-2xl">
          Track your trading performance, fees, settlements, and account activity.
        </p>

        {/* Stats row - horizontal, OpenSea-style */}
        <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[var(--t-stroke-sub,#1a1a1a)]">
          {/* Net P&L */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Net P&L</span>
            <span className={`text-[13px] font-mono font-medium ${hideValues ? 'text-[#606060]' : isProfit ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {isLoading ? '—' : displayValue(profitAfterFees, { showSign: true })}
            </span>
          </div>

          <div className="w-px h-4 bg-[var(--t-stroke-sub,#1a1a1a)]" />

          {/* Realized - from on-chain vault */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Realized</span>
            <span className={`text-[13px] font-mono ${hideValues ? 'text-[#606060]' : realizedPnl >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {isLoading ? '—' : displayValue(realizedPnl, { showSign: true })}
            </span>
          </div>

          {/* Fees */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Fees</span>
            <span className={`text-[13px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[#fbbf24]'}`}>
              {isLoading ? '—' : displayValue(summary.totalFeesPaid)}
            </span>
          </div>

          <div className="w-px h-4 bg-[var(--t-stroke-sub,#1a1a1a)]" />

          {/* Trades - use on-chain count when available */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Trades</span>
            <span className="text-[13px] font-mono text-[var(--t-fg,#e0e0e0)]">
              {tradesLoading ? '—' : formatNumber(onChainTradesCount || summary.tradesCount)}
            </span>
          </div>

          {/* Settled */}
          {summary.settledPositionsCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Settled</span>
              <span className="text-[13px] font-mono text-[#22d3ee]">{formatNumber(summary.settledPositionsCount)}</span>
            </div>
          )}

          {/* Deposits */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Deposits</span>
            <span className={`text-[13px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[#4ade80]'}`}>
              {isLoading ? '—' : displayValue(summary.totalDeposits)}
            </span>
          </div>

          {/* Withdrawals */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--t-fg-muted,#606060)]">Withdrawals</span>
            <span className={`text-[13px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[var(--t-fg-sub,#909090)]'}`}>
              {isLoading ? '—' : displayValue(summary.totalWithdrawals)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettlementsTab({ 
  activities, 
  summary, 
  isLoading 
}: { 
  activities: ActivityRecord[]
  summary: { totalSettlementPnl: number; settledPositionsCount: number; totalFeesPaid: number }
  isLoading: boolean 
}) {
  const settlementActivities = useMemo(() => 
    activities.filter(a => a.type === 'settlement'),
    [activities]
  )

  const netAfterFees = summary.totalSettlementPnl - summary.totalFeesPaid

  const stats = useMemo(() => {
    const wins = settlementActivities.filter(a => a.amount > 0)
    const losses = settlementActivities.filter(a => a.amount < 0)
    const breakeven = settlementActivities.filter(a => a.amount === 0)
    
    const totalWins = wins.reduce((sum, a) => sum + a.amount, 0)
    const totalLosses = Math.abs(losses.reduce((sum, a) => sum + a.amount, 0))
    const avgWin = wins.length > 0 ? totalWins / wins.length : 0
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0
    const winRate = settlementActivities.length > 0 
      ? (wins.length / settlementActivities.length) * 100 
      : 0
    
    const largestWin = wins.length > 0 ? Math.max(...wins.map(a => a.amount)) : 0
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(a => a.amount)) : 0

    return {
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      totalWins,
      totalLosses,
      avgWin,
      avgLoss,
      winRate,
      largestWin,
      largestLoss,
    }
  }, [settlementActivities])

  if (isLoading && settlementActivities.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse mx-auto mb-2" />
        <span className="text-[11px] text-[#707070]">Loading settlements...</span>
      </div>
    )
  }

  if (settlementActivities.length === 0) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[13px] text-[#707070]">No settled positions yet</p>
        <p className="text-[11px] text-[#505050] mt-1">Your settlement history will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main Summary Card */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Settlement Summary</span>
          <span className="text-[10px] text-[#3b82f6]">{summary.settledPositionsCount} positions</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total P&L</div>
            <div className={`text-[20px] font-semibold font-mono ${summary.totalSettlementPnl >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {formatCurrency(summary.totalSettlementPnl, { showSign: true })}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Fees Paid</div>
            <div className="text-[20px] font-semibold text-[#fbbf24] font-mono">
              {formatCurrency(summary.totalFeesPaid)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Net After Fees</div>
            <div className={`text-[20px] font-semibold font-mono ${netAfterFees >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {formatCurrency(netAfterFees, { showSign: true })}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Win Rate</div>
            <div className={`text-[20px] font-semibold font-mono ${stats.winRate >= 50 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {stats.winRate.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Performance Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Wins Card */}
        <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[#4ade80]" />
            <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Winning Positions</span>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Count</div>
              <div className="text-[16px] font-semibold text-[#4ade80] font-mono">{stats.wins}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Total</div>
              <div className="text-[16px] font-semibold text-[#4ade80] font-mono">
                +{formatCurrency(stats.totalWins)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Average</div>
              <div className="text-[14px] font-medium text-[#c0c0c0] font-mono">
                {formatCurrency(stats.avgWin)}
              </div>
            </div>
          </div>

          {stats.largestWin > 0 && (
            <div className="mt-3 pt-3 border-t border-[#1a1a1a]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#606060]">Best Win</span>
                <span className="text-[12px] font-mono text-[#4ade80]">+{formatCurrency(stats.largestWin)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Losses Card */}
        <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[#f87171]" />
            <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Losing Positions</span>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Count</div>
              <div className="text-[16px] font-semibold text-[#f87171] font-mono">{stats.losses}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Total</div>
              <div className="text-[16px] font-semibold text-[#f87171] font-mono">
                -{formatCurrency(stats.totalLosses)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#606060] mb-1">Average</div>
              <div className="text-[14px] font-medium text-[#c0c0c0] font-mono">
                {formatCurrency(stats.avgLoss)}
              </div>
            </div>
          </div>

          {stats.largestLoss < 0 && (
            <div className="mt-3 pt-3 border-t border-[#1a1a1a]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#606060]">Worst Loss</span>
                <span className="text-[12px] font-mono text-[#f87171]">{formatCurrency(stats.largestLoss)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settlement Cards Grid */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141414]">
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Settlement History</span>
          <span className="text-[10px] text-[#606060]">{settlementActivities.length} total</span>
        </div>

        <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {settlementActivities.map((activity) => {
            const isProfit = activity.amount >= 0
            return (
              <div 
                key={activity.id}
                className="bg-[#0F0F0F] rounded border border-[#1a1a1a] p-3 hover:border-[#252525] transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isProfit ? 'bg-[#4ade80]' : 'bg-[#f87171]'}`} />
                    <span className="text-[12px] font-medium text-[#e0e0e0] truncate max-w-[120px]">
                      {activity.marketSymbol || 'Unknown'}
                    </span>
                  </div>
                  <span className={`text-[13px] font-semibold font-mono ${isProfit ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                    {formatCurrency(activity.amount, { showSign: true })}
                  </span>
                </div>

                {activity.description && (
                  <p className="text-[10px] text-[#707070] mb-2 line-clamp-2">{activity.description}</p>
                )}

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#606060]">
                    {new Date(activity.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  {activity.txHash ? (
                    <a
                      href={`https://hyperevmscan.io/tx/${activity.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#3b82f6] hover:text-[#60a5fa] font-mono transition-colors"
                    >
                      {activity.txHash.slice(0, 6)}...{activity.txHash.slice(-4)}
                    </a>
                  ) : (
                    <span className="text-[#404040]">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function OnChainTradesTab({ 
  trades, 
  tradedMarkets,
  isLoading,
  error,
  progress,
  refetch,
}: { 
  trades: OnChainTrade[]
  tradedMarkets: Array<{ marketId: string; marketAddress: string; symbol: string }>
  isLoading: boolean
  error: string | null
  progress: { current: number; total: number }
  refetch: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'BUY' | 'SELL'>('all')
  const [marketFilter, setMarketFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const pageSize = 25

  const filteredTrades = useMemo(() => {
    let filtered = trades
    if (filter !== 'all') {
      filtered = filtered.filter(t => t.side === filter)
    }
    if (marketFilter !== 'all') {
      filtered = filtered.filter(t => t.marketId === marketFilter)
    }
    return filtered
  }, [trades, filter, marketFilter])

  const paginatedTrades = useMemo(() => {
    const start = page * pageSize
    return filteredTrades.slice(start, start + pageSize)
  }, [filteredTrades, page])

  const totalPages = Math.ceil(filteredTrades.length / pageSize)

  const stats = useMemo(() => {
    const buyTrades = trades.filter(t => t.side === 'BUY')
    const sellTrades = trades.filter(t => t.side === 'SELL')
    const totalVolume = trades.reduce((sum, t) => sum + t.tradeValue, 0)
    const totalFees = trades.reduce((sum, t) => sum + t.fee, 0)
    
    return {
      totalTrades: trades.length,
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      totalVolume,
      totalFees,
      marketsTraded: tradedMarkets.length,
    }
  }, [trades, tradedMarkets])

  // Loading state with progress
  if (isLoading && trades.length === 0) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-4">
          <div className="w-5 h-5 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-[12px] text-[#909090] mb-2">Fetching on-chain trades...</p>
        {progress.total > 0 && (
          <div className="max-w-xs mx-auto">
            <div className="flex items-center justify-between text-[10px] text-[#606060] mb-1">
              <span>Querying markets</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#3b82f6] transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#3b1a1a] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#1a1414] flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[#f87171]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-[12px] text-[#f87171] mb-2">{error}</p>
        <button
          onClick={refetch}
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  // Empty state
  if (trades.length === 0) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-[13px] text-[#707070]">No on-chain trades found</p>
        <p className="text-[11px] text-[#505050] mt-1">Your trade history will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">On-Chain Trades</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-[#3b82f6]/10 text-[#3b82f6] rounded">Live</span>
          </div>
          <button
            onClick={refetch}
            disabled={isLoading}
            className="text-[10px] text-[#606060] hover:text-[#3b82f6] disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            <span className={isLoading ? 'animate-spin' : ''}>↻</span>
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Trades</div>
            <div className="text-[18px] font-semibold text-[#e0e0e0] font-mono">{formatNumber(stats.totalTrades)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Buy Orders</div>
            <div className="text-[18px] font-semibold text-[#4ade80] font-mono">{formatNumber(stats.buyCount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Sell Orders</div>
            <div className="text-[18px] font-semibold text-[#f87171] font-mono">{formatNumber(stats.sellCount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Volume</div>
            <div className="text-[18px] font-semibold text-[#e0e0e0] font-mono">{formatCurrency(stats.totalVolume, { compact: true })}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Fees</div>
            <div className="text-[18px] font-semibold text-[#fbbf24] font-mono">{formatCurrency(stats.totalFees)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Markets</div>
            <div className="text-[18px] font-semibold text-[#3b82f6] font-mono">{formatNumber(stats.marketsTraded)}</div>
          </div>
        </div>
      </div>

      {/* Markets Traded */}
      {tradedMarkets.length > 0 && (
        <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
          <div className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide mb-3">Markets Traded</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setMarketFilter('all'); setPage(0) }}
              className={`px-2.5 py-1 text-[10px] rounded transition-colors ${
                marketFilter === 'all' 
                  ? 'bg-[#3b82f6]/10 text-[#3b82f6]' 
                  : 'bg-[#141414] text-[#707070] hover:text-[#909090]'
              }`}
            >
              All Markets
            </button>
            {tradedMarkets.map(m => {
              const count = trades.filter(t => t.marketId === m.marketId).length
              return (
                <button
                  key={m.marketId}
                  onClick={() => { setMarketFilter(m.marketId); setPage(0) }}
                  className={`px-2.5 py-1 text-[10px] rounded transition-colors flex items-center gap-1.5 ${
                    marketFilter === m.marketId 
                      ? 'bg-[#3b82f6]/10 text-[#3b82f6]' 
                      : 'bg-[#141414] text-[#707070] hover:text-[#909090]'
                  }`}
                >
                  <span>{m.symbol}</span>
                  <span className="text-[9px] opacity-60">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Trades Table */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141414]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Trade History</span>
            <span className="text-[10px] text-[#3b82f6]">{filteredTrades.length}</span>
          </div>
          
          {/* Side Filters */}
          <div className="flex items-center gap-1">
            {(['all', 'BUY', 'SELL'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(0) }}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  filter === f 
                    ? f === 'BUY' ? 'text-[#4ade80] bg-[#4ade80]/10' 
                      : f === 'SELL' ? 'text-[#f87171] bg-[#f87171]/10'
                      : 'text-[#3b82f6] bg-[#3b82f6]/10'
                    : 'text-[#606060] hover:text-[#909090]'
                }`}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] text-[#505050] uppercase tracking-wide">
                <th className="px-3 py-2.5 font-medium">Market</th>
                <th className="px-3 py-2.5 font-medium">Side</th>
                <th className="px-3 py-2.5 font-medium text-right">Price</th>
                <th className="px-3 py-2.5 font-medium text-right">Quantity</th>
                <th className="px-3 py-2.5 font-medium text-right">Value</th>
                <th className="px-3 py-2.5 font-medium text-right">Fee</th>
                <th className="px-3 py-2.5 font-medium">Margin</th>
                <th className="px-3 py-2.5 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.map((trade) => (
                <tr key={trade.tradeId} className="border-t border-[#0F0F0F] hover:bg-[#0F0F0F] transition-colors">
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-[#e0e0e0] font-medium">{trade.marketSymbol}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-medium ${trade.side === 'BUY' ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-mono text-[#c0c0c0]">
                      {formatCurrency(trade.price)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-mono text-[#c0c0c0]">
                      {trade.quantity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-mono text-[#e0e0e0]">
                      {formatCurrency(trade.tradeValue)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-mono text-[#fbbf24]">
                      {formatCurrency(trade.fee, { minimumDecimals: 4, maximumDecimals: 6 })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      (trade.side === 'BUY' ? trade.buyerIsMargin : trade.sellerIsMargin)
                        ? 'bg-[#f59e0b]/10 text-[#fbbf24]' 
                        : 'bg-[#3b82f6]/10 text-[#60a5fa]'
                    }`}>
                      {(trade.side === 'BUY' ? trade.buyerIsMargin : trade.sellerIsMargin) ? 'Margin' : 'Spot'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[10px] text-[#707070]">
                      {trade.timestamp.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-[#141414]">
            <span className="text-[10px] text-[#505050]">
              {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredTrades.length)} of {filteredTrades.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-[11px] text-[#606060] hover:text-[#3b82f6] disabled:text-[#404040] disabled:cursor-not-allowed transition-colors"
              >
                ←
              </button>
              <span className="text-[10px] text-[#707070]">{page + 1}/{totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-[11px] text-[#606060] hover:text-[#3b82f6] disabled:text-[#404040] disabled:cursor-not-allowed transition-colors"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FeesTab({
  feeTotals,
  recentFees,
  feeLiveIds,
  feesLoading,
  feesByMarket,
}: {
  feeTotals: { totalFeesUsdc: number; takerFeesUsdc: number; makerFeesUsdc: number; totalTrades: number; takerTrades: number; makerTrades: number; totalVolumeUsdc: number }
  recentFees: FeeDetailRow[]
  feeLiveIds: Set<number>
  feesLoading: boolean
  feesByMarket: Array<{ market: string; fees: number; trades: number }>
}) {
  return (
    <div className="space-y-3">
      {/* Fee Summary Card */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Fee Summary</span>
          <span className="text-[10px] text-[#3b82f6]">{formatNumber(feeTotals.totalTrades)} trades</span>
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Fees</div>
            <div className="text-[16px] font-semibold text-[#e0e0e0] font-mono">
              {formatCurrency(feeTotals.totalFeesUsdc)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Taker</div>
            <div className="text-[16px] font-semibold text-[#f87171] font-mono">
              {formatCurrency(feeTotals.takerFeesUsdc)}
            </div>
            <div className="text-[10px] text-[#606060] mt-0.5">{formatNumber(feeTotals.takerTrades)} trades</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Maker</div>
            <div className="text-[16px] font-semibold text-[#4ade80] font-mono">
              {formatCurrency(feeTotals.makerFeesUsdc)}
            </div>
            <div className="text-[10px] text-[#606060] mt-0.5">{formatNumber(feeTotals.makerTrades)} trades</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[#1a1a1a] grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Volume</div>
            <div className="text-[14px] font-medium text-[#c0c0c0] font-mono">
              {formatCurrency(feeTotals.totalVolumeUsdc, { compact: true })}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Avg Fee Rate</div>
            <div className="text-[14px] font-medium text-[#c0c0c0] font-mono">
              {feeTotals.totalVolumeUsdc > 0
                ? `${((feeTotals.totalFeesUsdc / feeTotals.totalVolumeUsdc) * 100).toFixed(3)}%`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Fees by Market */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">By Market</span>
          <span className="text-[10px] text-[#3b82f6]">{feesByMarket.length}</span>
        </div>
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {feesByMarket.length === 0 ? (
            <div className="text-[11px] text-[#505050] py-2">No data</div>
          ) : (
            feesByMarket.map((item, idx) => (
              <div key={item.market} className="flex items-center justify-between py-2 px-2.5 bg-[#0F0F0F] rounded">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#3b82f6] w-5">{idx + 1}</span>
                  <span className="text-[11px] text-[#d0d0d0]">{item.market}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[#606060]">{formatNumber(item.trades)} trades</span>
                  <span className="text-[11px] text-[#fbbf24] font-mono">{formatCurrency(item.fees, { minimumDecimals: 4 })}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent Fees */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414]">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Recent Fees</span>
          <span className="text-[10px] text-[#3b82f6]">{recentFees.length}</span>
        </div>

        {feesLoading && recentFees.length === 0 ? (
          <div className="p-4 text-center">
            <span className="text-[11px] text-[#707070]">Loading...</span>
          </div>
        ) : recentFees.length === 0 ? (
          <div className="p-4 text-center">
            <span className="text-[11px] text-[#505050]">No fee history yet</span>
          </div>
        ) : (
          <div className="divide-y divide-[#0F0F0F]">
            {recentFees.slice(0, 10).map((f) => {
              const isLive = feeLiveIds.has(f.id)
              return (
                <div 
                  key={f.id} 
                  className={`flex items-center justify-between p-3 hover:bg-[#0F0F0F] transition-colors ${isLive ? 'bg-[#3b82f6]/5' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${f.fee_role === 'taker' ? 'bg-[#f87171]' : 'bg-[#4ade80]'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-[#e0e0e0] truncate">
                          {f.market_id ? f.market_id.replace(/-/g, '/').toUpperCase().slice(0, 12) : 'Trade'}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          f.fee_role === 'taker'
                            ? 'bg-[#f87171]/10 text-[#f87171]'
                            : 'bg-[#4ade80]/10 text-[#4ade80]'
                        }`}>
                          {f.fee_role.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#707070] font-mono mt-0.5">
                        {f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        {' · '}
                        {formatCurrency(f.trade_notional, { compact: true })} notional
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="text-[12px] font-medium text-[#fbbf24] font-mono">
                      -{formatCurrency(f.fee_amount_usdc, { minimumDecimals: 4 })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function RevenueTab({
  ownerMarkets,
  protocolMarkets,
  ownerTotals,
  protocolTotals,
  liveMarketKeys,
  isMarketOwner,
  isProtocolRecipient,
  ownerLoading,
  walletAddress,
}: {
  ownerMarkets: OwnerEarningsRow[]
  protocolMarkets: ProtocolEarningsRow[]
  ownerTotals: { totalOwnerEarningsUsdc: number; totalProtocolEarningsUsdc: number; totalFeesCollectedUsdc: number; totalVolumeUsdc: number; totalFeeEvents: number; marketCount: number }
  protocolTotals: { totalOwnerEarningsUsdc: number; totalProtocolEarningsUsdc: number; totalFeesCollectedUsdc: number; totalVolumeUsdc: number; totalFeeEvents: number; marketCount: number }
  liveMarketKeys: Set<string>
  isMarketOwner: boolean
  isProtocolRecipient: boolean
  ownerLoading: boolean
  walletAddress?: string
}) {
  const isActualProtocolAddress = useMemo(() => {
    const envAddr = process.env.NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT
    if (!envAddr || !walletAddress) return false
    return walletAddress.toLowerCase() === envAddr.toLowerCase()
  }, [walletAddress])

  if (!isMarketOwner && !isProtocolRecipient) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[12px] text-[#707070]">No revenue data available</p>
        <p className="text-[11px] text-[#505050] mt-1">Create markets to start earning revenue</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Protocol Revenue (only for actual protocol address) */}
      {isProtocolRecipient && isActualProtocolAddress && (
        <>
          <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Protocol Revenue</span>
              <span className="text-[10px] text-[#3b82f6]">{protocolTotals.marketCount} market{protocolTotals.marketCount !== 1 ? 's' : ''}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Protocol Earnings</div>
                <div className="text-[18px] font-semibold text-[#4ade80] font-mono">
                  {formatCurrency(protocolTotals.totalProtocolEarningsUsdc)}
                </div>
                <div className="text-[10px] text-[#606060] mt-0.5">80% share</div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">To Market Owners</div>
                <div className="text-[18px] font-semibold text-[#c0c0c0] font-mono">
                  {formatCurrency(protocolTotals.totalOwnerEarningsUsdc)}
                </div>
                <div className="text-[10px] text-[#606060] mt-0.5">20% share</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[#1a1a1a] grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Fees</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatCurrency(protocolTotals.totalFeesCollectedUsdc)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Volume</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatCurrency(protocolTotals.totalVolumeUsdc, { compact: true })}
                </div>
              </div>
            </div>
          </div>

          {/* Protocol Markets List */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Protocol Markets</span>
            </div>
            <div className="divide-y divide-[#0F0F0F]">
              {protocolMarkets.map((m) => {
                const mKey = `proto::${m.market_id}::${m.market_address}`
                const isLive = liveMarketKeys.has(mKey)
                return (
                  <div
                    key={`proto-${m.market_id}-${m.market_address}`}
                    className={`flex items-center justify-between p-3 hover:bg-[#0F0F0F] transition-colors ${isLive ? 'bg-[#4ade80]/5' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-[#e0e0e0] truncate">
                        {m.market_id ? m.market_id.replace(/-/g, '/').toUpperCase().slice(0, 14) : m.market_address.slice(0, 10) + '…'}
                      </div>
                      <div className="text-[10px] text-[#707070] font-mono mt-0.5">
                        {formatNumber(m.total_fee_events)} fees · {formatCurrency(m.total_volume_usdc, { compact: true })} vol
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className="text-[12px] font-semibold text-[#4ade80] font-mono">
                        +{formatCurrency(m.total_protocol_earnings_usdc)}
                      </div>
                      <div className="text-[10px] text-[#606060] font-mono">
                        of {formatCurrency(m.total_fees_collected_usdc)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Market Owner Revenue */}
      {isMarketOwner && (
        <>
          <div className={`bg-[#0A0A0A] rounded border border-[#141414] p-4 ${isProtocolRecipient && isActualProtocolAddress ? 'mt-4' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Market Owner Revenue</span>
              <span className="text-[10px] text-[#3b82f6]">{ownerTotals.marketCount} market{ownerTotals.marketCount !== 1 ? 's' : ''}</span>
            </div>

            {isActualProtocolAddress ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Owner Earnings</div>
                  <div className="text-[18px] font-semibold text-[#4ade80] font-mono">
                    {formatCurrency(ownerTotals.totalOwnerEarningsUsdc)}
                  </div>
                  <div className="text-[10px] text-[#606060] mt-0.5">20% share</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Protocol</div>
                  <div className="text-[18px] font-semibold text-[#c0c0c0] font-mono">
                    {formatCurrency(ownerTotals.totalProtocolEarningsUsdc)}
                  </div>
                  <div className="text-[10px] text-[#606060] mt-0.5">80% share</div>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Your Earnings</div>
                <div className="text-[18px] font-semibold text-[#4ade80] font-mono">
                  {formatCurrency(ownerTotals.totalOwnerEarningsUsdc)}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[#1a1a1a] grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Fees</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatCurrency(ownerTotals.totalFeesCollectedUsdc)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Volume</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatCurrency(ownerTotals.totalVolumeUsdc, { compact: true })}
                </div>
              </div>
            </div>
          </div>

          {/* Owner Markets List */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Your Markets</span>
            </div>

            {ownerLoading && ownerMarkets.length === 0 ? (
              <div className="p-4 text-center">
                <span className="text-[11px] text-[#707070]">Loading...</span>
              </div>
            ) : (
              <div className="divide-y divide-[#0F0F0F]">
                {ownerMarkets.map((m) => {
                  const mKey = `${m.market_id}::${m.market_address}`
                  const isLive = liveMarketKeys.has(mKey)
                  return (
                    <div
                      key={`owner-${m.market_id}-${m.market_address}`}
                      className={`flex items-center justify-between p-3 hover:bg-[#0F0F0F] transition-colors ${isLive ? 'bg-[#4ade80]/5' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-[#e0e0e0] truncate">
                          {m.market_id ? m.market_id.replace(/-/g, '/').toUpperCase().slice(0, 14) : m.market_address.slice(0, 10) + '…'}
                        </div>
                        <div className="text-[10px] text-[#707070] font-mono mt-0.5">
                          {formatNumber(m.total_fee_events)} fees · {formatCurrency(m.total_volume_usdc, { compact: true })} vol
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="text-[12px] font-semibold text-[#4ade80] font-mono">
                          +{formatCurrency(m.total_owner_earnings_usdc)}
                        </div>
                        <div className="text-[10px] text-[#606060] font-mono">
                          of {formatCurrency(m.total_fees_collected_usdc)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MarketsTab({
  createdMarkets,
  totals,
  isLoading,
  bondedMarkets,
  bondSummary,
  bondedMarketsLoading,
  refetchBondedMarkets,
}: {
  createdMarkets: CreatedMarketRow[]
  totals: {
    totalCreationFees: number
    totalInitialOrderValue: number
    totalInvested: number
    marketCount: number
    activeMarkets: number
    settledMarkets: number
    totalVolume: number
    totalTrades: number
  }
  isLoading: boolean
  bondedMarkets: BondedMarket[]
  bondSummary: { totalBonded: number; activeMarkets: number; settledMarkets: number; proposerCount: number; challengerCount: number }
  bondedMarketsLoading: boolean
  refetchBondedMarkets: () => void
}) {
  const [activeSection, setActiveSection] = useState<'bonded' | 'created'>('bonded')

  const formatTimeRemaining = (ms: number | null) => {
    if (!ms || ms <= 0) return null
    
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m`
    return `${seconds}s`
  }

  const hasCreatedMarkets = createdMarkets.length > 0
  const hasBondedMarkets = bondedMarkets.length > 0

  if (!hasCreatedMarkets && !hasBondedMarkets && !isLoading && !bondedMarketsLoading) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <p className="text-[12px] text-[#707070]">No market activity yet</p>
        <p className="text-[11px] text-[#505050] mt-1">Create a market or participate in settlement to see it here</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Section Tabs */}
      <div className="flex items-center gap-1 bg-[#0A0A0A] rounded border border-[#141414] p-1">
        <button
          onClick={() => setActiveSection('bonded')}
          className={`px-4 py-2 text-[11px] font-medium rounded transition-colors flex items-center gap-2 ${
            activeSection === 'bonded'
              ? 'bg-[#1a1a1a] text-[#e0e0e0]'
              : 'text-[#707070] hover:text-[#a0a0a0]'
          }`}
        >
          Bonded Markets
          {bondedMarkets.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-[#3b82f6]/20 text-[#3b82f6] rounded">
              {bondedMarkets.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSection('created')}
          className={`px-4 py-2 text-[11px] font-medium rounded transition-colors flex items-center gap-2 ${
            activeSection === 'created'
              ? 'bg-[#1a1a1a] text-[#e0e0e0]'
              : 'text-[#707070] hover:text-[#a0a0a0]'
          }`}
        >
          Created Markets
          {createdMarkets.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-[#4ade80]/20 text-[#4ade80] rounded">
              {createdMarkets.length}
            </span>
          )}
        </button>
      </div>

      {/* Bonded Markets Section */}
      {activeSection === 'bonded' && (
        <>
          {/* Bond Summary */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Settlement Bonds</span>
              <button
                onClick={refetchBondedMarkets}
                disabled={bondedMarketsLoading}
                className="text-[10px] text-[#606060] hover:text-[#3b82f6] disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <span className={bondedMarketsLoading ? 'animate-spin' : ''}>↻</span>
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-5 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Bonded</div>
                <div className="text-[18px] font-semibold text-[#fbbf24] font-mono">
                  {formatCurrency(bondSummary.totalBonded)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Active</div>
                <div className="text-[16px] font-medium text-[#4ade80] font-mono">
                  {formatNumber(bondSummary.activeMarkets)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Settled</div>
                <div className="text-[16px] font-medium text-[#c0c0c0] font-mono">
                  {formatNumber(bondSummary.settledMarkets)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">As Proposer</div>
                <div className="text-[16px] font-medium text-[#3b82f6] font-mono">
                  {formatNumber(bondSummary.proposerCount)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">As Challenger</div>
                <div className="text-[16px] font-medium text-[#f87171] font-mono">
                  {formatNumber(bondSummary.challengerCount)}
                </div>
              </div>
            </div>
          </div>

          {/* Bonded Markets List */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Your Bonded Markets</span>
            </div>

            {bondedMarketsLoading && bondedMarkets.length === 0 ? (
              <div className="p-4 text-center">
                <span className="text-[11px] text-[#707070]">Loading...</span>
              </div>
            ) : bondedMarkets.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-[12px] text-[#707070]">No bonded markets</p>
                <p className="text-[10px] text-[#505050] mt-1">Propose or challenge settlement prices to see them here</p>
              </div>
            ) : (
              <div className="divide-y divide-[#0F0F0F]">
                {bondedMarkets.map((m) => {
                  const statusColor = m.marketStatus === 'SETTLED'
                    ? 'bg-[#606060]'
                    : m.isActive
                      ? 'bg-[#4ade80]'
                      : 'bg-[#fbbf24]'
                  
                  const roleColor = m.bondRole === 'proposer' 
                    ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                    : m.bondRole === 'challenger'
                      ? 'text-[#f87171] bg-[#f87171]/10'
                      : 'text-[#a855f7] bg-[#a855f7]/10'

                  const timeRemaining = formatTimeRemaining(m.timeToSettlement)

                  return (
                    <div
                      key={m.id}
                      className="p-3 hover:bg-[#0F0F0F] transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                          <span className="text-[12px] font-medium text-[#e0e0e0]">
                            {m.symbol}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${roleColor}`}>
                            {m.bondRole}
                          </span>
                          <span className="text-[9px] text-[#505050] px-1.5 py-0.5 bg-[#141414] rounded">
                            {m.marketStatus}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-[12px] font-medium text-[#fbbf24] font-mono">
                            {formatCurrency(m.bondAmount)}
                          </div>
                          <div className="text-[9px] text-[#606060]">bonded</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-3 text-[#707070]">
                          {m.proposedSettlementValue !== null && (
                            <span>
                              Proposed: <span className="text-[#a0a0a0] font-mono">{formatCurrency(m.proposedSettlementValue)}</span>
                            </span>
                          )}
                          {m.settlementDisputed && m.alternativeSettlementValue !== null && (
                            <span className="text-[#f87171]">
                              Challenged: <span className="font-mono">{formatCurrency(m.alternativeSettlementValue)}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {timeRemaining ? (
                            <span className="text-[#4ade80] flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {timeRemaining} to settlement
                            </span>
                          ) : m.settlementDate ? (
                            <span className="text-[#707070]">
                              Settled {m.settlementDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Created Markets Section */}
      {activeSection === 'created' && (
        <>
          {/* Investment Summary */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Market Creation Investment</span>
              <span className="text-[10px] text-[#3b82f6]">{totals.marketCount} market{totals.marketCount !== 1 ? 's' : ''}</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Invested</div>
                <div className="text-[18px] font-semibold text-[#f87171] font-mono">
                  -{formatCurrency(totals.totalInvested)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Creation Fees</div>
                <div className="text-[16px] font-medium text-[#c0c0c0] font-mono">
                  {formatCurrency(totals.totalCreationFees)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Initial Orders</div>
                <div className="text-[16px] font-medium text-[#c0c0c0] font-mono">
                  {formatCurrency(totals.totalInitialOrderValue)}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[#1a1a1a] grid grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Active</div>
                <div className="text-[14px] font-medium text-[#4ade80] font-mono">
                  {formatNumber(totals.activeMarkets)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Settled</div>
                <div className="text-[14px] font-medium text-[#c0c0c0] font-mono">
                  {formatNumber(totals.settledMarkets)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Volume</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatCurrency(totals.totalVolume, { compact: true })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Trades</div>
                <div className="text-[14px] font-medium text-[#e0e0e0] font-mono">
                  {formatNumber(totals.totalTrades)}
                </div>
              </div>
            </div>
          </div>

          {/* Created Markets List */}
          <div className="bg-[#0A0A0A] rounded border border-[#141414]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#141414]">
              <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Your Created Markets</span>
            </div>

            {isLoading && createdMarkets.length === 0 ? (
              <div className="p-4 text-center">
                <span className="text-[11px] text-[#707070]">Loading...</span>
              </div>
            ) : createdMarkets.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-[12px] text-[#707070]">No markets created</p>
                <p className="text-[10px] text-[#505050] mt-1">Create your first market to see it here</p>
              </div>
            ) : (
              <div className="divide-y divide-[#0F0F0F]">
                {createdMarkets.map((m) => {
                  const invested = m.creation_fee + m.initial_order_value
                  const statusColor = m.market_status === 'SETTLED'
                    ? 'bg-[#606060]'
                    : m.is_active
                      ? 'bg-[#4ade80]'
                      : 'bg-[#fbbf24]'

                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-3 hover:bg-[#0F0F0F] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                          <span className="text-[11px] font-medium text-[#e0e0e0] truncate">
                            {m.symbol || m.market_identifier?.slice(0, 14) || 'Market'}
                          </span>
                          <span className="text-[10px] text-[#505050] px-1.5 py-0.5 bg-[#141414] rounded">
                            {m.market_status}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#707070] font-mono mt-0.5">
                          {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' · '}
                          {formatNumber(m.total_trades)} trades · {formatCurrency(m.total_volume, { compact: true })} vol
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="text-[12px] font-medium text-[#f87171] font-mono">
                          -{formatCurrency(invested)}
                        </div>
                        <div className="text-[10px] text-[#606060] font-mono">
                          {m.creation_fee > 0 && `fee: ${formatCurrency(m.creation_fee)}`}
                          {m.creation_fee > 0 && m.initial_order_value > 0 && ' · '}
                          {m.initial_order_value > 0 && `init: ${formatCurrency(m.initial_order_value)}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function OrdersTab({
  orders,
  summary,
  isLoading,
  error,
  refetch,
}: {
  orders: UserOrder[]
  summary: { totalOrders: number; openOrders: number; filledOrders: number; cancelledOrders: number; buyOrders: number; sellOrders: number; limitOrders: number; marketOrders: number }
  isLoading: boolean
  error: string | null
  refetch: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'BUY' | 'SELL'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'filled' | 'cancelled'>('all')
  const [marketFilter, setMarketFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const pageSize = 25

  const markets = useMemo(() => {
    const unique = [...new Set(orders.map(o => o.marketId).filter(Boolean))]
    return unique.map(id => {
      const order = orders.find(o => o.marketId === id)
      return { id, symbol: order?.marketSymbol || id }
    })
  }, [orders])

  const filteredOrders = useMemo(() => {
    let filtered = orders
    
    if (filter !== 'all') {
      filtered = filtered.filter(o => o.side === filter)
    }
    
    if (statusFilter !== 'all') {
      const openStatuses = ['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'NEW']
      const filledStatuses = ['FILLED', 'COMPLETED']
      const cancelledStatuses = ['CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED']
      
      if (statusFilter === 'open') {
        filtered = filtered.filter(o => openStatuses.includes(o.status.toUpperCase()))
      } else if (statusFilter === 'filled') {
        filtered = filtered.filter(o => filledStatuses.includes(o.status.toUpperCase()))
      } else if (statusFilter === 'cancelled') {
        filtered = filtered.filter(o => cancelledStatuses.includes(o.status.toUpperCase()))
      }
    }
    
    if (marketFilter !== 'all') {
      filtered = filtered.filter(o => o.marketId === marketFilter)
    }
    
    return filtered
  }, [orders, filter, statusFilter, marketFilter])

  const paginatedOrders = useMemo(() => {
    const start = page * pageSize
    return filteredOrders.slice(start, start + pageSize)
  }, [filteredOrders, page])

  const totalPages = Math.ceil(filteredOrders.length / pageSize)

  const getStatusColor = (status: string) => {
    const s = status.toUpperCase()
    if (['FILLED', 'COMPLETED'].includes(s)) return 'text-[#4ade80]'
    if (['PENDING', 'OPEN', 'NEW'].includes(s)) return 'text-[#3b82f6]'
    if (['PARTIALLY_FILLED'].includes(s)) return 'text-[#fbbf24]'
    if (['CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(s)) return 'text-[#707070]'
    return 'text-[#909090]'
  }

  const getStatusBg = (status: string) => {
    const s = status.toUpperCase()
    if (['FILLED', 'COMPLETED'].includes(s)) return 'bg-[#4ade80]/10'
    if (['PENDING', 'OPEN', 'NEW'].includes(s)) return 'bg-[#3b82f6]/10'
    if (['PARTIALLY_FILLED'].includes(s)) return 'bg-[#fbbf24]/10'
    if (['CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(s)) return 'bg-[#707070]/10'
    return 'bg-[#303030]/10'
  }

  if (isLoading && orders.length === 0) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-4">
          <div className="w-5 h-5 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-[12px] text-[#909090]">Loading order history...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#3b1a1a] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#1a1414] flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[#f87171]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-[12px] text-[#f87171] mb-2">{error}</p>
        <button
          onClick={refetch}
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[#141414] flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-[13px] text-[#707070]">No orders found</p>
        <p className="text-[11px] text-[#505050] mt-1">Your order history will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wide">Order History</span>
            {summary.openOrders > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[#3b82f6]/10 text-[#3b82f6] rounded">
                {summary.openOrders} Open
              </span>
            )}
          </div>
          <button
            onClick={refetch}
            disabled={isLoading}
            className="text-[10px] text-[#606060] hover:text-[#3b82f6] disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            <span className={isLoading ? 'animate-spin' : ''}>↻</span>
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-4 lg:grid-cols-7 gap-4">
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Total Orders</div>
            <div className="text-[18px] font-semibold text-[#e0e0e0] font-mono">{formatNumber(summary.totalOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Open</div>
            <div className="text-[18px] font-semibold text-[#3b82f6] font-mono">{formatNumber(summary.openOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Filled</div>
            <div className="text-[18px] font-semibold text-[#4ade80] font-mono">{formatNumber(summary.filledOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Buy Orders</div>
            <div className="text-[18px] font-semibold text-[#4ade80] font-mono">{formatNumber(summary.buyOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Sell Orders</div>
            <div className="text-[18px] font-semibold text-[#f87171] font-mono">{formatNumber(summary.sellOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Limit</div>
            <div className="text-[18px] font-semibold text-[#a0a0a0] font-mono">{formatNumber(summary.limitOrders)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">Market</div>
            <div className="text-[18px] font-semibold text-[#a0a0a0] font-mono">{formatNumber(summary.marketOrders)}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-[#0A0A0A] rounded border border-[#141414] p-1">
          {(['all', 'BUY', 'SELL'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(0) }}
              className={`px-3 py-1.5 text-[10px] font-medium rounded transition-colors ${
                filter === f 
                  ? 'bg-[#1a1a1a] text-[#e0e0e0]' 
                  : 'text-[#707070] hover:text-[#a0a0a0]'
              }`}
            >
              {f === 'all' ? 'All Sides' : f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#0A0A0A] rounded border border-[#141414] p-1">
          {(['all', 'open', 'filled', 'cancelled'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setPage(0) }}
              className={`px-3 py-1.5 text-[10px] font-medium rounded transition-colors capitalize ${
                statusFilter === f 
                  ? 'bg-[#1a1a1a] text-[#e0e0e0]' 
                  : 'text-[#707070] hover:text-[#a0a0a0]'
              }`}
            >
              {f === 'all' ? 'All Status' : f}
            </button>
          ))}
        </div>

        {markets.length > 1 && (
          <select
            value={marketFilter}
            onChange={e => { setMarketFilter(e.target.value); setPage(0) }}
            className="bg-[#0A0A0A] border border-[#141414] rounded px-3 py-1.5 text-[10px] text-[#a0a0a0] focus:outline-none focus:border-[#3b82f6]"
          >
            <option value="all">All Markets</option>
            {markets.map(m => (
              <option key={m.id} value={m.id}>{m.symbol}</option>
            ))}
          </select>
        )}

        <span className="text-[10px] text-[#505050] ml-auto">
          Showing {filteredOrders.length} of {orders.length} orders
        </span>
      </div>

      {/* Orders Table */}
      <div className="bg-[#0A0A0A] rounded border border-[#141414] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#141414]">
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Date</th>
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Market</th>
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Side</th>
                <th className="text-right text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Price</th>
                <th className="text-right text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Qty</th>
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide px-4 py-3">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F0F0F]">
              {paginatedOrders.map((order, idx) => (
                <tr key={`${order.orderId}-${order.occurredAt.getTime()}-${idx}`} className="hover:bg-[#0F0F0F] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-[11px] text-[#a0a0a0] font-mono">
                      {order.occurredAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-[9px] text-[#505050] font-mono">
                      {order.occurredAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] text-[#e0e0e0]">{order.marketSymbol}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] text-[#909090] px-1.5 py-0.5 bg-[#1a1a1a] rounded">
                      {order.orderType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-medium ${order.side === 'BUY' ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                      {order.side}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[11px] font-mono text-[#e0e0e0]">
                      {order.price !== null ? formatCurrency(order.price) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[11px] font-mono text-[#a0a0a0]">
                      {formatNumber(order.quantity)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusBg(order.status)} ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {order.txHash ? (
                      <a
                        href={`https://hyperevmscan.io/tx/${order.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] font-mono transition-colors"
                      >
                        {order.txHash.slice(0, 8)}...
                      </a>
                    ) : (
                      <span className="text-[10px] text-[#404040]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#141414]">
            <span className="text-[10px] text-[#606060]">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 text-[10px] text-[#707070] hover:text-[#e0e0e0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 text-[10px] text-[#707070] hover:text-[#e0e0e0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
