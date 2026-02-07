'use client'

import { getPortfolioTheme } from './theme'
import DashboardHeader from './DashboardHeader'
import EvaluationCard from './EvaluationCard'
import VaultActions from './VaultActions'
import AllocationGrid from './AllocationGrid'
import BreakdownTable from './BreakdownTable'
import React, { useEffect, useRef, useState } from 'react'

export default function PortfolioDashboard() {
	const theme = getPortfolioTheme()
	const evalRef = useRef<HTMLDivElement>(null)
	const [evalHeight, setEvalHeight] = useState(0)
	const openPortfolioSidebar = () => {
		try {
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('portfolioSidebar:open', { detail: { source: 'portfolioPage' } }))
			}
		} catch {}
	}

	useEffect(() => {
		// Lock page scroll completely while this page is mounted
		const html = document.documentElement
		const body = document.body
		const prevHtmlOverflow = html.style.overflow
		const prevBodyOverflow = body.style.overflow
		const prevHtmlHeight = html.style.height
		const prevBodyHeight = body.style.height
		const prevHtmlOverscroll = (html.style as any).overscrollBehavior
		const prevBodyOverscroll = (body.style as any).overscrollBehavior
		html.style.overflow = 'hidden'
		body.style.overflow = 'hidden'
		html.style.height = '100%'
		body.style.height = '100%'
		;(html.style as any).overscrollBehavior = 'none'
		;(body.style as any).overscrollBehavior = 'none'
		return () => {
			html.style.overflow = prevHtmlOverflow
			body.style.overflow = prevBodyOverflow
			html.style.height = prevHtmlHeight
			body.style.height = prevBodyHeight
			;(html.style as any).overscrollBehavior = prevHtmlOverscroll
			;(body.style as any).overscrollBehavior = prevBodyOverscroll
		}
	}, [])

	useEffect(() => {
		if (!evalRef.current) return
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect
			if (cr) setEvalHeight(cr.height)
		})
		ro.observe(evalRef.current)
		return () => ro.disconnect()
	}, [])

	// Match the total height of the Evaluation side
	const allocationViewportHeight = Math.max(220, Math.round(evalHeight))
	// Reduce Allocation cards overall footprint by ~25%
	const allocationGridHeight = Math.max(220, Math.round(evalHeight * 0.375))
	return (
		<div
			className="w-full h-screen overflow-hidden"
			data-walkthrough="portfolio-dashboard"
			style={{
				background: theme.backgroundGradient,
				padding: '16px 48px',
			}}
		>
			<div className="max-w-[1400px] mx-auto h-full flex flex-col">
				<div data-walkthrough="portfolio-dashboard-header">
					<DashboardHeader
						title="Portfolio"
						rightContent={
							<button
								onClick={openPortfolioSidebar}
								className="flex items-center gap-1.5 px-3 py-2 bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded-md text-[11px] text-[#808080] hover:text-white transition-all duration-200"
								aria-label="Open portfolio sidebar"
							>
								<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
								</svg>
								Details
							</button>
						}
					/>
				</div>

				<div className="grid gap-6 grid-cols-1 lg:grid-cols-[4fr_5fr] flex-1 min-h-0">
					<div ref={evalRef} data-walkthrough="portfolio-evaluation">
						<EvaluationCard />
					</div>
						<div
							className="h-full min-h-0 overflow-y-auto scrollbar-none pr-2"
							data-walkthrough="portfolio-right-rail"
							style={{ overscrollBehavior: 'contain', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 200px)' }}
						>
						<div className="flex flex-col">
							<div data-walkthrough="portfolio-vault-actions">
								<VaultActions />
							</div>
								<div className="relative mt-4" style={{ height: allocationGridHeight }}>
								<div data-walkthrough="portfolio-allocation">
									<AllocationGrid />
								</div>
								{/* Fade between Allocation and Breakdown */}
								<div
									className="pointer-events-none absolute bottom-0 left-0 right-0 h-12"
									style={{
										background:
											'linear-gradient(to bottom, rgba(0,0,0,0), var(--primary-bg))',
									}}
								/>
							</div>
							<div className="mt-4">
								<div data-walkthrough="portfolio-breakdown">
									<BreakdownTable />
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}


