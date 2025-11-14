'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Card from './Card'
import { usePositions } from '@/hooks/usePositions'
import { useMarkets } from '@/hooks/useMarkets'

type AllocationDatum = {
	name: string
	symbol: string
	percent: number
	value?: number
	icon?: string
	direction?: 'LONG' | 'SHORT' | 'FLAT'
	warning?: boolean
	color?: string
}

type Rect = { x: number; y: number; width: number; height: number }

// Example data; in production, pass via props
const sampleData: AllocationDatum[] = [
	{ name: 'Bitcoin', symbol: 'BTC', percent: 19.62 },
	{ name: 'Cardano', symbol: 'ADA', percent: 16.1 },
	{ name: 'Algorand', symbol: 'ALGO', percent: 11.66 },
	{ name: 'Polkadot', symbol: 'DOT', percent: 11.24 },
	{ name: 'Ethereum', symbol: 'ETH', percent: 12.28 },
	{ name: 'Power Ledger', symbol: 'POWR', percent: 10.97, warning: true },
	{ name: 'SolarCoin', symbol: 'SLR', percent: 9.61, warning: true },
	{ name: 'Chainlink', symbol: 'LINK', percent: 8.52 },
]

function sum(values: number[]) {
	return values.reduce((a, b) => a + b, 0)
}

/**
 * Balanced binary treemap: recursively splits along longest side using
 * a near-even cumulative sum breakpoint. Produces stable, readable rectangles.
 */
function layoutTreemap<T extends { weight: number }>(
	items: T[],
	container: Rect
): Rect[] {
	// Guard: no items -> no rects
	if (!items || items.length === 0) return []
	const total = sum(items.map((i) => i.weight)) || 1

	function split(list: T[], rect: Rect): Rect[] {
		// Guard: empty list
		if (!list || list.length === 0) return []
		if (list.length === 1) {
			return [rect]
		}
		// Find split index to balance cumulative weights
		const target = (sum(list.map((i) => i.weight)) || 1) / 2
		let acc = 0
		let idx = 0
		for (let i = 0; i < list.length; i++) {
			acc += list[i].weight
			if (acc >= target) {
				idx = i + 1
				break
			}
		}
		if (idx <= 0 || idx >= list.length) idx = Math.ceil(list.length / 2)
		const left = list.slice(0, idx)
		const right = list.slice(idx)
		const leftSum = sum(left.map((i) => i.weight))
		const rightSum = sum(right.map((i) => i.weight))
		if (rect.width >= rect.height) {
			// Vertical split
			const leftWidth = (rect.width * leftSum) / (leftSum + rightSum || 1)
			const leftRect = { x: rect.x, y: rect.y, width: leftWidth, height: rect.height }
			const rightRect = {
				x: rect.x + leftWidth,
				y: rect.y,
				width: rect.width - leftWidth,
				height: rect.height,
			}
			return [...split(left, leftRect), ...split(right, rightRect)]
		} else {
			// Horizontal split
			const topHeight = (rect.height * leftSum) / (leftSum + rightSum || 1)
			const topRect = { x: rect.x, y: rect.y, width: rect.width, height: topHeight }
			const bottomRect = {
				x: rect.x,
				y: rect.y + topHeight,
				width: rect.width,
				height: rect.height - topHeight,
			}
			return [...split(left, topRect), ...split(right, bottomRect)]
		}
	}

	// Normalize weights to container area
	const area = container.width * container.height
	const norm = items.map((i) => ({ ...i, weight: Math.max(i.weight, 0) }))
	const totalWeight = sum(norm.map((i) => i.weight)) || 1
	const scaled = norm.map((i) => ({ ...i, weight: (i.weight / totalWeight) * area }))
	return split(scaled as any, container)
}

interface AllocationGridProps {
	data?: AllocationDatum[]
	gap?: number
}

