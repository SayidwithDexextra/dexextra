'use client'

import { getPortfolioTheme } from './theme'
import React from 'react'

interface CardProps {
	title?: string
	children: React.ReactNode
	className?: string
	contentClassName?: string
	headerRight?: React.ReactNode
}

export default function Card({ title, children, className, contentClassName, headerRight }: CardProps) {
	const theme = getPortfolioTheme()
	return (
		<div
			className={`group rounded-md border transition-all duration-200 ${className ?? ''}`}
			style={{
				background: 'transparent',
				borderColor: 'transparent',
				boxShadow: 'none',
			}}
		>
			{title ? (
				<div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#1A1A1A' }}>
					<h3 className="text-sm font-medium" style={{ color: '#9CA3AF' }}>
						{title}
					</h3>
					{headerRight ? <div className="text-xs text-[#606060]">{headerRight}</div> : null}
				</div>
			) : null}
			<div className={`p-6 ${contentClassName ?? ''}`}>{children}</div>
		</div>
	)
}


