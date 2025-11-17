'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Card from './Card'
import { usePortfolioData } from '@/hooks/usePortfolioData'
	import { useMarkets } from '@/hooks/useMarkets'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'

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
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
	const router = useRouter()
		const prevNonEmptyItemsRef = useRef<AllocationDatum[] | null>(null)
		const [didAnimateIn, setDidAnimateIn] = useState(false)
		const [initialHold, setInitialHold] = useState(true)
		const { walletData } = useWallet() as any

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
	const { positions, isLoading: isLoadingPositions, hasLoadedOnce: portfolioHasLoaded } = usePortfolioData({ enabled: true, refreshInterval: 15000 })
	const { markets, isLoading: isLoadingMarkets } = useMarkets({ limit: 500, autoRefresh: true, refreshInterval: 60000 })

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
		const group: Record<string, { name: string; symbol: string; value: number; net: number; absSize: number }> = {}
		for (const p of positions) {
			const keyHex = String(p.marketId || '').toLowerCase()
			const meta = marketIdMap.get(keyHex)
			const symbol = (meta?.symbol || p.symbol || keyHex.slice(2, 6)).toUpperCase()
			const name = meta?.name || symbol
			const notional = Math.abs(p.size) * (p.markPrice || p.entryPrice || 0)
			const absSize = Math.abs(isFinite(p.size) ? p.size : 0)
			if (!group[symbol]) group[symbol] = { name, symbol, value: 0, net: 0, absSize: 0 }
			group[symbol].value += isFinite(notional) ? notional : 0
			// Use signed size based on position side to determine LONG/SHORT net
			const signedSize = (isFinite(p.size) ? p.size : 0) * (p.side === 'SHORT' ? -1 : 1)
			group[symbol].net += signedSize
			group[symbol].absSize += absSize
		}
		const total = Object.values(group).reduce((a, v) => a + v.value, 0)
		// If we cannot compute notional yet (e.g., mark/entry price not ready), fallback to size-based allocation
		if (total <= 0) {
			const sizeTotal = Object.values(group).reduce((a, v) => a + v.absSize, 0)
			if (sizeTotal <= 0) return []
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
					return { name: g.name, symbol: g.symbol, percent: (g.absSize / sizeTotal) * 100, value: undefined, icon: iconUrl, direction }
				})
				.sort((a, b) => b.percent - a.percent)
		}
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

	// Consider allocation "loading" until both positions and markets are ready AND portfolio has loaded
	const isLoadingAllocation = isLoadingPositions || isLoadingMarkets || !portfolioHasLoaded
	// Apply a brief initial hold and require wallet address before dropping skeleton to avoid empty flash
	useEffect(() => {
		const id = setTimeout(() => setInitialHold(false), 800)
		return () => clearTimeout(id)
	}, [])
	const walletAddress = walletData?.address
	// Only show the large loading skeleton during the initial load
	const isInitialLoading = !portfolioHasLoaded || isLoadingAllocation || initialHold || !walletAddress

	// hasLoadedOnce is now provided by usePortfolioData hook

	// Hold on to last non-empty items to avoid flicker during polling/refreshes
	useEffect(() => {
		if (liveItems && liveItems.length > 0) {
			prevNonEmptyItemsRef.current = liveItems
		}
	}, [liveItems])

	const items = useMemo(() => {
		// During initial loading, return empty to show skeleton
		if (isInitialLoading) return []
		// Priority: explicit data prop, then freshly computed live items
		const base =
			(data && data.length ? data : (liveItems && liveItems.length ? liveItems : []))
		if (base.length > 0) return base
		// After initial load, if no positions, show empty state
		return []
	}, [data, liveItems, isInitialLoading])

	// Trigger one-time animate-in after initial load when items are present
	useEffect(() => {
		if (!isInitialLoading && items.length > 0 && !didAnimateIn) {
			setDidAnimateIn(true)
		}
	}, [isInitialLoading, items.length, didAnimateIn])
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
	// Smooth and constrain weights so the largest items are still larger,
	// but smaller items have enough area to render details.
	// - Power transform compresses differences while preserving order
	// - Uniform mix guarantees a baseline share for all
	// - Max cap avoids a single tile dominating the grid
	const smoothedWeights = useMemo(() => {
		const raw = topItems.map((i) => Math.max(i.percent, 0))
		const n = raw.length
		if (n === 0) return [] as number[]
		if (n === 1) return [1]
		// Tunables
		const EXPONENT = 0.72 // 0.5-0.85 range recommended
		const UNIFORM_MIX = 0.22 // 0-0.35; higher = more even
		const MAX_SHARE = 0.6 // prevent one tile from taking entire space
		// Step 1: power transform
		const powered = raw.map((v) => Math.pow(v, EXPONENT))
		const powSum = sum(powered) || 1
		let w = powered.map((v) => v / powSum)
		// Step 2: add a uniform baseline share
		w = w.map((v) => (1 - UNIFORM_MIX) * v + UNIFORM_MIX * (1 / n))
		// Step 3: cap extreme dominance and redistribute overflow
		function capAndRedistributeMax(values: number[], cap: number): number[] {
			let arr = values.slice()
			for (let _iter = 0; _iter < 5; _iter++) {
				let overflow = 0
				let poolSum = 0
				const capped = new Array(arr.length)
				for (let i = 0; i < arr.length; i++) {
					if (arr[i] > cap) {
						overflow += arr[i] - cap
						capped[i] = cap
					} else {
						capped[i] = arr[i]
						poolSum += arr[i]
					}
				}
				if (overflow <= 1e-9 || poolSum <= 1e-9) {
					arr = capped
					break
				}
				// Redistribute proportionally to non-capped items
				const redistributed = capped.map((v) => (v < cap ? v + (v / poolSum) * overflow : v))
				// If redistribution created new violations, loop again
				arr = redistributed
				if (arr.every((v) => v <= cap + 1e-9)) break
			}
			// Normalize for any rounding drift
			const s = sum(arr) || 1
			return arr.map((v) => v / s)
		}
		return capAndRedistributeMax(w, MAX_SHARE)
	}, [topItems])

	const rects = useMemo(() => {
		if (size.width <= 0 || size.height <= 0) return [] as Rect[]
		if (!topItems || topItems.length === 0) return [] as Rect[]
		// Compute treemap layout within full container
		// When hovering a tile, bias its weight up slightly and shrink others.
		const interactiveWeights = (() => {
			const w = smoothedWeights.slice()
			if (hoveredIndex === null || hoveredIndex < 0 || hoveredIndex >= w.length) return w
			// Size-aware boost: smaller base weights expand more than large ones.
			// Large tiles should expand only slightly.
			const MIN_BOOST = 1.04
			const MAX_BOOST = 3.2
			const LARGE_THRESHOLD = 0.22  // tiles >= 22% of area considered large
			const LARGE_SOFT_CAP = 1.08   // very small bump for large tiles
			const maxShare = 0.86
			// Ensure hovered tile meets a minimum readable area
			const requiredMinWidth = 160
			const requiredMinHeight = 120
			const containerArea = Math.max(1, size.width * size.height)
			const minHoverShare = Math.min(0.6, (requiredMinWidth * requiredMinHeight) / containerArea + 0.01)

			const total = w.reduce((a, b) => a + b, 0) || 1
			const normalized = w.map((x) => x / total)
			const wi = normalized[hoveredIndex]
			// Map smaller wi -> closer to MAX_BOOST, larger wi -> closer to MIN_BOOST
			const sizeT = Math.sqrt(Math.min(1, Math.max(0, wi)))
			const hoverFactor = MIN_BOOST + (1 - sizeT) * (MAX_BOOST - MIN_BOOST)
			let boostedCandidate = Math.min(maxShare, wi * hoverFactor)
			// Further limit expansion for already-large tiles
			if (wi >= LARGE_THRESHOLD) {
				boostedCandidate = Math.min(boostedCandidate, wi * LARGE_SOFT_CAP)
			}
			const boosted = Math.max(minHoverShare, boostedCandidate)
			const othersScale = (1 - boosted) / Math.max(1e-9, 1 - wi)
			const adjusted = normalized.map((x, i) => (i === hoveredIndex ? boosted : x * othersScale))
			return adjusted
		})()
		return layoutTreemap(
			interactiveWeights.map((weight) => ({ weight })) as any,
			{ x: 0, y: 0, width: size.width, height: size.height }
		)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [size.width, size.height, topItems, smoothedWeights, hoveredIndex])

	// Placeholder rectangles for loading state (stable weights for consistent layout)
	const loadingRects = useMemo(() => {
		if (size.width <= 0 || size.height <= 0) return [] as Rect[]
		const weights = [24, 18, 14, 12, 10, 8] // descending to mimic realistic distribution
		return layoutTreemap(
			weights.map((w) => ({ weight: w })) as any,
			{ x: 0, y: 0, width: size.width, height: size.height }
		)
	}, [size.width, size.height])

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

	// Small animated sparkline-style trend icon
	const TrendIcon: React.FC<{ direction?: 'LONG' | 'SHORT'; tiny?: boolean; hero?: boolean }> = ({ direction, tiny, hero }) => {
		if (!direction) return null
		const color = direction === 'LONG' ? '#10B981' : '#EF4444'
		// Slightly dim icon on hero tiles for contrast
		const stroke = hero ? (direction === 'LONG' ? 'rgba(8,120,87,0.9)' : 'rgba(127,29,29,0.9)') : color
		const w = tiny ? 14 : 18
		const h = tiny ? 9 : 11
		const vbW = 16
		const vbH = 12
		const up = '1,11 5,8 8,9.5 11,6 15,4'       // rising line
		const down = '1,4 5,7 8,5.5 11,9 15,11'   // falling line
		return (
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${vbW} ${vbH}`}
				aria-hidden="true"
				style={{ display: 'block', flexShrink: 0 }}
			>
				<polyline
					points={direction === 'LONG' ? up : down}
					fill="none"
					stroke={stroke}
					strokeWidth={1.8}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray={40}
					strokeDashoffset={40}
				>
					<animate attributeName="stroke-dashoffset" values="40;0" dur="1.6s" repeatCount="indefinite" />
				</polyline>
			</svg>
		)
	}

	return (
		// Remove Card title to avoid double headers and start content higher
		<Card className="h-full flex flex-col" contentClassName="flex-1 flex flex-col">
			<style jsx global>{`
				@keyframes allocCardIn {
					0% {
						opacity: 0;
						transform: translateY(8px) scale(0.985);
					}
					100% {
						opacity: 1;
						transform: translateY(0) scale(1);
					}
				}
				.alloc-card-in {
					opacity: 0;
					animation: allocCardIn 360ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
					will-change: transform, opacity;
				}
			`}</style>
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
				{isInitialLoading ? (
					<div className="absolute inset-0">
						{loadingRects.length === 0 ? (
							<div className="w-full h-full flex items-center justify-center text-sm" style={{ color: '#9CA3AF' }}>
								Loading positions…
							</div>
						) : loadingRects.map((r, idx) => {
							const left = r.x + gap / 2
							const top = r.y + gap / 2
							const w = Math.max(0, r.width - gap)
							const h = Math.max(0, r.height - gap)
							return (
								<div
									key={`loading-${idx}`}
									className="absolute rounded-2xl overflow-hidden animate-pulse"
									style={{
										left,
										top,
										width: w,
										height: h,
										background: '#1A1A1A',
										border: '1px solid #222222',
									}}
									aria-hidden="true"
								/>
							)
						})}
					</div>
				) : items.length === 0 ? (
					<div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: '#9CA3AF' }}>
						{(positions?.length || 0) === 0 ? 'No open positions' : 'Loading positions…'}
					</div>
				) : rects.map((r, idx) => {
					const item = topItems[idx]
					// Inset by half the gap to create gutters
					const left = r.x + gap / 2
					const top = r.y + gap / 2
					const w = Math.max(0, r.width - gap)
					const h = Math.max(0, r.height - gap)
					// Minimal sizing thresholds for content
					const tiny = w < 150 || h < 110
					const micro = w < 100 || h < 85
					const isHovered = hoveredIndex === idx
					// On hover, always show full dataset regardless of size
					const tinyView = isHovered ? false : tiny
					const microView = isHovered ? false : micro
					// Only the top two allocations should use the cyan hero background
					const isHero = idx < 2
					const palette = colorMap[item.symbol] || { tint: 'linear-gradient(180deg, rgba(255,255,255,0.00), rgba(255,255,255,0.00))' }
					const baseBg = isHero ? '#00E6FF' : '#1A1A1A'
					const bgStyle = isHero ? baseBg : `${palette.tint}, ${baseBg}`
					return (
						<div
							key={item.symbol}
							className={`absolute rounded-2xl overflow-hidden flex flex-col transition-all duration-200 border hover:border-[#333333] cursor-pointer ${didAnimateIn ? 'alloc-card-in' : ''}`}
							style={{
								left,
								top,
								width: w,
								height: h,
								background: bgStyle as any,
								border: '1px solid #222222',
								color: '#E5E7EB',
								zIndex: hoveredIndex === idx ? 2 : 1,
								animationDelay: didAnimateIn ? `${idx * 70}ms` : undefined,
							}}
							onMouseEnter={() => setHoveredIndex(idx)}
							onMouseLeave={() => setHoveredIndex((prev) => (prev === idx ? null : prev))}
							onClick={() => {
								const sym = String(item.symbol || '').toUpperCase()
								if (sym) router.push(`/token/${encodeURIComponent(sym)}`)
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									const sym = String(item.symbol || '').toUpperCase()
									if (sym) router.push(`/token/${encodeURIComponent(sym)}`)
								}
							}}
							role="button"
							aria-label={`Open ${item.name} market`}
						>
							<div className={tinyView ? 'flex items-start justify-between p-3' : 'flex items-start justify-between p-4'}>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2.5">
										<div
											className={tinyView ? 'w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0' : 'w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0'}
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
										{!microView ? (
											<div className="min-w-0">
												<p
													className={tinyView ? 'text-xs font-bold leading-snug line-clamp-2' : (isHovered ? 'text-sm font-bold leading-tight line-clamp-2' : 'text-sm font-bold leading-tight truncate')}
													style={{ color: isHero ? '#0A0A0A' : '#E5E7EB' }}
													title={item.name}
												>
													{item.name}
												</p>
												<p
													className={tinyView ? 'text-[10px] font-semibold mt-0.5 leading-snug line-clamp-2' : 'text-[11px] font-semibold mt-0.5 truncate'}
													style={{ color: isHero ? 'rgba(10,10,10,0.60)' : '#9CA3AF' }}
													title={item.symbol}
												>
													{item.symbol}
												</p>
											</div>
										) : null}
									</div>
								</div>
								<div className="flex items-center gap-1.5">
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
							<div className={tinyView ? 'mt-auto px-3 pb-3' : 'mt-auto px-4 pb-4'}>
								{microView ? (
									<div className="flex items-center justify-end">
										<TrendIcon direction={(item as any).direction} tiny={true} hero={isHero} />
									</div>
								) : (
									<div className="flex items-start justify-between">
										<div className="min-w-0">
											<div className="flex items-center gap-1.5">
												<p className={tinyView ? 'text-xs font-semibold' : 'text-sm font-bold'} style={{ color: isHero ? '#0A0A0A' : '#E5E7EB' }}>
													{item.percent.toFixed(2)}%
												</p>
												<TrendIcon direction={(item as any).direction} tiny={tinyView} hero={isHero} />
											</div>
											{typeof (item as any).value === 'number' ? (
												<p className={tinyView ? 'text-[10px] font-medium mt-0.5' : 'text-xs font-medium mt-0.5'} style={{ color: isHero ? 'rgba(10,10,10,0.60)' : '#9CA3AF' }}>
													{formatUsd((item as any).value as number)}
												</p>
											) : null}
										</div>
									</div>
								)}
							</div>
						</div>
					)
				})}
			</div>
		</Card>
	)
}

