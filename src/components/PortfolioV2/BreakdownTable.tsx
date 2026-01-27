'use client'

import Card from './Card'
import { useMemo } from 'react'
import { usePortfolioData } from '@/hooks/usePortfolioData'
import { useMarkets } from '@/hooks/useMarkets'
import { useWallet } from '@/hooks/useWallet'
import { cancelOrderForMarket } from '@/hooks/useOrderBook'
import React, { useEffect, useRef, useState } from 'react'
import ClosedPositionModal from './ClosedPositionModal'
import { normalizeBytes32Hex } from '@/lib/hex'

type Row = {
	token: string
	symbol: string
	amount: string
	value: string
	allocation: string
	price: string
	marginLocked?: string
	marginUsed?: string
	primary?: boolean
	positionId: string
	amountNum: number
	marketIdentifier: string
}


function formatUsd(n: number): string {
	if (!Number.isFinite(n)) return '$0.00'
	return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

function formatNum(n: number, decimals = 4): string {
	if (!Number.isFinite(n)) return '0'
	return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: Math.min(2, decimals) })
}

const logGoddBreakdown = (step: number, message: string, data?: any) => {
	console.log(`[GODD][STEP${step}] ${message}`, data ?? '')
}

export default function BreakdownTable() {
	const { positions, ordersBuckets, isLoading: isLoadingPortfolio, hasLoadedOnce: portfolioHasLoaded, refreshOrders } = usePortfolioData({ enabled: true, refreshInterval: 15000 })
	const { markets, isLoading: marketsLoading } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 })
	const { walletData } = useWallet() as any
	const walletAddress = walletData?.address
	const [cancellingId, setCancellingId] = useState<string | null>(null)
	const [closeModal, setCloseModal] = useState<{ open: boolean; positionId: string | null; symbol: string; maxSize: number }>({
		open: false,
		positionId: null,
		symbol: '',
		maxSize: 0
	})
	const prevNonEmptyRowsRef = useRef<Row[] | null>(null)
	const [initialHold, setInitialHold] = useState(true)
	useEffect(() => {
		const id = setTimeout(() => setInitialHold(false), 800)
		return () => clearTimeout(id)
	}, [])
	// Keep loading until portfolio data has loaded AND markets have loaded AND initial hold is done
	const isInitialLoading = !portfolioHasLoaded || marketsLoading || initialHold || !walletAddress || isLoadingPortfolio
		const [didAnimatePositionsIn, setDidAnimatePositionsIn] = useState(false)
		const [didAnimateOrdersIn, setDidAnimateOrdersIn] = useState(false)

	const marketIdMap = useMemo(() => {
		const map = new Map<string, { symbol: string; name: string }>()
		for (const m of markets || []) {
			if (m?.market_id_bytes32) {
				const key = normalizeBytes32Hex(String(m.market_id_bytes32))
				if (!key) continue
				map.set(key, {
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
			const keyHex = normalizeBytes32Hex(String(p.marketId || ''))
			const meta = marketIdMap.get(keyHex)
			const symbol = (meta?.symbol || p.symbol || keyHex.slice(2, 6)).toUpperCase()
			const token = meta?.name || symbol
			const amount = Math.abs(p.size)
			const mark = p.markPrice || p.entryPrice || 0
			const value = amount * mark
			const allocation = totalNotional > 0 ? (value / totalNotional) * 100 : 0
			const marginLocked = Number.isFinite(p.margin) ? p.margin : 0
			const marginUsed = marginLocked // For positions, used == locked in current model
			return {
				token,
				symbol,
				amount: formatNum(amount, 4),
				value: formatUsd(value),
				allocation: `${formatNum(allocation, 2)}%`,
				price: formatUsd(mark),
				marginLocked: formatUsd(marginLocked),
				marginUsed: formatUsd(marginUsed),
				primary: false,
				positionId: String(p.marketId || ''),
				amountNum: amount,
				marketIdentifier: symbol
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

	// hasLoadedOnce is now provided by usePortfolioData hook

	// Remember last non-empty set of rows to avoid thrash on intermediate refreshes
	useEffect(() => {
		if (computedRows && computedRows.length > 0) {
			prevNonEmptyRowsRef.current = computedRows
		}
	}, [computedRows])

	const rowsToRender: Row[] = useMemo(() => {
		// During initial loading, return empty to show skeleton
		if (isInitialLoading) return []
		// Once loaded, show computed rows (empty array if no positions)
		// Use previous non-empty rows during updates to prevent flicker
		if (computedRows.length > 0) {
			return computedRows
		}
		// After initial load, if no positions but we had some before, keep showing previous
		if (prevNonEmptyRowsRef.current && prevNonEmptyRowsRef.current.length > 0) {
			return prevNonEmptyRowsRef.current
		}
		// After initial load, if no positions, show empty state
		return []
	}, [computedRows, isInitialLoading])

	// Trigger one-time animate-in for positions table rows
	useEffect(() => {
		if (!isInitialLoading && rowsToRender.length > 0 && !didAnimatePositionsIn) {
			setDidAnimatePositionsIn(true)
		}
	}, [isInitialLoading, rowsToRender.length, didAnimatePositionsIn])

	// Trigger one-time animate-in for orders grid rows

	// Simple button that opens the unified close position modal
	function PositionCloseButton({ positionId, size, symbol }: { positionId: string; size: number; symbol: string }) {
		return (
			<button
				onClick={() => {
					setCloseModal({
						open: true,
						positionId,
						symbol,
						maxSize: size
					})
				}}
				disabled={size <= 0}
				className="text-xs p-1 rounded border text-red-400 disabled:opacity-50"
				style={{ borderColor: '#333333' }}
			>
				Close
			</button>
		)
	}

	// Orders are now provided by usePortfolioData hook
	// ordersRefreshTick is still used to trigger manual refresh via the button

	// Remember last non-empty orders to prevent flicker during polling
	const prevNonEmptyOrdersRef = useRef<Array<{ token: string; symbol: string; id: string; metric: string; side: 'BUY' | 'SELL'; price: number; size: number; margin?: number }>>([])
	
	useEffect(() => {
		if (ordersBuckets && ordersBuckets.length > 0) {
			const totalOrders = ordersBuckets.reduce((sum, b) => sum + (b?.orders?.length || 0), 0)
			if (totalOrders > 0) {
				logGoddBreakdown(24, 'BreakdownTable processed new ordersBuckets snapshot', { bucketCount: ordersBuckets.length, totalOrders })
				// Only update if we have actual orders
				const flat: Array<{ token: string; symbol: string; id: string; metric: string; side: 'BUY' | 'SELL'; price: number; size: number; margin?: number }> = []
				ordersBuckets.forEach((bucket) => {
					const symbol = (bucket.symbol || 'UNKNOWN').toString().toUpperCase()
					const token = bucket.token || symbol
					;(bucket.orders || []).forEach((o: any) => {
						const side = (o?.side || (o?.isBuy ? 'BUY' : 'SELL')).toString().toUpperCase() as 'BUY' | 'SELL'
						let qty = Number(o?.quantity || 0)
						if (qty >= 1_000_000_000) qty = qty / 1_000_000_000_000
						const priceNum = Number(o?.price || o?.limitPrice || 0)
						const idStr = String(o?.id || o?.orderId || `${symbol}-${side}-${priceNum}`)
						const metric = String(o?.metricId || symbol)
						const margin = Number(o?.marginRequired ?? o?.marginReserved ?? 0)
						flat.push({ token, symbol, id: idStr, metric, side, price: priceNum, size: qty, margin })
					})
				})
				prevNonEmptyOrdersRef.current = flat
			}
		}
	}, [ordersBuckets])

	// Flatten bucketed orders for rendering with cancel actions
	const flatOrders = useMemo(() => {
		// During initial loading, return empty
		if (isInitialLoading) return []
		
		const rows: Array<{ token: string; symbol: string; id: string; metric: string; side: 'BUY' | 'SELL'; price: number; size: number; margin?: number }> = []
		ordersBuckets.forEach((bucket) => {
			const symbol = (bucket.symbol || 'UNKNOWN').toString().toUpperCase()
			const token = bucket.token || symbol
			;(bucket.orders || []).forEach((o: any) => {
				const side = (o?.side || (o?.isBuy ? 'BUY' : 'SELL')).toString().toUpperCase() as 'BUY' | 'SELL'
				let qty = Number(o?.quantity || 0)
				if (qty >= 1_000_000_000) qty = qty / 1_000_000_000_000
				const priceNum = Number(o?.price || 0)
				const idStr = String(o?.id || '')
				const metric = String(o?.metricId || symbol)
				const margin = Number(o?.marginRequired ?? o?.marginReserved ?? 0)
				rows.push({ token, symbol, id: idStr, metric, side, price: priceNum, size: qty, margin })
			})
		})
		logGoddBreakdown(25, 'BreakdownTable flattened orders for render', { rowCount: rows.length, isInitialLoading })
		// If we have orders, return them
		if (rows.length > 0) return rows
		
		// If no orders but we had some before (during polling refresh), keep showing previous
		if (prevNonEmptyOrdersRef.current.length > 0 && !isInitialLoading) {
			return prevNonEmptyOrdersRef.current
		}
		
		// Otherwise return empty
		return []
	}, [ordersBuckets, isInitialLoading])
	// Trigger one-time animate-in for orders grid rows
	useEffect(() => {
		if ((flatOrders.length > 0) && !didAnimateOrdersIn) {
			setDidAnimateOrdersIn(true)
		}
	}, [flatOrders.length, didAnimateOrdersIn])
	return (
		<div
			className="bg-[#1A1A1A] rounded-md border border-[#222222]"
			style={{
				// Provide extra room so the right-pane scroll can move past footer overlays
				paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 240px)',
			}}
		>
			<style jsx global>{`
				@keyframes matSlideRtl {
					0% {
						opacity: 0;
						transform: translateX(12px);
					}
					100% {
						opacity: 1;
						transform: translateX(0);
					}
				}
				.mat-slide-rtl {
					opacity: 0;
					transform: translateX(12px);
					animation: matSlideRtl 300ms ease-out forwards;
					will-change: transform, opacity;
				}
			`}</style>
			<div className="flex items-center justify-between p-4 border-b border-[#1A1A1A]">
				<div className="flex items-center gap-2">
					<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#10B981]" />
					<div className="flex flex-col">
						<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>Breakdown</span>
						<span className="text-xs" style={{ color: '#9CA3AF' }}>Open positions and orders</span>
					</div>
				</div>
				<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
					{positions.length} positions · {ordersBuckets.length} markets
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
							<th className="px-5 py-3.5 font-medium">Margin Used</th>
							<th className="px-5 py-3.5"></th>
						</tr>
					</thead>
					<tbody>
						{isInitialLoading ? (
							[...Array(5)].map((_, i) => (
								<tr key={`skeleton-${i}`} className="border-t" style={{ borderColor: '#1A1A1A' }}>
									<td className="px-5 py-4" colSpan={7}>
										<div className="w-full flex items-center gap-4 animate-pulse">
											<div className="w-6 h-6 rounded-full bg-[#1F1F1F]" />
											<div className="flex-1 h-3 rounded bg-[#1F1F1F]" />
										</div>
									</td>
								</tr>
							))
						) : rowsToRender.length === 0 ? (
							<tr className="border-t" style={{ borderColor: '#1A1A1A' }}>
								<td className="px-5 py-6 text-sm" colSpan={7} style={{ color: '#9CA3AF' }}>
									No open positions
								</td>
							</tr>
						) : rowsToRender.map((row, idx) => (
							<tr
								key={`${row.positionId}-${idx}`}
								className={`border-t ${didAnimatePositionsIn ? 'mat-slide-rtl' : ''}`}
								style={{ borderColor: '#1A1A1A', animationDelay: didAnimatePositionsIn ? `${idx * 50}ms` : undefined }}
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
								<td className="px-5 py-4">
									<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.marginUsed}</span>
								</td>
								<td className="px-5 py-4 text-right">
									<PositionCloseButton positionId={row.positionId} size={row.amountNum} symbol={row.marketIdentifier} />
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
							// Manual refresh: trigger refresh function
							try {
								console.log('[ALTKN][BreakdownTable] manual refresh requested')
								refreshOrders()
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
						style={{ color: '#9CA3AF', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}
					>
						<div className="py-2">Token</div>
						<div className="py-2">Side</div>
						<div className="py-2">Price</div>
						<div className="py-2">Size</div>
						<div className="py-2">Margin Locked</div>
						<div className="py-2 text-right pr-2">Action</div>
					</div>
					<div className="divide-y" style={{ borderColor: '#1A1A1A' }}>
						{(() => { console.log('[ALTKN][BreakdownTable][render-grid] flatOrders length:', flatOrders.length, flatOrders); return null })()}
						{isInitialLoading ? (
							<div className="py-6 text-sm animate-pulse" style={{ color: '#9CA3AF' }}>
								Loading orders...
							</div>
						) : flatOrders.length === 0 ? (
							<div className="py-6 text-sm" style={{ color: '#9CA3AF' }}>
								No open orders
							</div>
						) : flatOrders.map((row, idx) => {
							console.log('[ALTKN][BreakdownTable][render-grid] order row', idx, row)
							return (
								<div
									key={`ord-grid-${row.symbol}-${row.id}-${idx}`}
									className={`grid items-center ${didAnimateOrdersIn ? 'mat-slide-rtl' : ''}`}
									style={{
										gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
										borderTop: '1px solid #1A1A1A',
										animationDelay: didAnimateOrdersIn ? `${idx * 50}ms` : undefined
									}}
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
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>${row.price.toFixed(2)}</span>
									</div>
									<div className="py-3">
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{row.size.toFixed(2)}</span>
									</div>
									<div className="py-3">
										<span className="text-sm font-medium" style={{ color: '#E5E7EB' }}>{formatUsd(row.margin || 0)}</span>
									</div>
									<div className="py-3 text-right pr-2">
										<button
											onClick={async () => {
												try {
													setCancellingId(row.id)
													const ok = await cancelOrderForMarket(row.id, row.metric)
													if (ok) {
														// Refresh orders after successful cancellation
														refreshOrders()
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
			<ClosedPositionModal
				isOpen={closeModal.open}
				onClose={() => setCloseModal({ open: false, positionId: null, symbol: '', maxSize: 0 })}
				positionId={closeModal.positionId}
				symbol={closeModal.symbol}
				maxSize={closeModal.maxSize}
				defaultSize={closeModal.maxSize}
			/>
		</div>
	)
}


