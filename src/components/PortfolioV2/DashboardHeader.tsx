import { getPortfolioTheme } from './theme'

interface DashboardHeaderProps {
	title?: string
	subtitle?: string
	rightContent?: React.ReactNode
}

export default function DashboardHeader({
	title = 'Portfolio',
	subtitle,
	rightContent,
}: DashboardHeaderProps) {
	const theme = getPortfolioTheme()
	return (
		<div
			className="flex items-end justify-between mb-4"
		>
			<div>
				<div
					className="rounded-2xl transition-all duration-500"
					style={{
						background: 'linear-gradient(to right, rgba(255,255,255,0.10), rgba(255,255,255,0.00))',
						padding: '1px',
						display: 'inline-block',
					}}
				>
					<div className="rounded-2xl bg-[#0B0B0B]/70 backdrop-blur-sm border border-[#1F1F1F]/80 px-4 py-2">
				<h1
					className="space-grotesk-bold"
					style={{
						fontSize: '44px',
						lineHeight: '52px',
						letterSpacing: '-0.02em',
						color: '#D1D5DB',
						fontWeight: 700,
					}}
				>
					{title}
				</h1>
					</div>
				</div>
				{subtitle ? (
					<p
						className="space-grotesk-regular"
						style={{
							marginTop: 4,
							color: theme.textSecondary,
							fontSize: 14,
						}}
					>
						{subtitle}
					</p>
				) : null}
			</div>
			{rightContent ? <div className="flex items-center gap-2">{rightContent}</div> : null}
		</div>
	)
}


