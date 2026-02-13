'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioSummary } from '@/hooks/usePortfolioSummary'
import { usePositions } from '@/hooks/usePositions'
import { useMarkets } from '@/hooks/useMarkets'
import { normalizeBytes32Hex } from '@/lib/hex'
import { usePortfolioSidebarOpenOrders } from '@/hooks/usePortfolioSidebarOpenOrders'

type PortfolioSidebarProps = {
	isOpen: boolean
	onClose: () => void
}

type Metric = { label: string; value: string; valueClassName?: string; valueTone?: 'default' | 'pos' | 'neg' }

function formatUsd(n: number, digits = 2) {
	const v = Number(n)
	if (!Number.isFinite(v)) return '$0.00'
	return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatPct(n: number, digits = 1) {
	const v = Number(n)
	if (!Number.isFinite(v)) return `0.${'0'.repeat(digits)}%`
	const sign = v > 0 ? '+' : ''
	return `${sign}${v.toFixed(digits)}%`
}

function clamp(n: number, min: number, max: number) {
	return Math.min(max, Math.max(min, n))
}

const DEXETERA_PLACEHOLDER_ICON_SRC = '/Dexicon/LOGO-Dexetera-05.svg'

export default function PortfolioSidebar({ isOpen, onClose }: PortfolioSidebarProps) {
	const router = useRouter()
	const { walletData } = useWallet() as any
	const walletAddress: string | null = walletData?.address || null
	const isWalletConnected = Boolean(walletData?.isConnected && walletAddress)
	const profileImageUrl: string | null = walletData?.userProfile?.profile_image_url || null
	const profileLabel: string = String(
		walletData?.userProfile?.display_name ||
		walletData?.userProfile?.username ||
		(walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Guest')
	)
	const profileInitial = (profileLabel.trim().slice(0, 1) || 'D').toUpperCase()

	// Mount/unmount for exit animation
	const [rendered, setRendered] = useState(false)
	const [entered, setEntered] = useState(false)
	const [walletCopied, setWalletCopied] = useState(false)
	const raf1Ref = useRef<number | null>(null)
	const raf2Ref = useRef<number | null>(null)

	// Only enable data hooks while the drawer is rendered.
	// This prevents background polling/refreshes when closed and stabilizes the UI while open.
	const dataEnabled = Boolean(isWalletConnected && rendered)

	const coreVault = useCoreVault()
	const portfolio = usePortfolioSummary(walletAddress, {
		enabled: dataEnabled,
		// Sidebar should not poll; keep it stable and refresh on re-open.
		refreshIntervalMs: 0,
	})
	const positionsState = usePositions(undefined, {
		enabled: dataEnabled,
		pollIntervalMs: 0,
		listenToEvents: false,
	})

	// Market metadata (for icons). No auto-refresh: sidebar should be stable while open.
	const { markets } = useMarkets({ limit: 500, autoRefresh: false, refreshInterval: 0 })

	const iconUrlByMarketId = useMemo(() => {
		const m = new Map<string, string>()
		for (const mk of markets || []) {
			const key = normalizeBytes32Hex(String((mk as any)?.market_id_bytes32 || ''))
			const icon = String((mk as any)?.icon_image_url || '').trim()
			if (key && icon) m.set(key, icon)
		}
		return m
	}, [markets])

	const marketIdentifierBySymbol = useMemo(() => {
		const m = new Map<string, string>()
		for (const mk of markets || []) {
			const sym = String((mk as any)?.symbol || '').toUpperCase().trim()
			const ident = String((mk as any)?.market_identifier || '').trim()
			if (sym && ident) m.set(sym, ident)
		}
		return m
	}, [markets])

	const iconUrlBySymbol = useMemo(() => {
		const m = new Map<string, string>()
		for (const mk of markets || []) {
			const sym = String((mk as any)?.symbol || '').toUpperCase().trim()
			const icon = String((mk as any)?.icon_image_url || '').trim()
			if (sym && icon) m.set(sym, icon)
		}
		return m
	}, [markets])

	// Local-first open orders (session/local storage) + secondary on-chain backfill.
	const sidebarOrders = usePortfolioSidebarOpenOrders({
		enabled: dataEnabled,
		walletAddress,
		positionSymbols: (positionsState?.positions || []).map((p: any) => String(p?.symbol || '').toUpperCase()).filter(Boolean),
	})

	const navigateToToken = (identifierOrSymbol: string) => {
		const id = String(identifierOrSymbol || '').trim()
		if (!id) return
		try {
			router.push(`/token/${encodeURIComponent(id)}`)
		} finally {
			onClose()
		}
	}

	const copyWalletAddress = async () => {
		if (!walletAddress) return
		try {
			await navigator.clipboard.writeText(walletAddress)
			setWalletCopied(true)
			setTimeout(() => setWalletCopied(false), 1200)
		} catch {
			// ignore
		}
	}

	useEffect(() => {
		// Cleanup any pending animation frames
		if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
		if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
		raf1Ref.current = null
		raf2Ref.current = null

		if (isOpen) {
			setRendered(true)
			// Force at least one paint at the "offscreen" position before entering,
			// so the transform transition always animates (no snap).
			setEntered(false)
			raf1Ref.current = requestAnimationFrame(() => {
				raf2Ref.current = requestAnimationFrame(() => setEntered(true))
			})
			return () => {
				if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
				if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
				raf1Ref.current = null
				raf2Ref.current = null
			}
		}
		setEntered(false)
		// Match the drawer's 300ms transition so exit animation completes.
		const t = setTimeout(() => setRendered(false), 320)
		return () => clearTimeout(t)
	}, [isOpen])

	// Lock background scroll while drawer is rendered (modal behavior).
	useEffect(() => {
		if (!rendered) return
		const html = document.documentElement
		const body = document.body
		const prevHtmlOverflow = html.style.overflow
		const prevBodyOverflow = body.style.overflow
		html.style.overflow = 'hidden'
		body.style.overflow = 'hidden'
		return () => {
			html.style.overflow = prevHtmlOverflow
			body.style.overflow = prevBodyOverflow
		}
	}, [rendered])

	// Close on escape key
	useEffect(() => {
		if (!isOpen) return
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [isOpen, onClose])

	const totals = useMemo(() => {
		const tc = parseFloat(coreVault?.totalCollateral || '0') || 0
		const realized = parseFloat(coreVault?.realizedPnL || '0') || 0
		const unrealizedFromSummary = Number.isFinite(Number(portfolio?.summary?.unrealizedPnl))
			? Number(portfolio?.summary?.unrealizedPnl)
			: (parseFloat(coreVault?.unrealizedPnL || '0') || 0)
		// Match EvaluationCard logic: avoid liquidation double-count by not subtracting negative realized again
		const realizedForPortfolioValue = Math.max(0, realized)
		const value = tc + realizedForPortfolioValue + unrealizedFromSummary
		const valueDelta = unrealizedFromSummary
		const deltaPct = tc > 0 ? (valueDelta / Math.max(1e-9, tc)) * 100 : 0

		const available = Number.isFinite(Number(portfolio?.summary?.availableCash))
			? Number(portfolio?.summary?.availableCash)
			: (parseFloat(coreVault?.availableBalance || '0') || 0)

		return {
			totalCollateral: tc,
			availableCash: available,
			realizedPnl: realized,
			realizedLoss: Math.max(0, -realized),
			unrealizedPnl: unrealizedFromSummary,
			totalValue: value,
			valueDelta,
			valueDeltaPct: deltaPct,
		}
	}, [coreVault?.availableBalance, coreVault?.realizedPnL, coreVault?.totalCollateral, coreVault?.unrealizedPnL, portfolio?.summary?.availableCash, portfolio?.summary?.unrealizedPnl])

	const positions = (positionsState?.positions || []) as any[]

	type PositionMarketMeta = {
		name?: string | null
		symbol?: string | null
		market_identifier?: string | null
		icon_image_url?: string | null
	}

	const positionMetaByMarketBytes32 = useMemo(() => {
		const m = new Map<string, PositionMarketMeta>()
		for (const mk of markets || []) {
			const key = normalizeBytes32Hex(String((mk as any)?.market_id_bytes32 || ''))
			if (!key) continue
			m.set(key, {
				name: (mk as any)?.name ?? null,
				symbol: (mk as any)?.symbol ?? null,
				market_identifier: (mk as any)?.market_identifier ?? null,
				icon_image_url: (mk as any)?.icon_image_url ?? null,
			})
		}
		return m
	}, [markets])

	const topPositions = useMemo(() => {
		if (!Array.isArray(positions) || positions.length === 0) return []
		const rows = positions
			.map((p: any) => {
				const size = Number(p?.size || 0)
				const mark = Number(p?.markPrice || p?.entryPrice || 0)
				const notional = Math.abs(size) * mark
				return { p, notional }
			})
			.sort((a, b) => (b.notional || 0) - (a.notional || 0))
		return rows.slice(0, 6).map((r) => r.p)
	}, [positions])

	const flatOrders = useMemo(() => {
		return (sidebarOrders.orders || []).slice(0, 8)
	}, [sidebarOrders.orders])

	// Prevent UI blinking: keep last non-empty lists during transient empty/loading flips.
	const prevNonEmptyTopPositionsRef = useRef<any[]>([])
	const prevNonEmptyFlatOrdersRef = useRef<Array<{ id: string; symbol: string; side: 'BUY' | 'SELL'; price: number; size: number }>>([])

	useEffect(() => {
		if (topPositions.length > 0) prevNonEmptyTopPositionsRef.current = topPositions
	}, [topPositions])

	useEffect(() => {
		if (flatOrders.length > 0) prevNonEmptyFlatOrdersRef.current = flatOrders
	}, [flatOrders])

	const topPositionsToRender = topPositions.length > 0 ? topPositions : prevNonEmptyTopPositionsRef.current
	const flatOrdersToRender = flatOrders.length > 0 ? flatOrders : prevNonEmptyFlatOrdersRef.current

	const metrics: Metric[] = useMemo(() => {
		const posCount = Array.isArray(positions) ? positions.length : 0
		const ordCount = Array.isArray(sidebarOrders.orders) ? sidebarOrders.orders.length : 0
		return [
			{ label: 'Total assets', value: formatUsd(Math.max(0, totals.totalValue), 2), valueClassName: 'font-mono' },
			{ label: 'Δ (session)', value: `${totals.valueDelta >= 0 ? '+' : ''}${formatUsd(totals.valueDelta, 2)}`, valueClassName: 'font-mono', valueTone: totals.valueDelta >= 0 ? 'pos' : 'neg' },
			{ label: 'Δ% (session)', value: formatPct(totals.valueDeltaPct, 2), valueClassName: 'font-mono', valueTone: totals.valueDeltaPct >= 0 ? 'pos' : 'neg' },
			{ label: 'Available', value: formatUsd(Math.max(0, totals.availableCash), 2), valueClassName: 'font-mono' },
			{ label: 'Realized loss', value: formatUsd(totals.realizedLoss, 2), valueClassName: 'font-mono', valueTone: totals.realizedLoss > 0 ? 'neg' : 'default' },
			{ label: 'Open positions', value: String(posCount), valueClassName: 'font-mono' },
			{ label: 'Open orders', value: String(ordCount), valueClassName: 'font-mono' },
		]
	}, [positions, sidebarOrders.orders, totals.availableCash, totals.realizedLoss, totals.totalValue, totals.valueDelta, totals.valueDeltaPct])

	const isHealthy = Boolean(coreVault?.isHealthy)
	// Important: don't let background refresh cycles "blink" the sidebar content.
	// Treat the sidebar as a snapshot panel; only show "Updating…" during the first load per-open.
	const [didPaintSnapshot, setDidPaintSnapshot] = useState(false)
	useEffect(() => {
		// Reset per open/close cycle
		if (!isOpen) {
			setDidPaintSnapshot(false)
			return
		}
		if (!dataEnabled) return
		// Consider "snapshot ready" once all initial fetches have completed at least once
		const ready = Boolean(!portfolio?.isLoading && !positionsState?.isLoading && sidebarOrders.hasLoadedOnce)
		if (ready) setDidPaintSnapshot(true)
	}, [isOpen, dataEnabled, portfolio?.isLoading, positionsState?.isLoading, sidebarOrders.hasLoadedOnce])

	const showUpdatingBadge = Boolean(isWalletConnected && !didPaintSnapshot)
	const showPositionsSkeleton = topPositionsToRender.length === 0 && Boolean(positionsState?.isLoading)
	const showOrdersSkeleton = flatOrdersToRender.length === 0 && Boolean(sidebarOrders.isLoading || sidebarOrders.isRefreshing)

	if (!rendered) return null

	return (
		<div className="fixed inset-0 z-[10000]">
			<button
				aria-label="Close portfolio sidebar"
				className={`absolute inset-0 transition-opacity duration-300 ${entered ? 'opacity-100' : 'opacity-0'}`}
				style={{ background: 'rgba(0,0,0,0.6)' }}
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-label="Portfolio sidebar"
				data-walkthrough="portfolio-sidebar"
				className={[
					'fixed top-0 right-0 h-full w-full sm:w-[460px]',
					'transform-gpu transition-transform duration-300 ease-in-out will-change-transform',
					entered ? 'translate-x-0' : 'translate-x-full',
				].join(' ')}
			>
				<div className="h-full flex flex-col rounded-l-md border border-[#1A1A1A] bg-gradient-to-b from-[#141414] to-[#0F0F0F] overflow-hidden shadow-2xl">
					{/* Header */}
						<div className="border-b border-[#1A1A1A]">
						{/* Gradient banner + profile icon */}
						<div className="relative h-[112px] overflow-hidden">
							<div
								className="absolute inset-0"
								style={{
									background: `
										radial-gradient(420px 140px at 20% 30%, rgba(74,158,255,0.16), transparent 60%),
										radial-gradient(380px 140px at 80% 40%, rgba(16,185,129,0.10), transparent 62%),
										linear-gradient(180deg, #141414 0%, #0F0F0F 100%)
									`,
								}}
							/>
							<div className="absolute inset-0" style={{ boxShadow: 'inset 0 -1px 0 rgba(34,34,34,0.9)' }} />

							{/* Profile icon (bottom-left of banner, fixed at top) */}
							<div className="absolute left-3 bottom-3">
								<div className="w-14 h-14 rounded-full overflow-hidden border border-[#222222] bg-[#0F0F0F] shadow-2xl">
									{profileImageUrl ? (
										<Image
											src={profileImageUrl}
											alt={profileLabel}
											width={56}
											height={56}
											className="w-full h-full object-cover"
										/>
									) : (
										<div
											className="w-full h-full flex items-center justify-center text-[16px] font-semibold text-white"
											style={{
												background:
													'linear-gradient(135deg, rgba(74,158,255,0.20), rgba(16,185,129,0.14))',
											}}
										>
											{profileInitial}
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Header controls row */}
						<div className="flex items-center justify-between p-2.5">
							<div className="flex items-center gap-2 min-w-0 flex-1">
								<div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isWalletConnected ? (isHealthy ? 'bg-green-400' : 'bg-yellow-400') : 'bg-[#404040]'}`} />
								<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate">
									Portfolio
								</h4>
								{isWalletConnected ? (
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
										{showUpdatingBadge ? 'Updating…' : 'Snapshot'}
									</div>
								) : (
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
										Connect wallet
									</div>
								)}
							</div>

							<div className="flex items-center gap-2">
								<button
									onClick={onClose}
									className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded hover:text-[#9CA3AF] transition-all duration-200"
								>
									Close
								</button>
							</div>
						</div>
					</div>

					{/* Body */}
					<div
						className="flex-1 min-h-0 overflow-y-auto scrollbar-none p-2.5"
						data-walkthrough="portfolio-sidebar-body"
						style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
					>
						{/* Overview */}
						<div className="mb-3" data-walkthrough="portfolio-sidebar-overview">
							<div className="flex items-center justify-between mb-2">
								<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Overview</h4>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={copyWalletAddress}
										disabled={!isWalletConnected || !walletAddress}
										aria-label={walletCopied ? 'Wallet address copied' : 'Copy wallet address'}
										title="Copy wallet address"
										className={[
											'w-7 h-7 rounded-md border flex items-center justify-center transition-all duration-200',
											!isWalletConnected || !walletAddress
												? 'border-[#222222] text-[#606060] opacity-60 cursor-not-allowed'
												: walletCopied
													? 'border-green-500/30 text-green-400 bg-green-500/5'
													: 'border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white',
										].join(' ')}
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded font-mono">
										{isWalletConnected ? (walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : '—') : '—'}
									</div>
								</div>
							</div>

							<div className="rounded-md border border-[#222222] bg-[#0F0F0F] overflow-hidden">
								<div className="grid grid-cols-2">
									{metrics.map((m, idx) => {
										const tone =
											m.valueTone === 'pos' ? 'text-green-400' : m.valueTone === 'neg' ? 'text-red-400' : 'text-white'
										return (
											<div
												key={m.label}
												className={[
													'px-4 py-3 min-w-0',
													idx % 2 === 1 ? 'border-l border-[#1A1A1A]' : '',
													idx >= 2 ? 'border-t border-[#1A1A1A]' : '',
												].join(' ')}
											>
												<div className="text-[11px] leading-none text-[#7A7A7A] tracking-tight">{m.label}</div>
												<div className={['mt-2 text-[14px] leading-none font-medium tracking-tight', tone, m.valueClassName || ''].join(' ')}>
													{m.value}
												</div>
											</div>
										)
									})}
								</div>
							</div>
						</div>

						{/* Not connected */}
						{!isWalletConnected ? (
							<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
								<div className="flex items-center justify-between p-2.5">
									<div className="flex items-center gap-2 min-w-0 flex-1">
										<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
										<div className="flex items-center gap-1.5 min-w-0 flex-1">
											<span className="text-[11px] font-medium text-[#808080] truncate">
												Connect your wallet to view portfolio data
											</span>
										</div>
									</div>
									<svg className="w-3 h-3 text-[#404040] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
									</svg>
								</div>
								<div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
									<div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
										<div className="text-[9px] pt-1.5">
											<span className="text-[#606060]">This drawer mirrors the Watchlist styling and updates live when connected.</span>
										</div>
									</div>
								</div>
							</div>
						) : null}

						{/* Positions */}
						{isWalletConnected ? (
							<div className="mb-3">
								<div className="flex items-center justify-between mb-2">
									<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Positions</h4>
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
										{Array.isArray(positions) ? positions.length : 0}
									</div>
								</div>

								{showPositionsSkeleton ? (
									<div className="space-y-1">
										{Array.from({ length: 3 }).map((_, i) => (
											<div key={i} className="bg-[#0F0F0F] rounded-md border border-[#222222]">
												<div className="flex items-center justify-between p-2.5">
													<div className="flex items-center gap-2 min-w-0 flex-1">
														<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
														<div className="w-6 h-6 bg-[#2A2A2A] rounded-full animate-pulse flex-shrink-0" />
														<div className="flex items-center gap-1.5 min-w-0 flex-1">
															<div className="w-16 h-3 bg-[#2A2A2A] rounded animate-pulse" />
														</div>
													</div>
													<div className="flex items-center gap-2">
														<div className="w-12 h-3 bg-[#2A2A2A] rounded animate-pulse" />
														<div className="w-10 h-3 bg-[#2A2A2A] rounded animate-pulse" />
													</div>
												</div>
											</div>
										))}
									</div>
								) : topPositionsToRender.length === 0 ? (
									<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
										<div className="flex items-center justify-between p-2.5">
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
												<span className="text-[11px] font-medium text-[#808080]">No open positions</span>
											</div>
											<svg className="w-3 h-3 text-[#404040]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
										</div>
									</div>
								) : (
									<div className="space-y-0.5">
										{topPositionsToRender.map((p: any) => {
											const rawSymbol = String(p?.symbol || 'UNKNOWN').toUpperCase()
											const side = String(p?.side || '').toUpperCase()
											const size = Number(p?.size || 0)
											const mark = Number(p?.markPrice || p?.entryPrice || 0)
											const pnl = Number(p?.pnl || 0)
											const pnlPct = Number(p?.pnlPercent || 0)
											const isPos = pnl >= 0
											const dotTone = side === 'SHORT' ? 'bg-red-400' : 'bg-green-400'
											const posMarketKey = normalizeBytes32Hex(String(p?.marketId || p?.id || ''))
											const meta = posMarketKey ? positionMetaByMarketBytes32.get(posMarketKey) : undefined
											const displaySymbol = String(meta?.symbol || rawSymbol).toUpperCase()
											const displayName = String(meta?.name || displaySymbol)
											const routeId = String(meta?.market_identifier || displaySymbol)
											const iconUrl = (meta?.icon_image_url || (posMarketKey ? iconUrlByMarketId.get(posMarketKey) : undefined) || '').trim()
											const iconSrc = iconUrl || DEXETERA_PLACEHOLDER_ICON_SRC
											return (
												<button
													type="button"
													key={String(p?.id || `${displaySymbol}-${side}`)}
													onClick={() => navigateToToken(routeId)}
													className="group w-full text-left bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
												>
													<div className="flex items-center justify-between p-2.5">
														<div className="flex items-center gap-2 min-w-0 flex-1">
															<div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotTone}`} />
															<div className="w-6 h-6 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
																<Image
																	src={iconSrc}
																	alt={displaySymbol}
																	width={24}
																	height={24}
																	className={iconUrl ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-1'}
																/>
															</div>
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-1.5 min-w-0">
																	<span className="text-[11px] font-medium text-white truncate">{displayName}</span>
																	<span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{side || '—'}</span>
																</div>
																<div className="text-[10px] text-[#606060] font-mono truncate">
																	{displaySymbol} · {size.toFixed(2)} @ {mark > 0 ? formatUsd(mark, 2) : '—'}
																</div>
															</div>
														</div>
														<div className="flex items-center gap-2 flex-shrink-0">
															<span className={`text-[10px] font-medium ${isPos ? 'text-green-400' : 'text-red-400'} font-mono`}>
																{pnl >= 0 ? '+' : ''}{formatUsd(pnl, 2)}
															</span>
															<span className={`text-[10px] font-medium ${isPos ? 'text-green-400' : 'text-red-400'} font-mono`}>
																{formatPct(pnlPct, 1)}
															</span>
															<svg className="w-3 h-3 text-[#404040] opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
															</svg>
														</div>
													</div>
													<div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
														<div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
															<div className="text-[9px] pt-1.5">
																<span className="text-[#606060]">
																	Notional: {formatUsd(Math.abs(size) * Math.max(0, mark), 2)} · Leverage: {clamp(Number(p?.leverage || 1), 1, 100)}x
																</span>
															</div>
														</div>
													</div>
												</button>
											)
										})}
									</div>
								)}
							</div>
						) : null}

						{/* Orders */}
						{isWalletConnected ? (
							<div className="mb-1">
								<div className="flex items-center justify-between mb-2">
									<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Orders</h4>
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
										{Array.isArray(sidebarOrders.orders) ? sidebarOrders.orders.length : 0}
									</div>
								</div>

								{showOrdersSkeleton ? (
									<div className="group bg-[#0F0F0F] rounded-md border border-[#222222]">
										<div className="flex items-center justify-between p-2.5">
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
												<span className="text-[11px] font-medium text-[#808080]">Loading orders…</span>
											</div>
											<div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
												<div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
											</div>
										</div>
									</div>
								) : flatOrders.length === 0 ? (
									<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
										<div className="flex items-center justify-between p-2.5">
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
												<span className="text-[11px] font-medium text-[#808080]">No open orders</span>
											</div>
											<svg className="w-3 h-3 text-[#404040]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3" />
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
										</div>
									</div>
								) : (
									<div className="space-y-0.5">
										{flatOrdersToRender.map((o) => {
											const routeId = marketIdentifierBySymbol.get(String(o.symbol || '').toUpperCase()) || o.symbol
											const orderIconUrl = iconUrlBySymbol.get(String(o.symbol || '').toUpperCase()) || ''
											const orderIconSrc = orderIconUrl || DEXETERA_PLACEHOLDER_ICON_SRC
											return (
											<button
												type="button"
												key={`${o.symbol}::${o.id}`}
												onClick={() => navigateToToken(routeId)}
												className="group w-full text-left bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
											>
												<div className="flex items-center justify-between p-2.5">
													<div className="flex items-center gap-2 min-w-0 flex-1">
														<div className="w-6 h-6 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
															<Image
																src={orderIconSrc}
																alt={o.symbol}
																width={24}
																height={24}
																className={orderIconUrl ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-1'}
															/>
														</div>
														<div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${o.side === 'BUY' ? 'bg-green-400' : 'bg-red-400'}`} />
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-1.5 min-w-0">
																<span className="text-[11px] font-medium text-white truncate">{o.symbol}</span>
																<span className={`text-[10px] font-medium ${o.side === 'BUY' ? 'text-green-400' : 'text-red-400'} font-mono`}>
																	{o.side}
																</span>
															</div>
															<div className="text-[10px] text-[#606060] font-mono truncate">
																{Number.isFinite(o.price) && o.price > 0 ? `$${parseFloat(o.price.toFixed(4))}` : '—'} · {Number.isFinite(o.size) ? parseFloat(o.size.toFixed(6)) || '0' : '—'}
															</div>
														</div>
													</div>
													<svg className="w-3 h-3 text-[#404040] opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
													</svg>
												</div>
											</button>
											)
										})}
									</div>
								)}
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	)
}

