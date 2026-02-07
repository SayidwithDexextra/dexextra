'use client'

import React, { useMemo, useState } from 'react'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioSummary } from '@/hooks/usePortfolioSummary'
import { useWallet } from '@/hooks/useWallet'

type ActionType = 'deposit' | 'withdraw'

type VaultActionModalProps = {
	isOpen: boolean
	action: ActionType
	onClose: () => void
}

export default function VaultActionModal({ isOpen, action, onClose }: VaultActionModalProps) {
	const { availableBalance, totalCollateral, depositCollateral, withdrawCollateral, isLoading } = useCoreVault()
	const { walletData } = useWallet() as any
	const portfolio = usePortfolioSummary(walletData?.address || null, {
		enabled: Boolean(walletData?.isConnected && walletData?.address),
		refreshIntervalMs: 15_000,
	})
	const [amount, setAmount] = useState<string>('')
	const [submitting, setSubmitting] = useState<boolean>(false)
	const [notice, setNotice] = useState<{ kind: 'none' | 'cancelled' | 'error'; message: string }>({ kind: 'none', message: '' })
	const [txHash, setTxHash] = useState<string>('')

	const title = action === 'deposit' ? 'Deposit Collateral' : 'Withdraw Collateral'
	const cta = action === 'deposit' ? 'Deposit' : 'Withdraw'

	const formatFriendlyError = (e: any): { kind: 'cancelled' | 'error'; message: string } => {
		try {
			const code = e?.code ?? e?.error?.code
			const msg: string = String(e?.message || e?.error?.message || '').toLowerCase()
			if (code === 'ACTION_REJECTED' || code === 4001 || msg.includes('user denied') || msg.includes('user rejected') || msg.includes('denied transaction')) {
				return { kind: 'cancelled', message: 'Transaction cancelled by user.' }
			}
			// Gas estimation or revert
			if (e?.code === 'CALL_EXCEPTION' || msg.includes('revert') || msg.includes('gas')) {
				return { kind: 'error', message: 'Transaction could not be submitted. Please check balance, allowance, and vault status.' }
			}
			// Wrong network
			if (msg.includes('wrong network') || msg.includes('chain')) {
				return { kind: 'error', message: 'Wrong network. Please switch to the correct chain and try again.' }
			}
		} catch {}
		return { kind: 'error', message: 'Something went wrong. Please try again.' }
	}

	const parsedAmount = useMemo(() => {
		const n = parseFloat(amount)
		return Number.isFinite(n) && n > 0 ? n : 0
	}, [amount])

	const canSubmit = useMemo(() => {
		if (submitting) return false
		if (parsedAmount <= 0) return false
		if (action === 'withdraw') {
			const avail = Number.isFinite(Number(portfolio?.summary?.availableCash))
				? Number(portfolio?.summary?.availableCash)
				: (parseFloat(availableBalance || '0') || 0)
			return parsedAmount <= Math.max(0, avail)
		}
		return true
	}, [parsedAmount, submitting, action, availableBalance, portfolio?.summary?.availableCash])

	if (!isOpen) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => !submitting && onClose()} />
			<div
				className="relative w-full max-w-md bg-[#1A1A1A] rounded-md border border-[#222222]"
			>
				<div className="px-4 py-3 border-b border-[#1A1A1A]">
					<div className="flex items-center justify-between">
						<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">{title}</h4>
						<div className="flex items-center gap-2">
							{(submitting || isLoading) ? <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" /> : <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />}
							<button onClick={() => !submitting && onClose()} className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded hover:text-[#9CA3AF] transition-all duration-200">
								Close
							</button>
						</div>
					</div>
				</div>
				<div className="px-4 py-3">
					<div className="mb-3">
						<div className="flex items-center justify-between">
							<span className="text-[11px] font-medium text-[#808080]">Available</span>
							<span className="text-[10px] text-white font-mono">{(Number.isFinite(Number(portfolio?.summary?.availableCash)) ? Number(portfolio?.summary?.availableCash) : (parseFloat(availableBalance || '0') || 0)).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <span className="text-[#606060]">USDC</span></span>
						</div>
						<div className="flex items-center justify-between mt-1">
							<span className="text-[11px] font-medium text-[#808080]">Total Collateral</span>
							<span className="text-[10px] text-white font-mono">{(parseFloat(totalCollateral || '0') || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <span className="text-[#606060]">USDC</span></span>
						</div>
					</div>
					<label className="block text-[11px] font-medium text-[#808080] mb-1.5">
						Amount (USDC)
					</label>
					<div className="flex items-center gap-2">
						<input
							type="number"
							min="0"
							step="0.01"
							inputMode="decimal"
							pattern="^[0-9]*[.,]?[0-9]*$"
							placeholder="0.00"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							className="w-full rounded-md px-3 py-2 text-[11px] border outline-none"
							style={{ background: '#1A1A1A', color: '#E5E7EB', borderColor: '#222222' }}
						/>
						{action === 'withdraw' ? (
							<button
								onClick={() => setAmount(String(Number.isFinite(Number(portfolio?.summary?.availableCash)) ? Number(portfolio?.summary?.availableCash) : (parseFloat(availableBalance || '0') || 0)))}
								className="text-[10px] px-2 py-1 rounded-md border border-[#222222] bg-[#1A1A1A] text-[#9CA3AF]"
							>
								Max
							</button>
						) : null}
					</div>
					{notice.kind !== 'none' ? (
						<div
							className="mt-3 text-[10px] rounded-md px-3 py-2 border"
							style={{
								background: notice.kind === 'cancelled' ? '#1F2937' : 'rgba(239,68,68,0.10)',
								borderColor: notice.kind === 'cancelled' ? '#2D2D2D' : '#7F1D1D',
								color: notice.kind === 'cancelled' ? '#9CA3AF' : '#EF4444'
							}}
						>
							{notice.message}
						</div>
					) : null}
					{txHash ? (
						<div className="mt-3 text-[10px] text-green-400">Transaction submitted</div>
					) : null}
				</div>
				<div className="px-4 py-3 border-t border-[#1A1A1A]">
					<button
						disabled={!canSubmit || isLoading || submitting}
						onClick={async () => {
							if (!canSubmit) return
							setSubmitting(true)
							setNotice({ kind: 'none', message: '' })
							setTxHash('')
							try {
								const amtStr = amount.trim()
								const tx = action === 'deposit'
									? await depositCollateral(amtStr)
									: await withdrawCollateral(amtStr)
								setTxHash(tx)
								// Close modal after brief delay to show tx hash
								setTimeout(() => {
									onClose()
								}, 600)
							} catch (e: any) {
								setNotice(formatFriendlyError(e))
							} finally {
								setSubmitting(false)
							}
						}}
						className="w-full text-xs font-medium rounded-md px-3 py-2 bg-[#1A1A1A] border border-[#222222] text-white disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{submitting ? 'Submitting…' : cta}
					</button>
				</div>
			</div>
		</div>
	)
}



