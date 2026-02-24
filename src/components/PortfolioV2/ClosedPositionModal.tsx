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

	const handleDismiss = () => {
		if (isClosing) return
		onClose()
		setCloseError(null)
	}

	if (!isOpen) return null

	return (
		<div
			className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
			onClick={handleDismiss}
		>
			<div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
			<div
				className="relative z-10 w-full bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200"
				style={{ maxWidth: '600px', padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', margin: 'auto' }}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2 min-w-0">
						<span className="text-white text-sm font-medium tracking-tight">Close Position</span>
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A1A] border border-[#222222] text-[#808080]">{symbol}</span>
					</div>
					<button
						onClick={handleDismiss}
						className="p-1.5 rounded-full hover:bg-[#1A1A1A] text-[#606060] hover:text-[#808080] transition-all duration-200"
						aria-label="Close"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
							<path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				</div>

				{/* Position size */}
				<div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5 mb-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1.5">
							<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
							<span className="text-[10px] text-[#606060]">Position Size</span>
						</div>
						<span className="text-[13px] font-mono text-white">
							{new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(maxSize)}
						</span>
					</div>
				</div>

				{/* Close size input */}
				<div className="mb-4">
					<div className="relative">
						<input
							type="number"
							value={closeSize}
							onChange={(e) => {
								setCloseSize(e.target.value)
								setCloseError(null)
							}}
							className={`w-full bg-[#1A1A1A] hover:bg-[#2A2A2A] border rounded-md transition-all duration-200 focus:outline-none text-white text-sm font-mono pl-3 pr-16 py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
								closeError
									? 'border-red-500/50 focus:border-red-400'
									: 'border-[#222222] hover:border-[#333333] focus:border-[#333333]'
							}`}
							placeholder="Enter close size..."
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
							className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-1 rounded bg-[#0F0F0F] border border-[#222222] text-[#808080] hover:text-white hover:border-[#333333] transition-all duration-200"
							disabled={isClosing}
						>
							MAX
						</button>
					</div>
					{closeError && (
						<div className="mt-2 bg-[#0F0F0F] border border-[#222222] rounded-md p-2.5">
							<div className="flex items-center gap-2">
								<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
								<span className="text-[11px] font-medium text-red-400">{closeError}</span>
							</div>
						</div>
					)}
				</div>

				{/* Action buttons */}
				<div className="flex items-center justify-end gap-2">
					<button
						onClick={handleDismiss}
						className="px-4 py-2 rounded-md text-[11px] font-medium border border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white transition-all duration-200"
						disabled={isClosing}
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={isClosing || parsedSize <= 0 || parsedSize > maxSize}
						className={`px-4 py-2 rounded-md text-[11px] font-medium border transition-all duration-200 flex items-center gap-2 ${
							isClosing || parsedSize <= 0 || parsedSize > maxSize
								? 'border-[#222222] text-[#606060] cursor-not-allowed'
								: 'border-red-500/20 text-red-400 hover:border-red-500/30 hover:bg-red-500/5'
						}`}
					>
						{isClosing ? (
							<>
								<div className="w-3 h-3 border-2 border-t-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
								<span>Closing...</span>
							</>
						) : (
							<>
								<div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
								Confirm Close
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	)
}
