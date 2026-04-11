'use client'

import React, { useState, useMemo } from 'react'
import { ActivityRecord, ActivityType } from '@/hooks/useAccountActivity'
import { formatCurrency } from '@/lib/formatters'

interface ActivityTableProps {
  activities: ActivityRecord[]
  isLoading?: boolean
  compact?: boolean
}

const typeConfig: Record<ActivityType, { label: string; color: string }> = {
  deposit: { label: 'Deposit', color: 'text-[#4ade80]' },
  withdraw: { label: 'Withdraw', color: 'text-[#a0a0a0]' },
  trade_fee: { label: 'Fee', color: 'text-[#fbbf24]' },
  trade_pnl: { label: 'P&L', color: 'text-[#60a5fa]' },
  bond_lock: { label: 'Bond Lock', color: 'text-[#c084fc]' },
  bond_release: { label: 'Bond Release', color: 'text-[#a78bfa]' },
  collateral_lock: { label: 'Collateral Lock', color: 'text-[#f472b6]' },
  collateral_release: { label: 'Collateral Release', color: 'text-[#f9a8d4]' },
  liquidation: { label: 'Liquidation', color: 'text-[#f87171]' },
  settlement: { label: 'Settlement', color: 'text-[#22d3ee]' },
}

type FilterType = 'all' | ActivityType

export default function ActivityTable({ activities, isLoading, compact }: ActivityTableProps) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [page, setPage] = useState(0)
  const pageSize = compact ? 5 : 25

  const filteredActivities = useMemo(() => {
    if (filter === 'all') return activities
    return activities.filter(a => a.type === filter)
  }, [activities, filter])

  const paginatedActivities = useMemo(() => {
    const start = page * pageSize
    return filteredActivities.slice(start, start + pageSize)
  }, [filteredActivities, page, pageSize])

  const totalPages = Math.ceil(filteredActivities.length / pageSize)

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatAmount = (amount: number, type: ActivityType) => {
    // Use more decimals for fees since they can be very small
    const isFee = type === 'trade_fee'
    const formatted = formatCurrency(amount, { 
      showSign: true,
      minimumDecimals: isFee ? 4 : 2,
      maximumDecimals: isFee ? 6 : 2
    })
    
    return (
      <span className={amount >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
        {formatted}
      </span>
    )
  }

  const truncateHash = (hash?: string) => {
    if (!hash) return '—'
    return `${hash.slice(0, 4)}..${hash.slice(-3)}`
  }

  if (isLoading && activities.length === 0) {
    return (
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
          <span className="text-[11px] text-[#707070]">Loading...</span>
        </div>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="p-4 text-center">
        <span className="text-[11px] text-[#505050]">No transactions</span>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      {!compact && (
        <div className="flex items-center gap-1 px-3 py-2.5 border-b border-[#141414] overflow-x-auto">
          <button
            onClick={() => { setFilter('all'); setPage(0) }}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${
              filter === 'all' ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-[#606060] hover:text-[#909090]'
            }`}
          >
            All
          </button>
          {(['deposit', 'withdraw', 'trade_fee', 'trade_pnl', 'settlement'] as ActivityType[]).map((type) => (
            <button
              key={type}
              onClick={() => { setFilter(type); setPage(0) }}
              className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                filter === type ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-[#606060] hover:text-[#909090]'
              }`}
            >
              {typeConfig[type].label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] text-[#505050] uppercase tracking-wide">
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Market</th>
              <th className="px-3 py-2.5 font-medium text-right">Amount</th>
              <th className="px-3 py-2.5 font-medium">Tx</th>
              <th className="px-3 py-2.5 font-medium text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {paginatedActivities.map((activity) => {
              const config = typeConfig[activity.type]
              return (
                <tr key={activity.id} className="border-t border-[#0F0F0F] hover:bg-[#0F0F0F] transition-colors">
                  <td className="px-3 py-2">
                    <span className={`text-[11px] ${config.color}`}>{config.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-[#c0c0c0]">{activity.marketSymbol || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[11px] font-mono">{formatAmount(activity.amount, activity.type)}</span>
                  </td>
                  <td className="px-3 py-2">
                    {activity.txHash ? (
                      <a
                        href={`https://hyperevmscan.io/tx/${activity.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] font-mono transition-colors"
                      >
                        {truncateHash(activity.txHash)}
                      </a>
                    ) : (
                      <span className="text-[10px] text-[#404040]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[10px] text-[#707070]">{formatDate(activity.timestamp)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!compact && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-[#141414]">
          <span className="text-[10px] text-[#505050]">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredActivities.length)} of {filteredActivities.length}
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
  )
}
