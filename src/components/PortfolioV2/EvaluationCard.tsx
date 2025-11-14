'use client'

import Card from './Card'
import { getPortfolioTheme } from './theme'
import React, { useEffect, useMemo, useState } from 'react'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePositions } from '@/hooks/usePositions'
import { useWallet } from '@/hooks/useWallet'
import { CONTRACT_ADDRESSES, populateMarketInfoClient } from '@/lib/contractConfig'
import { orderService } from '@/lib/orderService'

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
	const { positions } = usePositions(undefined, { enabled: true })
	const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0)

	// Fetch total active orders across all markets directly from OrderBook contracts
	useEffect(() => {
		let cancelled = false
		const fetchActiveOrders = async () => {
			try {
				const addr = walletData?.address
				if (!addr) {
					if (!cancelled) setActiveOrdersCount(0)
					return
				}
				// Populate market info on client to resolve OrderBook addresses
				try { await populateMarketInfoClient() } catch {}
				const markets: any[] = Object.values((CONTRACT_ADDRESSES as any).MARKET_INFO || {})
				if (!markets.length) {
					if (!cancelled) setActiveOrdersCount(0)
					return
				}
				// Query each market's OrderBook for user's active orders
				const results = await Promise.allSettled(
					markets.map((m) => orderService.getUserActiveOrders(addr, m?.marketIdentifier || m?.symbol || ''))
				)
				let total = 0
				for (const r of results) {
					if (r.status === 'fulfilled' && Array.isArray(r.value)) total += r.value.length
				}
				if (!cancelled) setActiveOrdersCount(total)
			} catch {
				if (!cancelled) setActiveOrdersCount(0)
			}
		}
		fetchActiveOrders()
		const id = setInterval(fetchActiveOrders, 15000)
		return () => { cancelled = true; clearInterval(id) }
	}, [walletData?.address])

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
					<p className="text-base font-medium mb-2" style={{ color: '#E5E7EB' }}>
						Evaluation
					</p>
					<p className="text-xs mb-3" style={{ color: '#9CA3AF' }}>
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
					{/* <div
						className="inline-flex items-center gap-1.5 mt-1 px-3 py-1 rounded-full text-xs font-medium border transition-all hover:border-[#333333]"
						style={{ background: '#1A1A1A', color: '#D1D5DB', borderColor: '#222222' }}
					>
						<span>{isLoading ? 'Loading…' : isHealthy ? 'Margin healthy' : 'Attention needed'}</span>
						<span>{isHealthy ? '✅' : '⚠️'}</span>
					</div> */}
				</div>
				<div>
					<div
						className="rounded-full transition-all duration-500"
						style={{
							background: 'linear-gradient(to right, rgba(255,255,255,0.10), rgba(255,255,255,0.00))',
							padding: '1px',
							display: 'inline-block',
						}}
					>
					<button
						className="text-sm font-medium rounded-full px-4 py-1.5 transition-all hover:bg-[#222222] border"
							style={{ background: '#0B0B0B'/**/, color: '#D1D5DB', borderColor: '#1F1F1F' }}
					>
						Last 30 days ▼
					</button>
					</div>
				</div>
			</div>

			<div className="mt-4">
				<Sparkline />
			</div>

			<div className="grid grid-cols-3 gap-10 mt-6 pt-6" style={{ borderTop: '1px solid #1A1A1A' }}>
				{kpis.map((kpi) => (
					<div key={kpi.label} className="min-w-0">
						<p className="text-xs font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
							{kpi.label}
						</p>
						<div className="flex items-baseline gap-2">
							<p className="text-xl font-bold" style={{ color: '#FFFFFF' }}>{kpi.value}</p>
							{kpi.sub ? (
								<span className="text-xs font-medium" style={{ color: '#6B7280' }}>
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
						<p className="text-xs font-medium mb-1" style={{ color: '#9CA3AF' }}>
							Portfolio score
						</p>
						<p className="text-base font-bold leading-tight">
							<span style={{ color: '#FFFFFF' }}>69</span>
							<span style={{ color: '#6B7280' }}> /100</span>
						</p>
						<p className="text-xs font-medium mt-0.5" style={{ color: '#9CA3AF' }}>
							Good
						</p>
					</div>
				</div>

				{/* AIRA */}
				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
					Active Orders:
					</p>
					<div className="flex items-center gap-2 mb-1">
						<p className="text-base font-bold" style={{ color: '#FFFFFF' }}>{activeOrdersCount}</p>
						<span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
					</div>
					<p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>
						Across all markets
					</p>
				</div>

				{/* PRI */}
				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
					Open Positions:
					</p>
					<div className="flex items-center gap-1.5 mb-1">
						<p className="text-base font-bold" style={{ color: '#FFFFFF' }}>{positions?.length || 0}</p>
						<span className="text-xs" style={{ color: '#6B7280' }}>ⓘ</span>
					</div>
					<p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>
						Across all markets
					</p>
				</div>
			</div>
		</Card>
	)
}


