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
	const hasRight = Boolean(rightContent)
	return (
		<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-4">
			<div className={`flex items-center ${hasRight ? 'justify-between' : 'justify-center'} p-2.5`}>
				<div className={hasRight ? 'flex items-center gap-2 min-w-0 flex-1' : 'flex items-center gap-2'}>
					<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate">
						{title}
					</h4>
					{subtitle ? (
						<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
							{subtitle}
						</div>
					) : null}
				</div>
				{hasRight ? (
					<div className="flex items-center gap-2">
						{rightContent}
					</div>
				) : null}
			</div>
		</div>
	)
}


