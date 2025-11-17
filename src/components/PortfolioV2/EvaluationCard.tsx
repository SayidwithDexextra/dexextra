'use client'

import Card from './Card'
import { getPortfolioTheme } from './theme'
import React, { useMemo } from 'react'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioData } from '@/hooks/usePortfolioData'
import { useWallet } from '@/hooks/useWallet'

type KPI = {
	label: string
	value: string
	sub?: string
}

function Sparkline() {
	// Lightweight SVG sparkline for placeholder visualization
	return (
		<svg viewBox="0 0 600 200" className="w-full h-[200px]" style={{ marginTop: '12px', marginBottom: '12px' }}>
			<defs>
				<linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
					<stop offset="100%" stopColor="rgba(255,255,255,0.00)" />
				</linearGradient>
			</defs>
			<path
				d="M0 120 C 60 110, 120 85, 180 100 S 300 145, 360 120 480 80, 540 120 600 112, 600 112 L 600 200 L 0 200 Z"
				fill="url(#area)"
			/>
			<path
				d="M0 120 C 60 110, 120 85, 180 100 S 300 145, 360 120 480 80, 540 120 600 112, 600 112"
				stroke="#FFFFFF"
				strokeOpacity="0.6"
				fill="none"
				strokeWidth="1.5"
			/>
		</svg>
	)
}

