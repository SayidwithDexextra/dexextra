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
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<img 
							src="/Dexicon/LOGO-Dexetera-01.svg" 
							alt="Dexetera Logo" 
							className="w-5 h-5"
						/>
						<h3 className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
							Close Position - {symbol}
						</h3>
					</div>
					<button
						onClick={() => !isClosing && onClose()}
						className="text-[#606060] hover:text-white transition-colors"
					>
						<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div className="space-y-4">
					<div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded">
						<span className="text-[10px] text-[#808080]">Position Size</span>
						<span className="text-[11px] font-medium text-white font-mono">
							{(Number(maxSize) || 0).toFixed(4)}
						</span>
					</div>
					
					<div>
						<label className="block text-[10px] text-[#9CA3AF] mb-1">
							Close Size
						</label>
						<div className="relative">
							<input
								type="number"
								value={closeSize}
								onChange={(e) => {
									setCloseSize(e.target.value)
									setCloseError(null)
								}}
								className={`w-full bg-[#0F0F0F] border rounded px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors ${
									closeError 
										? 'border-red-500 focus:border-red-400' 
										: 'border-[#333333] focus:border-blue-400'
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
								MAX
							</button>
						</div>
						{closeError && (
							<div className="mt-1">
								<span className="text-[10px] text-red-400">{closeError}</span>
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










