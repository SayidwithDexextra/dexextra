import Card from './Card'

export default function ScoreRow() {
	return (
		<Card>
			<div className="grid grid-cols-3 gap-10">
				<div className="flex items-center gap-4">
					<div
						className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
						style={{ background: 'rgba(139,195,74,0.15)' }}
					>
						<span className="text-2xl font-bold" style={{ color: '#8BC34A' }}>B</span>
					</div>
					<div>
						<p className="text-xs font-medium mb-1" style={{ color: '#9CA3AF' }}>
							Portfolio score
						</p>
						<p className="text-lg font-bold leading-tight">
							<span style={{ color: '#FFFFFF' }}>69</span>
							<span style={{ color: '#6B7280' }}> /100</span>
						</p>
						<p className="text-xs font-medium mt-0.5" style={{ color: '#9CA3AF' }}>
							Good
						</p>
					</div>
				</div>

				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
						AIRA
					</p>
					<div className="flex items-center gap-2 mb-1">
						<p className="text-xl font-bold" style={{ color: '#FFFFFF' }}>74%</p>
						<span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
					</div>
					<p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>
						Rebalance accuracy
					</p>
				</div>

				<div>
					<p className="text-xs font-medium mb-1.5" style={{ color: '#9CA3AF' }}>
						PRI
					</p>
					<div className="flex items-center gap-1.5 mb-1">
						<p className="text-xl font-bold" style={{ color: '#FFFFFF' }}>0.45</p>
						<span className="text-xs" style={{ color: '#6B7280' }}>ⓘ</span>
					</div>
					<p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>
						Resilience index: Risky
					</p>
				</div>
			</div>
		</Card>
	)
}