export default function EvaluationCard() {
	const theme = getPortfolioTheme()
	const { walletData } = useWallet() as any
	const {
		totalCollateral,
		availableBalance,
		marginUsed,
		marginReserved,
		realizedPnL,
		unrealizedPnL,
		socializedLoss,
		isLoading,
		isHealthy,
	} = useCoreVault()
	const { positions, activeOrdersCount, hasLoadedOnce: portfolioHasLoaded, isLoading: isLoadingPortfolio } = usePortfolioData({ enabled: true, refreshInterval: 15000 })

	// Parse numeric values safely
	const nums = useMemo(() => {
		const tc = parseFloat(totalCollateral || '0') || 0
		const avail = parseFloat(availableBalance || '0') || 0
		const used = parseFloat(marginUsed || '0') || 0
		const reserved = parseFloat(marginReserved || '0') || 0
		const realized = parseFloat(realizedPnL || '0') || 0
		const unrealized = parseFloat(unrealizedPnL || '0') || 0
		const haircut = parseFloat(socializedLoss || '0') || 0
		// Match Header logic: avoid liquidation double-count by not subtracting negative realized again
		const realizedForPortfolio = Math.max(0, realized)
		const value = tc + realizedForPortfolio + unrealized
		// Use unrealizedPnL as a current session delta proxy
		const deltaAmount = unrealized
		const baseForPct = Math.max(1e-9, tc) // avoid div by zero
		const deltaPct = (deltaAmount / baseForPct) * 100
		const totalProfit = realized + unrealized
		const utilization = tc > 0 ? ((tc - avail) / tc) * 100 : 0
		return {
			tc,
			avail,
			used,
			reserved,
			realized,
			unrealized,
			haircut,
			value,
			deltaAmount,
			deltaPct,
			totalProfit,
			utilization,
		}
	}, [totalCollateral, availableBalance, marginUsed, marginReserved, realizedPnL, unrealizedPnL, socializedLoss])

	const formatUSD = (n: number, minFrac = 2, maxFrac = 2) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac }).format(n)
	const formatPct = (n: number, frac = 1) =>
		new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: frac, maximumFractionDigits: frac }).format(n / 100)

	const kpis: KPI[] = [
		{
			label: 'Total Realized P&L',
			value: `${nums.realized >= 0 ? '+' : ''}${formatUSD(nums.realized)}`,
			sub: `${nums.realized >= 0 ? '+' : ''}${formatPct((nums.realized / Math.max(1e-9, nums.tc)) * 100)}`
		},
		{
			label: 'Total Unrealized P&L',
			value: `${nums.unrealized >= 0 ? '+' : ''}${formatUSD(nums.unrealized)}`,
			sub: `${nums.unrealized >= 0 ? '+' : ''}${formatPct((nums.unrealized / Math.max(1e-9, nums.tc)) * 100)}`
		},
		{
			label: 'Total P&L',
			value: `${nums.totalProfit >= 0 ? '+' : ''}${formatUSD(nums.totalProfit)}`,
			sub: `${nums.totalProfit >= 0 ? '+' : ''}${formatPct((nums.totalProfit / Math.max(1e-9, nums.tc)) * 100)}`
		},
	]
	return (
		<Card>
			<div className="flex items-start justify-between mb-1">
				<div>
					<p className="text-base font-medium mb-2 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
						Evaluation
					</p>
					<p className="text-xs mb-3" style={{ color: '#808080' }}>
						Total assets
					</p>
					<div className="flex items-center gap-3 mb-2">
						<span className="text-[44px] font-bold tracking-tight leading-none" style={{ color: '#FFFFFF' }}>
							{formatUSD(Math.max(0, nums.value)).split('.')[0]}
							<span className="text-[28px] align-top" style={{ color: '#D1D5DB' }}>
								.{formatUSD(Math.max(0, nums.value)).split('.')[1] || '00'}
							</span>
						</span>
						{Number.isFinite(nums.deltaPct) && (
							<span
								className="px-2.5 py-1 rounded-md text-xs font-semibold"
								style={{ background: nums.deltaAmount >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: nums.deltaAmount >= 0 ? '#10B981' : '#EF4444' }}
							>
								△{formatPct(nums.deltaPct)}
							</span>
						)}
						{Number.isFinite(nums.deltaAmount) && (
							<span
								className="px-2.5 py-1 rounded-md text-xs font-semibold"
								style={{ background: nums.deltaAmount >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: nums.deltaAmount >= 0 ? '#10B981' : '#EF4444' }}
							>
								{`${nums.deltaAmount >= 0 ? '+' : ''}${formatUSD(nums.deltaAmount)}`}
							</span>
						)}
					</div>
				</div>
				<div>
					
				</div>
			</div>

			<div className="mt-4">
				<Sparkline />
			</div>

			<div className="grid grid-cols-3 gap-10 mt-6 pt-6" style={{ borderTop: '1px solid #1A1A1A' }}>
				{kpis.map((kpi) => (
					<div key={kpi.label} className="min-w-0">
						<p className="text-xs font-medium mb-1.5" style={{ color: '#808080' }}>
							{kpi.label}
						</p>
						<div className="flex items-baseline gap-2">
							<p className="text-xl font-bold" style={{ color: '#FFFFFF' }}>{kpi.value}</p>
							{kpi.sub ? (
								<span className="text-xs font-medium" style={{ color: '#606060' }}>
									{kpi.sub}
								</span>
							) : null}
						</div>
					</div>
				))}
			</div>

			{/* Stacked score metrics under the KPI row */}
			<div className="grid grid-cols-3 gap-10 mt-8 pt-6" style={{ borderTop: '1px solid #1A1A1A' }}>
				{/* Portfolio score */}
				<div className="flex items-center gap-4">
					<div
						className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
						style={{ background: 'rgba(139,195,74,0.15)' }}
					>
						<span className="text-lg font-bold" style={{ color: '#8BC34A' }}>B</span>
					</div>
					<div>
						<p className="text-xs font-medium mb-1" style={{ color: '#808080' }}>
							Portfolio score
						</p>
						<p className="text-base font-bold leading-tight">
							<span style={{ color: '#FFFFFF' }}>69</span>
							<span style={{ color: '#606060' }}> /100</span>
						</p>
						<p className="text-xs font-medium mt-0.5" style={{ color: '#808080' }}>
							Good
						</p>
					</div>
				</div>

				{/* AIRA */}
				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#808080' }}>
					Active Orders
					</p>
					<div className="flex items-center gap-2 mb-1">
						{!portfolioHasLoaded || isLoadingPortfolio ? (
							<div className="w-8 h-4 bg-[#1A1A1A] rounded animate-pulse" />
						) : (
							<>
								<p className="text-base font-bold" style={{ color: '#FFFFFF' }}>{activeOrdersCount}</p>
								<span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
							</>
						)}
					</div>
					<p className="text-xs font-medium" style={{ color: '#606060' }}>
						Across all markets
					</p>
				</div>

				{/* PRI */}
				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#808080' }}>
					Open Positions:
					</p>
					<div className="flex items-center gap-1.5 mb-1">
						{!portfolioHasLoaded || isLoadingPortfolio ? (
							<div className="w-8 h-4 bg-[#1A1A1A] rounded animate-pulse" />
						) : (
							<>
								<p className="text-base font-bold" style={{ color: '#FFFFFF' }}>{positions?.length || 0}</p>
								<span className="text-xs" style={{ color: '#6B7280' }}>ⓘ</span>
							</>
						)}
					</div>
					<p className="text-xs font-medium" style={{ color: '#606060' }}>
						Across all markets
					</p>
				</div>
			</div>
		</Card>
	)
}