export default function AllocationGrid({ data, gap = 12 }: AllocationGridProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

	const formatUsd = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

	useEffect(() => {
		if (!containerRef.current) return
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect
			if (cr) setSize({ width: cr.width, height: cr.height })
		})
		ro.observe(containerRef.current)
		return () => ro.disconnect()
	}, [])

	// Live data: compute allocation per market from open positions
	const { positions, isLoading: isLoadingPositions, error: positionsError } = usePositions(undefined, { enabled: true })
	const { markets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 })

	const marketIdMap = useMemo(() => {
		const map = new Map<string, { symbol: string; name: string; icon?: string }>()
		for (const m of markets || []) {
			if (m?.market_id_bytes32) {
				map.set(String(m.market_id_bytes32).toLowerCase(), {
					symbol: (m.symbol || '').toUpperCase(),
					name: m.name || m.symbol || '',
					icon: (m as any)?.icon_image_url || (m as any)?.icon || undefined,
				})
			}
		}
		return map
	}, [markets])

	const liveItems: AllocationDatum[] = useMemo(() => {
		if (!positions || positions.length === 0) return []
		const group: Record<string, { name: string; symbol: string; value: number; net: number }> = {}
		for (const p of positions) {
			const keyHex = String(p.marketId || '').toLowerCase()
			const meta = marketIdMap.get(keyHex)
			const symbol = (meta?.symbol || p.symbol || keyHex.slice(2, 6)).toUpperCase()
			const name = meta?.name || symbol
			const notional = Math.abs(p.size) * (p.markPrice || p.entryPrice || 0)
			if (!group[symbol]) group[symbol] = { name, symbol, value: 0, net: 0 }
			group[symbol].value += isFinite(notional) ? notional : 0
			// Use signed size based on position side to determine LONG/SHORT net
			const signedSize = (isFinite(p.size) ? p.size : 0) * (p.side === 'SHORT' ? -1 : 1)
			group[symbol].net += signedSize
		}
		const total = Object.values(group).reduce((a, v) => a + v.value, 0)
		if (total <= 0) return []
		return Object.values(group)
			.map(g => {
				let iconUrl: string | undefined
				try {
					for (const [, meta] of marketIdMap) {
						if ((meta.symbol || '').toUpperCase() === g.symbol.toUpperCase()) {
							iconUrl = meta.icon
							break
						}
					}
				} catch {}
				const direction: 'LONG' | 'SHORT' | 'FLAT' = g.net > 0 ? 'LONG' : g.net < 0 ? 'SHORT' : 'FLAT'
				return { name: g.name, symbol: g.symbol, percent: (g.value / total) * 100, value: g.value, icon: iconUrl, direction }
			})
			.sort((a, b) => b.percent - a.percent)
	}, [positions, marketIdMap])

	const items = useMemo(() => {
		if (data && data.length) return data
		if (liveItems && liveItems.length) return liveItems
		// If positions are loading, avoid flashing empty state
		if (isLoadingPositions) return []
		// No live positions -> show empty grid rather than sample data
		return []
	}, [data, liveItems, isLoadingPositions])
	// Show only the top 8 by percent; stable sort desc
	const topItems = useMemo(
		() =>
			items
				.slice()
				.sort((a, b) => b.percent - a.percent)
				.slice(0, 8),
		[items]
	)
	const weights = useMemo(
		() => topItems.map((i) => Math.max(i.percent, 0)),
		[topItems]
	)
	const total = sum(weights) || 1

	const rects = useMemo(() => {
		if (size.width <= 0 || size.height <= 0) return [] as Rect[]
		if (!topItems || topItems.length === 0) return [] as Rect[]
		// Compute treemap layout within full container
		return layoutTreemap(
			topItems.map((i) => ({ weight: Math.max(i.percent, 0) })) as any,
			{ x: 0, y: 0, width: size.width, height: size.height }
		)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [size.width, size.height, topItems])

	// Simple color tints per token for subtle differentiation (keeps text legible)
	const colorMap: Record<string, { tint: string; hero?: boolean }> = {
		BTC: { tint: 'linear-gradient(180deg, rgba(16,185,129,0.00), rgba(16,185,129,0.00))', hero: true },
		ETH: { tint: 'linear-gradient(180deg, rgba(16,185,129,0.00), rgba(16,185,129,0.00))', hero: true },
		ADA: { tint: 'linear-gradient(180deg, rgba(59,130,246,0.10), rgba(59,130,246,0.00))' },
		ALGO: { tint: 'linear-gradient(180deg, rgba(156,163,175,0.10), rgba(156,163,175,0.00))' },
		DOT: { tint: 'linear-gradient(180deg, rgba(236,72,153,0.10), rgba(236,72,153,0.00))' },
		POWR: { tint: 'linear-gradient(180deg, rgba(239,68,68,0.12), rgba(239,68,68,0.00))' },
		SLR: { tint: 'linear-gradient(180deg, rgba(244,63,94,0.12), rgba(244,63,94,0.00))' },
		LINK: { tint: 'linear-gradient(180deg, rgba(99,102,241,0.12), rgba(99,102,241,0.00))' },
	}

	return (
		// Remove Card title to avoid double headers and start content higher
		<Card className="h-full flex flex-col" contentClassName="flex-1 flex flex-col">
			<p className="text-sm font-medium mb-3" style={{ color: '#9CA3AF' }}>
				Allocation
			</p>
			<div
				ref={containerRef}
				className="relative rounded-2xl flex-1"
				style={{
					width: '100%',
					height: '100%',
					background: 'transparent',
				}}
			>
				{items.length === 0 ? (
					<div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: '#9CA3AF' }}>
						No open positions
					</div>
				) : rects.map((r, idx) => {
					const item = topItems[idx]
					// Inset by half the gap to create gutters
					const left = r.x + gap / 2
					const top = r.y + gap / 2
					const w = Math.max(0, r.width - gap)
					const h = Math.max(0, r.height - gap)
					// Minimal sizing thresholds for content
					const tiny = w < 110 || h < 80
					// Only the top two allocations should use the cyan hero background
					const isHero = idx < 2
					const palette = colorMap[item.symbol] || { tint: 'linear-gradient(180deg, rgba(255,255,255,0.00), rgba(255,255,255,0.00))' }
					const baseBg = isHero ? '#00E6FF' : '#1A1A1A'
					const bgStyle = isHero ? baseBg : `${palette.tint}, ${baseBg}`
					return (
						<div
							key={`${item.name}-${idx}`}
							className="absolute rounded-2xl overflow-hidden flex flex-col transition-all duration-200 border hover:border-[#333333]"
							style={{
								left,
								top,
								width: w,
								height: h,
								background: bgStyle as any,
								border: '1px solid #222222',
								color: '#E5E7EB',
							}}
						>
							<div className={tiny ? 'flex items-start justify-between p-3' : 'flex items-start justify-between p-4'}>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2.5">
										<div
											className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
											style={{ background: '#0F0F0F', color: '#FFFFFF' }}
										>
											{(item as any).icon ? (
												<img
													src={(item as any).icon as string}
													alt={`${item.symbol} icon`}
													style={{ width: '100%', height: '100%', objectFit: 'cover' }}
													loading="lazy"
												/>
											) : (
												<span className="text-[10px] font-bold">
													{(item.symbol || '•').charAt(0)}
												</span>
											)}
										</div>
										<div className="min-w-0">
											<p
												className="text-sm font-bold leading-tight truncate"
												style={{ color: isHero ? '#0A0A0A' : '#E5E7EB' }}
												title={item.name}
											>
												{item.name}
											</p>
											<p
												className="text-[11px] font-semibold mt-0.5 truncate"
												style={{ color: isHero ? 'rgba(10,10,10,0.60)' : '#9CA3AF' }}
												title={item.symbol}
											>
												{item.symbol}
											</p>
										</div>
									</div>
								</div>
								<div className="flex items-center gap-1.5">
									{(item as any).direction === 'LONG' ? (
										<div
											className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
											style={{ background: 'rgba(16,185,129,0.15)' }}
										>
											<span className="text-[10px] font-bold" style={{ color: '#10B981' }}>▲</span>
										</div>
									) : (item as any).direction === 'SHORT' ? (
										<div
											className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
											style={{ background: 'rgba(239,68,68,0.15)' }}
										>
											<span className="text-[10px] font-bold" style={{ color: '#EF4444' }}>▼</span>
										</div>
									) : null}
									{item.warning ? (
										<div
											className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
											style={{ background: 'rgba(239,68,68,0.15)' }}
										>
											<span className="text-[10px] font-bold" style={{ color: '#EF4444' }}>
												⚠
											</span>
										</div>
									) : null}
								</div>
							</div>
							<div className={tiny ? 'mt-auto px-3 pb-3' : 'mt-auto px-4 pb-4'}>
								<p className={tiny ? 'text-xs font-semibold' : 'text-sm font-bold'} style={{ color: isHero ? '#0A0A0A' : '#E5E7EB' }}>
									{item.percent.toFixed(2)}%
								</p>
								{typeof (item as any).value === 'number' ? (
									<p className={tiny ? 'text-[10px] font-medium mt-0.5' : 'text-xs font-medium mt-0.5'} style={{ color: isHero ? 'rgba(10,10,10,0.60)' : '#9CA3AF' }}>
										{formatUsd((item as any).value as number)}
									</p>
								) : null}
							</div>
						</div>
					)
				})}
			</div>
		</Card>
	)
}

