'use client'

import Card from './Card'
import { useMemo } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useMarkets } from '@/hooks/useMarkets'
import { useWallet } from '@/hooks/useWallet'
import { getUserActiveOrdersAllMarkets, cancelOrderForMarket } from '@/hooks/useOrderBook'
import React, { useEffect, useRef, useState } from 'react'

type Row = {
	token: string
	symbol: string
	amount: string
	value: string
	allocation: string
	price: string
	primary?: boolean
}

type OrderRow = {
	token: string
	symbol: string
	orders: number
	totalSize: string
	totalValue: string
	avgPrice: string
}

type OrderBucket = { symbol: string; token: string; orders: any[] }

function formatUsd(n: number): string {
	if (!Number.isFinite(n)) return '$0.00'
	return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

function formatNum(n: number, decimals = 4): string {
	if (!Number.isFinite(n)) return '0'
	return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: Math.min(2, decimals) })
}

export default function BreakdownTable() {
	const { positions, isLoading: positionsLoading } = usePositions(undefined, { enabled: true })
	const { markets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 })
	const { walletData } = useWallet() as any
	const [orderRows, setOrderRows] = useState<OrderRow[]>([])
	const fetchedForRef = useRef<string | null>(null)
	const [ordersRefreshTick, setOrdersRefreshTick] = useState(0)
	const [orderBuckets, setOrderBuckets] = useState<OrderBucket[]>([])
	const [cancellingId, setCancellingId] = useState<string | null>(null)

	const marketIdMap = useMemo(() => {
		const map = new Map<string, { symbol: string; name: string }>()
		for (const m of markets || []) {
			if (m?.market_id_bytes32) {
				map.set(String(m.market_id_bytes32).toLowerCase(), {
					symbol: (m.symbol || '').toUpperCase(),
					name: m.name || m.symbol || ''
				})
			}
		}
		return map
	}, [markets])

	const computedRows: Row[] = useMemo(() => {
		if (!positions || positions.length === 0) return []
		// Compute total notional for allocation
		const notionals = positions.map(p => Math.abs(p.size) * (p.markPrice || p.entryPrice || 0))
		const totalNotional = notionals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
		const rows: Row[] = positions.map((p, idx) => {
			const keyHex = String(p.marketId || '').toLowerCase()
			const meta = marketIdMap.get(keyHex)
			const symbol = (meta?.symbol || p.symbol || keyHex.slice(2, 6)).toUpperCase()
			const token = meta?.name || symbol
			const amount = Math.abs(p.size)
			const mark = p.markPrice || p.entryPrice || 0
			const value = amount * mark
			const allocation = totalNotional > 0 ? (value / totalNotional) * 100 : 0
			return {
				token,
				symbol,
				amount: formatNum(amount, 4),
				value: formatUsd(value),
				allocation: `${formatNum(allocation, 2)}%`,
				price: formatUsd(mark),
				primary: false
			}
		})
		// Mark the largest allocation as primary
		let maxIdx = -1
		let maxVal = -1
		rows.forEach((r, i) => {
			const pct = parseFloat(r.allocation.replace('%', '')) || 0
			if (pct > maxVal) { maxVal = pct; maxIdx = i }
		})
		if (maxIdx >= 0) rows[maxIdx].primary = true
		return rows.sort((a, b) => parseFloat(b.allocation) - parseFloat(a.allocation))
	}, [positions, marketIdMap])

	// Aggregate open orders across all markets for the connected wallet
	useEffect(() => {
		let cancelled = false
		const run = async () => {
			try {
				const addr = walletData?.address
				if (!addr) {
					// Keep prior rows to avoid flicker; will refresh when address becomes available
					fetchedForRef.current = null
					return
				}
				// Prevent multiple fetches for the same wallet (no polling)
				if (fetchedForRef.current === addr) return
				fetchedForRef.current = addr
				const buckets = await getUserActiveOrdersAllMarkets(addr)
				console.log('[BreakdownTable] getUserActiveOrdersAllMarkets buckets', buckets);
				setOrderBuckets(buckets as OrderBucket[])
				if (cancelled) return
			} catch {}
		}
		run()
		return () => { cancelled = true }
	}, [walletData?.address, ordersRefreshTick])

	// Flatten bucketed orders for rendering with cancel actions
	const flatOrders = useMemo(() => {
		const rows: Array<{ token: string; symbol: string; id: string; metric: string; side: 'BUY' | 'SELL'; price: number; size: number }> = []
		orderBuckets.forEach((bucket) => {
			const symbol = (bucket.symbol || 'UNKNOWN').toString().toUpperCase()
			const token = bucket.token || symbol
			;(bucket.orders || []).forEach((o: any) => {
				const side = (o?.side || (o?.isBuy ? 'BUY' : 'SELL')).toString().toUpperCase() as 'BUY' | 'SELL'
				let qty = Number(o?.quantity || 0)
				if (qty >= 1_000_000_000) qty = qty / 1_000_000_000_000
				const priceNum = Number(o?.price || 0)
				const idStr = String(o?.id || '')
				const metric = String(o?.metricId || symbol)
				rows.push({ token, symbol, id: idStr, metric, side, price: priceNum, size: qty })
			})
		})
		return rows
	}, [orderBuckets])
	return (
		<div
			className="bg-[#1A1A1A] rounded-md border border-[#222222]"
			style={{
				// Provide extra room so the right-pane scroll can move past footer overlays
				paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 240px)',
			}}
		>
			<div className="flex items-center justify-between p-4 border-b border-[#1A1A1A]">
				<div className="flex items-center gap-2">
					<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#10B981]" />
					<div className="flex flex-col">
						<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>Breakdown</span>
						<span className="text-xs" style={{ color: '#9CA3AF' }}>Open positions and orders</span>
					</div>
				</div>
				<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
					{positions.length} positions · {orderBuckets.length} markets
				</div>
			</div>
			<div className="overflow-hidden rounded-lg">
				<table className="w-full">
					<thead>
						<tr
							className="text-left text-xs font-medium"
							style={{ color: '#9CA3AF', background: 'transparent' }}
						>
							<th className="px-5 py-3.5 font-medium">Token</th>
							<th className="px-5 py-3.5 font-medium">Amount</th>
							<th className="px-5 py-3.5 font-medium">Value</th>
							<th className="px-5 py-3.5 font-medium">Allocation</th>
							<th className="px-5 py-3.5 font-medium">Price</th>
							<th className="px-5 py-3.5"></th>
						</tr>
					</thead>
					<tbody>
						{computedRows.length === 0 ? (
							<tr className="border-t" style={{ borderColor: '#1A1A1A' }}>
								<td className="px-5 py-6 text-sm" colSpan={6} style={{ color: '#9CA3AF' }}>
									{positionsLoading ? 'Loading positions…' : 'No open positions'}
								</td>
							</tr>
						) : computedRows.map((row, idx) => (
							<tr
								key={idx}
								className="border-t"
								style={{ borderColor: '#1A1A1A' }}
							>
								<td className="px-5 py-4">
									<div className="flex items-center gap-3">
										<div 
											className="w-6 h-6 rounded-full flex items-center justify-center" 
											style={{ background: '#1A1A1A' }}
										>
											<span className="text-[10px] font-bold">₿</span>
										</div>
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.token}</span>
										<span className="text-xs font-medium" style={{ color: '#6B7280' }}>{row.symbol}</span>
									</div>
								</td>
								<td className="px-5 py-4">
									<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.amount}</span>
								</td>
								<td className="px-5 py-4">
									<span className="text-sm font-bold" style={{ color: '#FFFFFF' }}>{row.value}</span>
								</td>
								<td className="px-5 py-4">
									<div className="flex items-center gap-2">
										<span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.allocation}</span>
									</div>
								</td>
								<td className="px-5 py-4">
									<span className="text-sm font-medium" style={{ color: '#9CA3AF' }}>{row.price}</span>
								</td>
								<td className="px-5 py-4 text-right">
									<button className="text-xs" style={{ color: '#9CA3AF' }}>→</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="overflow-hidden rounded-lg mt-6" style={{ borderTop: '1px solid #1A1A1A' }}>
				<div className="px-5 py-3.5 flex items-center justify-between">
					<p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>Open Orders</p>
					<button
						onClick={() => {
							// Manual refresh: allow re-fetch even if same address
							try {
								fetchedForRef.current = null
								// Trigger re-run by forcing address dependency pass-through
								// If walletData.address hasn't changed, this no-op will be picked up by effect after ref nulling
								console.log('[BreakdownTable] manual refresh requested')
								setOrdersRefreshTick((x) => x + 1)
							} catch {}
						}}
						className="text-[11px] px-2 py-1 rounded border"
						style={{ color: '#9CA3AF', borderColor: '#333333' }}
					>
						Refresh
					</button>
				</div>
				{/* Revamped list using CSS grid instead of table for robust rendering */}
				<div className="px-5 pb-4">
					<div
						className="grid items-center text-xs font-medium"
						style={{ color: '#9CA3AF', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 1fr' }}
					>
						<div className="py-2">Token</div>
						<div className="py-2">Side</div>
						<div className="py-2">Price</div>
						<div className="py-2">Size</div>
						<div className="py-2">Order ID</div>
						<div className="py-2 text-right pr-2">Action</div>
					</div>
					<div className="divide-y" style={{ borderColor: '#1A1A1A' }}>
						{(() => { console.log('[BreakdownTable][render-grid] flatOrders length:', flatOrders.length, flatOrders); return null })()}
						{flatOrders.length === 0 ? (
							<div className="py-6 text-sm" style={{ color: '#9CA3AF' }}>
								No open orders
							</div>
						) : flatOrders.map((row, idx) => {
							console.log('[BreakdownTable][render-grid] order row', idx, row)
							return (
								<div
									key={`ord-grid-${row.symbol}-${row.id}-${idx}`}
									className="grid items-center"
									style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 1fr', borderTop: '1px solid #1A1A1A' }}
								>
									<div className="py-3 pr-4">
										<div className="flex items-center gap-3">
											<div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#1A1A1A' }}>
												<span className="text-[10px] font-bold">⎔</span>
											</div>
											<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.token}</span>
											<span className="text-xs font-medium" style={{ color: '#6B7280' }}>{row.symbol}</span>
										</div>
									</div>
									<div className="py-3">
										<span className={`text-sm font-medium ${row.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{row.side}</span>
									</div>
									<div className="py-3">
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>${row.price.toFixed(4)}</span>
									</div>
									<div className="py-3">
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.size.toFixed(4)}</span>
									</div>
									<div className="py-3">
										<span className="text-sm font-medium" style={{ color: '#9CA3AF' }}>{row.id}</span>
									</div>
									<div className="py-3 text-right pr-2">
										<button
											onClick={async () => {
												try {
													setCancellingId(row.id)
													const ok = await cancelOrderForMarket(row.id, row.metric)
													if (ok) {
														fetchedForRef.current = null
														setOrdersRefreshTick((x) => x + 1)
													}
												} finally {
													setCancellingId((prev) => (prev === row.id ? null : prev))
												}
											}}
											disabled={cancellingId === row.id}
											className="text-xs p-1 rounded border text-red-400 disabled:opacity-50"
											style={{ borderColor: '#333333' }}
										>
											{cancellingId === row.id ? 'Canceling…' : 'Cancel'}
										</button>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</div>
	)
}


