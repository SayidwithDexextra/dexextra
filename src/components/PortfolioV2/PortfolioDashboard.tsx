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
			style={{
				background: theme.backgroundGradient,
				padding: '16px 48px',
			}}
		>
			<div className="max-w-[1400px] mx-auto h-full flex flex-col">
				<DashboardHeader title="Portfolio" />

				<div className="grid gap-6 grid-cols-1 lg:grid-cols-[4fr_5fr] flex-1 min-h-0">
					<div ref={evalRef}>
						<EvaluationCard />
					</div>
						<div
							className="h-full min-h-0 overflow-y-auto scrollbar-none pr-2"
							style={{ overscrollBehavior: 'contain', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 200px)' }}
						>
						<div className="flex flex-col">
							<VaultActions />
								<div className="relative mt-4" style={{ height: allocationGridHeight }}>
								<AllocationGrid />
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
								<BreakdownTable />
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}


