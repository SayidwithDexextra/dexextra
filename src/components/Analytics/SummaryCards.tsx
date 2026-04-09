'use client'

import React from 'react'
import { ActivitySummary } from '@/hooks/useAccountActivity'
import { formatCurrency } from '@/lib/formatters'

interface SummaryCardsProps {
  summary: ActivitySummary
  isLoading?: boolean
  onChainRealizedPnl?: number
  onChainUnrealizedPnl?: number
}

export default function SummaryCards({ summary, isLoading, onChainRealizedPnl, onChainUnrealizedPnl }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-6 xl:grid-cols-7 gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-[#0A0A0A] rounded border border-[#141414] p-2">
            <div className="h-2 w-10 bg-[#1a1a1a] rounded mb-2 animate-pulse" />
            <div className="h-3 w-14 bg-[#1a1a1a] rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  // Use on-chain values when available (same source as Portfolio sidebar)
  const realizedPnl = onChainRealizedPnl ?? summary.totalRealizedPnl
  const unrealizedPnl = onChainUnrealizedPnl ?? summary.totalUnrealizedPnl
  const netPnl = realizedPnl + unrealizedPnl

  const hasSettlements = summary.settledPositionsCount > 0

  const cards = [
    { label: 'Deposits', value: formatCurrency(summary.totalDeposits), color: 'text-[#4ade80]' },
    { label: 'Withdrawals', value: formatCurrency(summary.totalWithdrawals), color: 'text-[#c0c0c0]' },
    { label: 'Fees', value: formatCurrency(summary.totalFeesPaid), color: 'text-[#fbbf24]' },
    ...(hasSettlements ? [{ 
      label: `Settled (${summary.settledPositionsCount})`, 
      value: formatCurrency(summary.totalSettlementPnl, { showSign: true }), 
      color: summary.totalSettlementPnl >= 0 ? 'text-[#22d3ee]' : 'text-[#f87171]' 
    }] : []),
    { label: 'Realized', value: formatCurrency(realizedPnl, { showSign: true }), color: realizedPnl >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]' },
    { label: 'Net', value: formatCurrency(netPnl, { showSign: true }), color: netPnl >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]' },
  ]

  const gridCols = hasSettlements ? 'grid-cols-3 md:grid-cols-4 xl:grid-cols-7' : 'grid-cols-3 md:grid-cols-6'

  return (
    <div className={`grid ${gridCols} gap-2`}>
      {cards.map((card) => (
        <div key={card.label} className="bg-[#0A0A0A] rounded border border-[#141414] p-2.5">
          <div className="text-[10px] text-[#707070] uppercase tracking-wide mb-1">{card.label}</div>
          <div className={`text-[13px] font-mono ${card.color}`}>{card.value}</div>
        </div>
      ))}
    </div>
  )
}
