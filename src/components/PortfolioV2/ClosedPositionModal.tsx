'use client'

import React, { useMemo, useState } from 'react'
import { useOrderBook } from '@/hooks/useOrderBook'

type ClosedPositionModalProps = {
	isOpen: boolean
	onClose: () => void
	positionId: string | null
	symbol: string
	maxSize: number
	defaultSize?: number
	onClosed?: () => void
}

export default function ClosedPositionModal({
	isOpen,
	onClose,
	positionId,
	symbol,
	maxSize,
	defaultSize,
	onClosed
}: ClosedPositionModalProps) {
	const [, orderBookActions] = useOrderBook(symbol)
	const [closeSize, setCloseSize] = useState<string>(() => (defaultSize ? String(defaultSize) : maxSize ? String(maxSize) : ''))
	const [isClosing, setIsClosing] = useState(false)
	const [closeError, setCloseError] = useState<string | null>(null)

	const parsedSize = useMemo(() => {
		const n = parseFloat(closeSize)
		return Number.isFinite(n) ? n : 0
	}, [closeSize])

	const validate = (val: number): string | null => {
		if (!val || val <= 0) return 'Enter a valid close size'
		if (val > maxSize) return 'Close size exceeds position size'
		return null
	}

	const handleSubmit = async () => {
		if (!positionId) return
		const err = validate(parsedSize)
		if (err) {
			setCloseError(err)
			return
		}
		try {
			setIsClosing(true)
			setCloseError(null)
			const ok = await orderBookActions.closePosition(positionId, parsedSize)
			if (!ok) {
				setCloseError('Failed to close position. Please try again.')
				return
			}
			onClose()
			onClosed?.()
		} catch (e: any) {
			setCloseError(e?.message || 'Failed to close position. Please try again.')
		} finally {
			setIsClosing(false)
		}
	}

	if (!isOpen) return null

	return (
		<div 
			className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
			onClick={() => {
				if (isClosing) return
				onClose()
				setCloseError(null)
			}}
		>
			<div 
				className="bg-[#1A1A1A] border border-[#333333] rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Close button */}
				<button
					onClick={handleBackdropClick}
					className="absolute top-4 right-4 text-[#606060] hover:text-white transition-colors duration-200 z-10"
				>
					<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>

				{/* Market image + header */}
				<div className="flex flex-col items-center pt-8 pb-4 px-6">
					{iconUrl ? (
						<div className="w-16 h-16 rounded-lg overflow-hidden border border-[#222222] mb-4">
							<img
								src={iconUrl}
								alt={displayName}
								className="w-full h-full object-cover"
							/>
						</div>
					) : (
						<div className="w-16 h-16 rounded-lg bg-[#1A1A1A] border border-[#222222] flex items-center justify-center mb-4">
							<span className="text-lg font-bold text-[#606060]">
								{symbol?.slice(0, 2) || '??'}
							</span>
							<span
								className={`text-2xl font-bold font-mono ${
									isProfitable ? 'text-green-400' : 'text-red-400'
								}`}
							>
								MAX
							</button>
						</div>
					)}

					<h2 className="text-lg font-semibold text-white mb-1">
						{actionLabel} {side === 'LONG' ? 'Long' : 'Short'}
					</h2>
					<p className="text-[11px] text-[#808080] text-center leading-relaxed max-w-[280px]">
						{displayName}
					</p>
				</div>

				{/* P&L preview card */}
				<div className="mx-6 mb-4">
					<div className="bg-[#1A1A1A] rounded-md border border-[#222222] p-4">
						<p className="text-xs font-medium text-[#9CA3AF] text-center mb-3 uppercase tracking-wide">
							Estimated Return
						</p>
						<div className="flex items-center justify-center gap-2 mb-2">
							<span className="text-[10px]">
								{isProfitable ? '📈' : '📉'}
							</span>
						</div>
						<div className="flex items-center justify-center gap-1.5 mb-3">
							<div
								className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
									isProfitable
										? 'bg-green-400/10 text-green-400'
										: 'bg-red-400/10 text-red-400'
								}`}
								placeholder="Enter amount"
								min="0"
								max={maxSize}
								step="0.0001"
								disabled={isClosing}
							/>
							<button
								onClick={() => {
									setCloseSize(String(maxSize))
									setCloseError(null)
								}}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 hover:text-blue-300"
								disabled={isClosing}
							>
								{isProfitable ? '+' : ''}{pnlPercent.toFixed(2)}%
							</div>
						)}
					</div>
					
					<div className="flex justify-end gap-2 pt-2">
						<button
							onClick={() => !isClosing && onClose()}
							className="px-3 py-1.5 text-[11px] font-medium text-[#808080] hover:text-white bg-[#2A2A2A] hover:bg-[#333333] rounded transition-colors"
							disabled={isClosing}
						>
							Cancel
						</button>
						<button
							onClick={handleSubmit}
							disabled={isClosing || parsedSize <= 0 || parsedSize > maxSize}
							className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1.5 ${
								isClosing || parsedSize <= 0 || parsedSize > maxSize
									? 'text-[#606060] bg-[#2A2A2A] cursor-not-allowed'
									: 'text-white bg-red-500 hover:bg-red-600'
							}`}
						>
							{isClosing ? (
								<>
									<div className="w-3 h-3 border-2 border-t-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
									<span>Closing...</span>
								</>
							) : (
								'Confirm Close'
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}














