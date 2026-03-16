'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioSnapshot } from '@/contexts/PortfolioSnapshotContext'
import { useMarkets } from '@/hooks/useMarkets'
import { normalizeBytes32Hex } from '@/lib/hex'
import { usePortfolioSidebarOpenOrders } from '@/hooks/usePortfolioSidebarOpenOrders'
import { Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { isMagicSelectedWallet, showMagicWalletUI } from '@/lib/magic'
import { supabase } from '@/lib/supabase'
import { useUserFees } from '@/hooks/useUserFees'
import { useOwnerEarnings } from '@/hooks/useOwnerEarnings'

type PortfolioSidebarProps = {
	isOpen: boolean
	onClose: () => void
}

type SidebarView = 'portfolio' | 'withdraw' | 'earnings' | 'revenue'

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
	const isMagicWallet = Boolean(isWalletConnected && isMagicSelectedWallet())
	const profileImageUrl: string | null = walletData?.userProfile?.profile_image_url || DEFAULT_PROFILE_IMAGE
	const profileLabel: string = String(
		walletData?.userProfile?.display_name ||
		walletData?.userProfile?.username ||
		(walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Guest')
	)
	const profileInitial = (profileLabel.trim().slice(0, 1) || 'D').toUpperCase()

	// Sidebar view state (portfolio overview vs inline withdraw)
	const [sidebarView, setSidebarView] = useState<SidebarView>('portfolio')

	// Mount/unmount for exit animation
	const [rendered, setRendered] = useState(false)
	const [entered, setEntered] = useState(false)
	const [walletCopied, setWalletCopied] = useState(false)
	const raf1Ref = useRef<number | null>(null)
	const raf2Ref = useRef<number | null>(null)

	// Only enable data hooks while the drawer is rendered.
	const dataEnabled = Boolean(isWalletConnected && rendered)

	const coreVault = useCoreVault()
	const { snapshot, isReady: snapshotReady, positions, positionsIsLoading } = usePortfolioSnapshot()

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

	const sidebarOrders = usePortfolioSidebarOpenOrders({
		enabled: dataEnabled,
		walletAddress,
		positionSymbols: (positions || []).map((p: any) => String(p?.symbol || '').toUpperCase()).filter(Boolean),
	})

	const { totals: feeTotals, recentFees, isLoading: feesLoading } = useUserFees(
		dataEnabled ? walletAddress : null,
		{ recentLimit: 5 }
	)

	const {
		markets: ownerMarkets,
		protocolMarkets,
		totals: ownerTotals,
		protocolTotals,
		isMarketOwner,
		isProtocolRecipient,
		hasRevenue,
		isLoading: ownerLoading,
	} = useOwnerEarnings(dataEnabled ? walletAddress : null)

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

	const openMagicWallet = async () => {
		const res = await showMagicWalletUI()
		if (!res.success) {
			try {
				console.warn('[PortfolioSidebar] showMagicWalletUI failed:', res.error)
			} catch {}
		}
	}

	useEffect(() => {
		if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
		if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
		raf1Ref.current = null
		raf2Ref.current = null

		if (isOpen) {
			setRendered(true)
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
		const t = setTimeout(() => {
			setRendered(false)
			setSidebarView('portfolio')
		}, 320)
		return () => clearTimeout(t)
	}, [isOpen])

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

	useEffect(() => {
		if (!isOpen) return
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (sidebarView !== 'portfolio') {
					setSidebarView('portfolio')
				} else {
					onClose()
				}
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [isOpen, onClose, sidebarView])

	const totals = useMemo(() => {
		const hideUntilSummaryReady = Boolean(isWalletConnected && dataEnabled && !snapshotReady)

		const tc = parseFloat(coreVault?.totalCollateral || '0') || 0
		const realized = parseFloat(coreVault?.realizedPnL || '0') || 0
		const unrealizedFromSummary = Number.isFinite(Number(snapshot?.unrealizedPnl))
			? Number(snapshot?.unrealizedPnl)
			: (hideUntilSummaryReady ? Number.NaN : (parseFloat(coreVault?.unrealizedPnL || '0') || 0))
		const realizedForPortfolioValue = Math.max(0, realized)
		const value = Number.isFinite(Number(snapshot?.portfolioValue))
			? Number(snapshot?.portfolioValue)
			: (tc + realizedForPortfolioValue + unrealizedFromSummary)
		const valueDelta = unrealizedFromSummary
		const deltaPct = tc > 0 ? (valueDelta / Math.max(1e-9, tc)) * 100 : 0

		const available = Number.isFinite(Number(snapshot?.availableCash))
			? Number(snapshot?.availableCash)
			: (hideUntilSummaryReady ? Number.NaN : (parseFloat(coreVault?.availableBalance || '0') || 0))

		return {
			totalCollateral: tc,
			availableCash: available,
			realizedPnl: realized,
			realizedLoss: Math.max(0, -realized),
			unrealizedPnl: unrealizedFromSummary,
			totalValue: value,
			valueDelta,
			valueDeltaPct: deltaPct,
			hideUntilSummaryReady,
		}
	}, [
		coreVault?.availableBalance,
		coreVault?.realizedPnL,
		coreVault?.totalCollateral,
		coreVault?.unrealizedPnL,
		dataEnabled,
		isWalletConnected,
		snapshot?.availableCash,
		snapshot?.portfolioValue,
		snapshot?.unrealizedPnl,
		snapshotReady,
	])

	const positionsAny = (positions || []) as any[]

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
		if (!Array.isArray(positionsAny) || positionsAny.length === 0) return []
		const rows = positionsAny
			.map((p: any) => {
				const size = Number(p?.size || 0)
				const mark = Number(p?.markPrice || p?.entryPrice || 0)
				const notional = Math.abs(size) * mark
				return { p, notional }
			})
			.sort((a, b) => (b.notional || 0) - (a.notional || 0))
		return rows.slice(0, 6).map((r) => r.p)
	}, [positionsAny])

	const flatOrders = useMemo(() => {
		return (sidebarOrders.orders || []).slice(0, 8)
	}, [sidebarOrders.orders])

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
		const posCount = Array.isArray(positionsAny) ? positionsAny.length : 0
		const ordCount = Array.isArray(sidebarOrders.orders) ? sidebarOrders.orders.length : 0
		const usdPlaceholder = '$—'
		const plainPlaceholder = '—'
		return [
			{ label: 'Total assets', value: totals.hideUntilSummaryReady ? usdPlaceholder : formatUsd(Math.max(0, totals.totalValue), 2), valueClassName: 'font-mono' },
			{ label: 'Δ (session)', value: totals.hideUntilSummaryReady ? plainPlaceholder : `${totals.valueDelta >= 0 ? '+' : ''}${formatUsd(totals.valueDelta, 2)}`, valueClassName: 'font-mono', valueTone: totals.hideUntilSummaryReady ? 'default' : (totals.valueDelta >= 0 ? 'pos' : 'neg') },
			{ label: 'Δ% (session)', value: totals.hideUntilSummaryReady ? plainPlaceholder : formatPct(totals.valueDeltaPct, 2), valueClassName: 'font-mono', valueTone: totals.hideUntilSummaryReady ? 'default' : (totals.valueDeltaPct >= 0 ? 'pos' : 'neg') },
			{ label: 'Available', value: totals.hideUntilSummaryReady ? usdPlaceholder : formatUsd(Math.max(0, totals.availableCash), 2), valueClassName: 'font-mono' },
			{ label: 'Realized P&L', value: `${totals.realizedPnl >= 0 ? '+' : ''}${formatUsd(totals.realizedPnl, 2)}`, valueClassName: 'font-mono', valueTone: totals.realizedPnl > 0 ? 'pos' : totals.realizedPnl < 0 ? 'neg' : 'default' },
			{ label: 'Open positions', value: String(posCount), valueClassName: 'font-mono' },
			{ label: 'Open orders', value: String(ordCount), valueClassName: 'font-mono' },
		]
	}, [positionsAny, sidebarOrders.orders, totals.availableCash, totals.hideUntilSummaryReady, totals.realizedPnl, totals.totalValue, totals.valueDelta, totals.valueDeltaPct])

	const isHealthy = Boolean(coreVault?.isHealthy)
	const [didPaintSnapshot, setDidPaintSnapshot] = useState(false)
	useEffect(() => {
		if (!isOpen) {
			setDidPaintSnapshot(false)
			return
		}
		if (!dataEnabled) return
		const ready = Boolean(snapshotReady && !positionsIsLoading && sidebarOrders.hasLoadedOnce)
		if (ready) setDidPaintSnapshot(true)
	}, [isOpen, dataEnabled, snapshotReady, positionsIsLoading, sidebarOrders.hasLoadedOnce])

	const showPositionsSkeleton = topPositionsToRender.length === 0 && Boolean(positionsIsLoading)
	const showOrdersSkeleton = flatOrdersToRender.length === 0 && Boolean(sidebarOrders.isLoading || sidebarOrders.isRefreshing)

	// ─── Inline withdraw state ───
	const [withdrawAmount, setWithdrawAmount] = useState('')
	const [withdrawSubmitting, setWithdrawSubmitting] = useState(false)
	const [withdrawNotice, setWithdrawNotice] = useState<{ kind: 'none' | 'cancelled' | 'error' | 'success'; message: string }>({ kind: 'none', message: '' })
	const [withdrawTxHash, setWithdrawTxHash] = useState('')

	// ─── Transaction history state ───
	type VaultTx = {
		id: string
		tx_type: 'deposit' | 'withdraw'
		amount: number
		token: string
		status: string
		created_at: string
	}
	const [txHistory, setTxHistory] = useState<VaultTx[]>([])
	const [txHistoryLoading, setTxHistoryLoading] = useState(false)
	const txHistoryFetched = useRef(false)

	const fetchTxHistory = useCallback(async () => {
		if (!walletAddress) return
		setTxHistoryLoading(true)
		try {
			const { data, error } = await supabase
				.from('vault_transactions')
				.select('id, tx_type, amount, token, status, created_at')
				.eq('wallet_address', walletAddress.toLowerCase())
				.order('created_at', { ascending: false })
				.limit(50)
			if (!error && data) setTxHistory(data as VaultTx[])
		} catch {} finally {
			setTxHistoryLoading(false)
		}
	}, [walletAddress])

	useEffect(() => {
		if (sidebarView === 'withdraw' && walletAddress && !txHistoryFetched.current) {
			txHistoryFetched.current = true
			fetchTxHistory()
		}
		if (sidebarView !== 'withdraw') {
			txHistoryFetched.current = false
		}
	}, [sidebarView, walletAddress, fetchTxHistory])

	const totalWithdrawableNum = parseFloat(coreVault?.totalWithdrawable || '0') || 0
	const withdrawParsedAmount = useMemo(() => {
		const n = parseFloat(withdrawAmount)
		return Number.isFinite(n) && n > 0 ? n : 0
	}, [withdrawAmount])
	const canWithdraw = !withdrawSubmitting && withdrawParsedAmount > 0 && withdrawParsedAmount <= Math.max(0, totalWithdrawableNum)

	// Reset withdraw form when switching views
	useEffect(() => {
		if (sidebarView === 'withdraw') {
			setWithdrawAmount('')
			setWithdrawSubmitting(false)
			setWithdrawNotice({ kind: 'none', message: '' })
			setWithdrawTxHash('')
		}
	}, [sidebarView])

	const handleWithdraw = async () => {
		if (!canWithdraw) return
		setWithdrawSubmitting(true)
		setWithdrawNotice({ kind: 'none', message: '' })
		setWithdrawTxHash('')
		try {
			const tx = await coreVault.withdrawCollateral(withdrawAmount.trim())
			setWithdrawTxHash(tx)
			setWithdrawNotice({ kind: 'success', message: 'Withdrawal submitted successfully.' })
			setWithdrawAmount('')
			setTimeout(() => fetchTxHistory(), 1500)
		} catch (e: any) {
			const code = e?.code ?? e?.error?.code
			const msg: string = String(e?.message || e?.error?.message || '').toLowerCase()
			if (code === 'ACTION_REJECTED' || code === 4001 || msg.includes('user denied') || msg.includes('user rejected')) {
				setWithdrawNotice({ kind: 'cancelled', message: 'Transaction cancelled by user.' })
			} else {
				setWithdrawNotice({ kind: 'error', message: 'Something went wrong. Please try again.' })
			}
		} finally {
			setWithdrawSubmitting(false)
		}
	}

	if (!rendered) return null

	return (
		<div className="fixed inset-0 z-[10000]">
			<button
				aria-label="Close portfolio sidebar"
				className={`absolute inset-0 transition-opacity duration-300 ${entered ? 'opacity-100' : 'opacity-0'}`}
				style={{ background: 'rgba(0,0,0,0.6)' }}
				onClick={() => {
					if (sidebarView !== 'portfolio') {
						setSidebarView('portfolio')
					} else {
						onClose()
					}
				}}
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

							<div className="absolute left-3 bottom-3">
								<div className="w-14 h-14 rounded-full overflow-hidden border border-[#222222] bg-[#0F0F0F] shadow-2xl">
									<Image
										src={profileImageUrl}
										alt={profileLabel}
										width={56}
										height={56}
										className="w-full h-full object-cover"
									/>
								</div>
							</div>
						</div>

						{/* Header controls row */}
						<div className="flex items-center justify-between px-2.5 pt-2.5 pb-0">
							<div className="flex items-center gap-2 min-w-0 flex-1">
								<div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isWalletConnected ? (isHealthy ? 'bg-green-400' : 'bg-yellow-400') : 'bg-[#404040]'}`} />
								<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate">
									Portfolio
								</h4>
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

						{/* Tab navigation */}
						<div className="px-2.5 border-b border-[#1A1A1A]">
							<div className="flex items-center gap-3 overflow-x-auto scrollbar-none">
								{([
									{ id: 'portfolio' as const, label: 'Overview' },
									{ id: 'withdraw' as const, label: 'Withdraw' },
									{ id: 'earnings' as const, label: 'Fees' },
									...(hasRevenue ? [{ id: 'revenue' as const, label: 'Revenue' }] : []),
								] as Array<{ id: SidebarView; label: string }>).map((t) => {
									const isActive = sidebarView === t.id
									const isDisabled = t.id !== 'portfolio' && !isWalletConnected
									return (
										<button
											key={t.id}
											type="button"
											onClick={() => !isDisabled && setSidebarView(t.id)}
											disabled={isDisabled}
											className={[
												'relative py-2.5 text-[11px] font-medium whitespace-nowrap transition-colors duration-200',
												isDisabled
													? 'text-[#404040] cursor-not-allowed'
													: isActive ? 'text-white' : 'text-[#808080] hover:text-white',
											].join(' ')}
										>
											{t.label}
											<span
												className={[
													'pointer-events-none absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full transition-opacity duration-200',
													isActive ? 'bg-white/80 opacity-100' : 'opacity-0',
												].join(' ')}
											/>
										</button>
									)
								})}
							</div>
						</div>
					</div>

					{/* Body — animated view switch */}
					<div className="flex-1 min-h-0 overflow-hidden relative">
						{/* Portfolio view */}
						<div
							className="absolute inset-0 overflow-y-auto scrollbar-none p-2.5 transition-all duration-300 ease-in-out"
							style={{
								opacity: sidebarView === 'portfolio' ? 1 : 0,
								transform: sidebarView === 'portfolio' ? 'translateX(0)' : 'translateX(-40px)',
								pointerEvents: sidebarView === 'portfolio' ? 'auto' : 'none',
								paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
							}}
							data-walkthrough="portfolio-sidebar-body"
						>
						{/* Overview */}
						<div className="mb-3" data-walkthrough="portfolio-sidebar-overview">
							<div className="flex items-center justify-between mb-2">
								<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Overview</h4>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => {
											onClose()
											setTimeout(() => {
												if (typeof window !== 'undefined') {
													if (!isWalletConnected) {
														window.dispatchEvent(new CustomEvent('walkthrough:wallet:open'))
													} else {
														window.dispatchEvent(new CustomEvent('walkthrough:deposit:open'))
													}
												}
											}, 350)
										}}
										className="h-7 px-2.5 rounded-md border flex items-center justify-center gap-1.5 transition-all duration-200 border-[#222222] text-[#808080] hover:border-[#4a9eff] hover:bg-[#4a9eff]/10 hover:text-[#4a9eff]"
										aria-label="Deposit funds"
									>
										<Wallet className="w-3.5 h-3.5" />
										<span className="text-[10px] font-medium uppercase tracking-wide">Deposit</span>
									</button>
										{isMagicWallet ? (
											<button
												type="button"
												onClick={openMagicWallet}
												className="h-7 px-2.5 rounded-md border flex items-center justify-center gap-1.5 transition-all duration-200 border-[#222222] text-[#808080] hover:border-[#7C3AED] hover:bg-[#7C3AED]/10 hover:text-[#C4B5FD]"
												aria-label="Open Magic wallet"
												title="Open Magic wallet"
											>
												<span className="text-[10px] font-semibold uppercase tracking-wide">Magic</span>
											</button>
										) : null}
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

						{/* Fees view */}
						<div
							className="absolute inset-0 overflow-y-auto scrollbar-none p-2.5 transition-all duration-300 ease-in-out"
							style={{
								opacity: sidebarView === 'earnings' ? 1 : 0,
								transform: sidebarView === 'earnings' ? 'translateX(0)' : 'translateX(40px)',
								pointerEvents: sidebarView === 'earnings' ? 'auto' : 'none',
								paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
							}}
						>
							<div className="mb-3">
								<div className="flex items-center justify-between mb-2">
									<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Fee Summary</h4>
									<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
										{feeTotals.totalTrades} trades
									</div>
								</div>

								{/* Totals card */}
								<div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-3 mb-2">
									<div className="grid grid-cols-3 gap-3">
										<div>
											<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Total Fees</div>
											<div className="text-[14px] font-semibold text-white font-mono">
												${feeTotals.totalFeesUsdc.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Taker</div>
											<div className="text-[14px] font-semibold text-red-400 font-mono">
												${feeTotals.takerFeesUsdc.toFixed(2)}
											</div>
											<div className="text-[9px] text-[#606060] mt-0.5">{feeTotals.takerTrades} trades</div>
										</div>
										<div>
											<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Maker</div>
											<div className="text-[14px] font-semibold text-green-400 font-mono">
												${feeTotals.makerFeesUsdc.toFixed(2)}
											</div>
											<div className="text-[9px] text-[#606060] mt-0.5">{feeTotals.makerTrades} trades</div>
										</div>
									</div>
									<div className="mt-2 pt-2 border-t border-[#1A1A1A] grid grid-cols-2 gap-3">
										<div>
											<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Volume</div>
											<div className="text-[12px] font-medium text-[#9CA3AF] font-mono">
												${feeTotals.totalVolumeUsdc >= 1_000_000
													? `${(feeTotals.totalVolumeUsdc / 1_000_000).toFixed(2)}M`
													: feeTotals.totalVolumeUsdc >= 1000
													? `${(feeTotals.totalVolumeUsdc / 1000).toFixed(1)}k`
													: feeTotals.totalVolumeUsdc.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Avg Fee Rate</div>
											<div className="text-[12px] font-medium text-[#9CA3AF] font-mono">
												{feeTotals.totalVolumeUsdc > 0
													? `${((feeTotals.totalFeesUsdc / feeTotals.totalVolumeUsdc) * 100).toFixed(3)}%`
													: '—'}
											</div>
										</div>
									</div>
								</div>

								{/* Recent fee history */}
								<div className="flex items-center justify-between mb-2 mt-4">
									<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Recent Fees</h4>
								</div>

								{feesLoading && recentFees.length === 0 ? (
									<div className="group bg-[#0F0F0F] rounded-md border border-[#222222]">
										<div className="flex items-center justify-between p-2.5">
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400 animate-pulse" />
												<span className="text-[11px] font-medium text-[#808080]">Loading fees…</span>
											</div>
										</div>
									</div>
								) : recentFees.length === 0 ? (
									<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
										<div className="flex items-center justify-between p-2.5">
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
												<span className="text-[11px] font-medium text-[#808080]">No fee history yet</span>
											</div>
										</div>
									</div>
								) : (
									<div className="space-y-0.5">
										{recentFees.map((f) => (
											<div
												key={f.id}
												className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
											>
												<div className="flex items-center justify-between p-2">
													<div className="flex items-center gap-2 min-w-0 flex-1">
														<div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.fee_role === 'taker' ? 'bg-red-400' : 'bg-green-400'}`} />
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-1.5">
																<span className="text-[11px] font-medium text-white truncate">
																	{f.market_id ? f.market_id.replace(/-/g, '/').toUpperCase().slice(0, 12) : 'Trade'}
																</span>
																<span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
																	f.fee_role === 'taker'
																		? 'bg-red-400/10 text-red-400'
																		: 'bg-green-400/10 text-green-400'
																}`}>
																	{f.fee_role.toUpperCase()}
																</span>
															</div>
															<div className="text-[9px] text-[#606060] font-mono">
																{f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
																{' · '}
																${f.trade_notional >= 1000 ? `${(f.trade_notional / 1000).toFixed(1)}k` : f.trade_notional.toFixed(2)} notional
															</div>
														</div>
													</div>
													<div className="text-right flex-shrink-0 ml-2">
														<div className="text-[11px] font-medium text-yellow-400 font-mono">
															-${f.fee_amount_usdc.toFixed(4)}
														</div>
													</div>
												</div>
											</div>
										))}
									</div>
								)}

								{/* Link to full breakdown in Settings */}
								<button
									type="button"
									onClick={() => {
										router.push('/settings?tab=earnings')
										onClose()
									}}
									className="w-full mt-3 text-center text-[10px] text-[#606060] hover:text-[#9CA3AF] transition-colors duration-200 py-1.5"
								>
									View full breakdown in Settings →
								</button>
							</div>
						</div>

						{/* Revenue view (market owners + protocol recipients) */}
						<div
							className="absolute inset-0 overflow-y-auto scrollbar-none p-2.5 transition-all duration-300 ease-in-out"
							style={{
								opacity: sidebarView === 'revenue' ? 1 : 0,
								transform: sidebarView === 'revenue' ? 'translateX(0)' : 'translateX(40px)',
								pointerEvents: sidebarView === 'revenue' ? 'auto' : 'none',
								paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
							}}
						>
							<div className="mb-3">
								{/* Protocol Revenue (if protocol fee recipient) */}
								{isProtocolRecipient ? (
									<>
										<div className="flex items-center justify-between mb-2">
											<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Protocol Revenue</h4>
											<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
												{protocolTotals.marketCount} market{protocolTotals.marketCount !== 1 ? 's' : ''}
											</div>
										</div>

										<div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-3 mb-2">
											<div className="grid grid-cols-2 gap-3">
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Protocol Earnings</div>
													<div className="text-[16px] font-semibold text-green-400 font-mono">
														${protocolTotals.totalProtocolEarningsUsdc.toFixed(2)}
													</div>
													<div className="text-[9px] text-[#606060] mt-0.5">80% share</div>
												</div>
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">To Market Owners</div>
													<div className="text-[16px] font-semibold text-[#9CA3AF] font-mono">
														${protocolTotals.totalOwnerEarningsUsdc.toFixed(2)}
													</div>
													<div className="text-[9px] text-[#606060] mt-0.5">20% share</div>
												</div>
											</div>
											<div className="mt-2 pt-2 border-t border-[#1A1A1A] grid grid-cols-2 gap-3">
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Total Fees</div>
													<div className="text-[12px] font-medium text-white font-mono">
														${protocolTotals.totalFeesCollectedUsdc.toFixed(2)}
													</div>
												</div>
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Volume</div>
													<div className="text-[12px] font-medium text-white font-mono">
														${protocolTotals.totalVolumeUsdc >= 1_000_000
															? `${(protocolTotals.totalVolumeUsdc / 1_000_000).toFixed(2)}M`
															: protocolTotals.totalVolumeUsdc >= 1000
															? `${(protocolTotals.totalVolumeUsdc / 1000).toFixed(1)}k`
															: protocolTotals.totalVolumeUsdc.toFixed(2)}
													</div>
												</div>
											</div>
										</div>

										<div className="flex items-center justify-between mb-2 mt-4">
											<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">By Market</h4>
										</div>

										{ownerLoading && protocolMarkets.length === 0 ? (
											<div className="group bg-[#0F0F0F] rounded-md border border-[#222222]">
												<div className="flex items-center justify-between p-2.5">
													<div className="flex items-center gap-2 min-w-0 flex-1">
														<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400 animate-pulse" />
														<span className="text-[11px] font-medium text-[#808080]">Loading revenue…</span>
													</div>
												</div>
											</div>
										) : (
											<div className="space-y-0.5">
												{protocolMarkets.map((m) => (
													<div
														key={`proto-${m.market_id}-${m.market_address}`}
														className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
													>
														<div className="flex items-center justify-between p-2.5">
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-1.5">
																	<span className="text-[11px] font-medium text-white truncate">
																		{m.market_id ? m.market_id.replace(/-/g, '/').toUpperCase().slice(0, 14) : m.market_address.slice(0, 10) + '…'}
																	</span>
																</div>
																<div className="text-[9px] text-[#606060] font-mono mt-0.5">
																	{m.total_fee_events} fees · ${m.total_volume_usdc >= 1000 ? `${(m.total_volume_usdc / 1000).toFixed(1)}k` : m.total_volume_usdc.toFixed(2)} vol
																</div>
															</div>
															<div className="text-right flex-shrink-0 ml-2">
																<div className="text-[12px] font-semibold text-green-400 font-mono">
																	+${m.total_protocol_earnings_usdc.toFixed(2)}
																</div>
																<div className="text-[9px] text-[#606060] font-mono">
																	of ${m.total_fees_collected_usdc.toFixed(2)}
																</div>
															</div>
														</div>
													</div>
												))}
											</div>
										)}
									</>
								) : null}

								{/* Market Owner Revenue */}
								{isMarketOwner ? (
									<>
										<div className={`flex items-center justify-between mb-2 ${isProtocolRecipient ? 'mt-5' : ''}`}>
											<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Market Owner Revenue</h4>
											<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
												{ownerTotals.marketCount} market{ownerTotals.marketCount !== 1 ? 's' : ''}
											</div>
										</div>

										<div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-3 mb-2">
											<div className="grid grid-cols-2 gap-3">
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Your Earnings</div>
													<div className="text-[16px] font-semibold text-green-400 font-mono">
														${ownerTotals.totalOwnerEarningsUsdc.toFixed(2)}
													</div>
													<div className="text-[9px] text-[#606060] mt-0.5">20% share</div>
												</div>
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Protocol</div>
													<div className="text-[16px] font-semibold text-[#9CA3AF] font-mono">
														${ownerTotals.totalProtocolEarningsUsdc.toFixed(2)}
													</div>
													<div className="text-[9px] text-[#606060] mt-0.5">80% share</div>
												</div>
											</div>
											<div className="mt-2 pt-2 border-t border-[#1A1A1A] grid grid-cols-2 gap-3">
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Total Fees</div>
													<div className="text-[12px] font-medium text-white font-mono">
														${ownerTotals.totalFeesCollectedUsdc.toFixed(2)}
													</div>
												</div>
												<div>
													<div className="text-[9px] text-[#606060] uppercase tracking-wide mb-0.5">Volume</div>
													<div className="text-[12px] font-medium text-white font-mono">
														${ownerTotals.totalVolumeUsdc >= 1_000_000
															? `${(ownerTotals.totalVolumeUsdc / 1_000_000).toFixed(2)}M`
															: ownerTotals.totalVolumeUsdc >= 1000
															? `${(ownerTotals.totalVolumeUsdc / 1000).toFixed(1)}k`
															: ownerTotals.totalVolumeUsdc.toFixed(2)}
													</div>
												</div>
											</div>
										</div>

										<div className="flex items-center justify-between mb-2 mt-4">
											<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">By Market</h4>
										</div>

										{ownerLoading && ownerMarkets.length === 0 ? (
											<div className="group bg-[#0F0F0F] rounded-md border border-[#222222]">
												<div className="flex items-center justify-between p-2.5">
													<div className="flex items-center gap-2 min-w-0 flex-1">
														<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400 animate-pulse" />
														<span className="text-[11px] font-medium text-[#808080]">Loading revenue…</span>
													</div>
												</div>
											</div>
										) : (
											<div className="space-y-0.5">
												{ownerMarkets.map((m) => (
													<div
														key={`owner-${m.market_id}-${m.market_address}`}
														className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
													>
														<div className="flex items-center justify-between p-2.5">
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-1.5">
																	<span className="text-[11px] font-medium text-white truncate">
																		{m.market_id ? m.market_id.replace(/-/g, '/').toUpperCase().slice(0, 14) : m.market_address.slice(0, 10) + '…'}
																	</span>
																</div>
																<div className="text-[9px] text-[#606060] font-mono mt-0.5">
																	{m.total_fee_events} fees · ${m.total_volume_usdc >= 1000 ? `${(m.total_volume_usdc / 1000).toFixed(1)}k` : m.total_volume_usdc.toFixed(2)} vol
																</div>
															</div>
															<div className="text-right flex-shrink-0 ml-2">
																<div className="text-[12px] font-semibold text-green-400 font-mono">
																	+${m.total_owner_earnings_usdc.toFixed(2)}
																</div>
																<div className="text-[9px] text-[#606060] font-mono">
																	of ${m.total_fees_collected_usdc.toFixed(2)}
																</div>
															</div>
														</div>
													</div>
												))}
											</div>
										)}
									</>
								) : null}

								{/* Link to Settings for full view */}
								<button
									type="button"
									onClick={() => {
										router.push('/settings?tab=markets')
										onClose()
									}}
									className="w-full mt-3 text-center text-[10px] text-[#606060] hover:text-[#9CA3AF] transition-colors duration-200 py-1.5"
								>
									View in My Markets →
								</button>
							</div>
						</div>

						{/* Withdraw view */}
						<div
							className="absolute inset-0 overflow-y-auto scrollbar-none p-2.5 transition-all duration-300 ease-in-out"
							style={{
								opacity: sidebarView === 'withdraw' ? 1 : 0,
								transform: sidebarView === 'withdraw' ? 'translateX(0)' : 'translateX(40px)',
								pointerEvents: sidebarView === 'withdraw' ? 'auto' : 'none',
								paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
							}}
						>
							<div className="mb-3">
								<div className="flex items-center justify-between mb-2">
									<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Withdraw Collateral</h4>
								</div>

								{/* Balance cards */}
								<div className="rounded-md border border-[#222222] bg-[#0F0F0F] overflow-hidden mb-3">
									<div className="grid grid-cols-2">
										<div className="px-4 py-3 min-w-0">
											<div className="text-[11px] leading-none text-[#7A7A7A] tracking-tight">Withdrawable</div>
											<div className="mt-2 text-[14px] leading-none font-medium tracking-tight text-white font-mono">
												{totalWithdrawableNum.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
											</div>
										</div>
										<div className="px-4 py-3 min-w-0 border-l border-[#1A1A1A]">
											<div className="text-[11px] leading-none text-[#7A7A7A] tracking-tight">Total Collateral</div>
											<div className="mt-2 text-[14px] leading-none font-medium tracking-tight text-white font-mono">
												{(parseFloat(coreVault?.totalCollateral || '0') || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
											</div>
										</div>
										<div className="px-4 py-3 min-w-0 border-t border-[#1A1A1A] col-span-2">
											<div className="text-[11px] leading-none text-[#7A7A7A] tracking-tight">Available (Trading)</div>
											<div className="mt-2 text-[14px] leading-none font-medium tracking-tight text-white font-mono">
												{(parseFloat(coreVault?.availableBalance || '0') || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
											</div>
										</div>
									</div>
								</div>

								{/* Amount input */}
								<div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
									<label className="block text-[11px] font-medium text-[#808080] mb-2">
										Amount (USDC)
									</label>
									<div className="flex items-center gap-2">
										<input
											type="number"
											min="0"
											step="0.01"
											inputMode="decimal"
											placeholder="0.00"
											value={withdrawAmount}
											onChange={(e) => setWithdrawAmount(e.target.value)}
											className="w-full rounded-md px-3 py-2.5 text-[12px] border outline-none font-mono transition-colors duration-200 focus:border-[#333333]"
											style={{ background: '#141414', color: '#E5E7EB', borderColor: '#222222' }}
										/>
										<button
											onClick={() => setWithdrawAmount(String(totalWithdrawableNum))}
											className="text-[10px] px-2.5 py-2 rounded-md border border-[#222222] bg-[#141414] text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-all duration-200 whitespace-nowrap"
										>
											Max
										</button>
									</div>

									{withdrawNotice.kind !== 'none' ? (
										<div
											className="mt-3 text-[10px] rounded-md px-3 py-2 border"
											style={{
												background: withdrawNotice.kind === 'success' ? 'rgba(16,185,129,0.08)' : withdrawNotice.kind === 'cancelled' ? '#1F2937' : 'rgba(239,68,68,0.10)',
												borderColor: withdrawNotice.kind === 'success' ? '#065F46' : withdrawNotice.kind === 'cancelled' ? '#2D2D2D' : '#7F1D1D',
												color: withdrawNotice.kind === 'success' ? '#10B981' : withdrawNotice.kind === 'cancelled' ? '#9CA3AF' : '#EF4444',
											}}
										>
											{withdrawNotice.message}
										</div>
									) : null}

									{withdrawTxHash ? (
										<div className="mt-2 text-[10px] text-green-400 font-mono truncate">
											Tx: {withdrawTxHash}
										</div>
									) : null}

									<button
										disabled={!canWithdraw || coreVault.isLoading || withdrawSubmitting}
										onClick={handleWithdraw}
										className={[
											'w-full mt-4 text-[11px] font-medium rounded-md px-3 py-2.5 border transition-all duration-200',
											!canWithdraw || coreVault.isLoading || withdrawSubmitting
												? 'bg-[#141414] border-[#222222] text-[#606060] cursor-not-allowed'
												: 'bg-[#141414] border-[#222222] text-white hover:border-[#ef4444] hover:bg-[#ef4444]/10 hover:text-[#ef4444]',
										].join(' ')}
									>
										{withdrawSubmitting ? 'Processing…' : 'Withdraw'}
									</button>
								</div>
							</div>

							{/* Transaction History */}
							<div className="mt-5">
								<h3 className="text-[16px] font-semibold text-white tracking-tight mb-3">Transaction History</h3>

								{txHistoryLoading ? (
									<div className="space-y-1.5">
										{Array.from({ length: 4 }).map((_, i) => (
											<div key={i} className="bg-[#0F0F0F] rounded-md border border-[#222222] p-3">
												<div className="flex items-center gap-2">
													<div className="w-7 h-7 bg-[#2A2A2A] rounded-full animate-pulse flex-shrink-0" />
													<div className="flex-1 space-y-1.5">
														<div className="w-24 h-3 bg-[#2A2A2A] rounded animate-pulse" />
														<div className="w-16 h-2.5 bg-[#1A1A1A] rounded animate-pulse" />
													</div>
													<div className="w-16 h-3 bg-[#2A2A2A] rounded animate-pulse" />
												</div>
											</div>
										))}
									</div>
								) : txHistory.length === 0 ? (
									<div className="bg-[#0F0F0F] rounded-md border border-[#222222] p-4 text-center">
										<span className="text-[11px] text-[#606060]">No transactions yet</span>
									</div>
								) : (
									<div className="space-y-1">
										{txHistory.map((tx) => {
											const isDeposit = tx.tx_type === 'deposit'
											const dateStr = (() => {
												try {
													const d = new Date(tx.created_at)
													return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
												} catch { return '—' }
											})()
											return (
												<div
													key={tx.id}
													className="group bg-[#0F0F0F] hover:bg-[#141414] rounded-md border border-[#222222] hover:border-[#2A2A2A] transition-all duration-200 p-3"
												>
													<div className="flex items-center gap-2.5">
														<div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isDeposit ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
															{isDeposit
																? <ArrowDownLeft className="w-3.5 h-3.5 text-green-400" />
																: <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />
															}
														</div>
														<div className="flex-1 min-w-0">
															<span className="text-[11px] font-medium text-white">
																{isDeposit ? 'Deposit' : 'Withdrawal'}
															</span>
															<div className="text-[10px] text-[#505050] font-mono mt-0.5">
																{dateStr}
															</div>
														</div>
														<div className="flex-shrink-0 text-right">
															<span className={`text-[12px] font-medium font-mono ${isDeposit ? 'text-green-400' : 'text-red-400'}`}>
																{isDeposit ? '+' : '−'}{Number(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
															</span>
															<div className="text-[9px] text-[#505050] mt-0.5">{tx.token}</div>
														</div>
													</div>
												</div>
											)
										})}
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
