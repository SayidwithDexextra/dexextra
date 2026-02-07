'use client'

import React, { useState } from 'react'
import VaultActionModal from './VaultActionModal'
import { useCoreVault } from '@/hooks/useCoreVault'
import { usePortfolioSummary } from '@/hooks/usePortfolioSummary'
import { useWallet } from '@/hooks/useWallet'

export default function VaultActions() {
	const { availableBalance, totalCollateral } = useCoreVault()
	const { walletData } = useWallet() as any
	const portfolio = usePortfolioSummary(walletData?.address || null, {
		enabled: Boolean(walletData?.isConnected && walletData?.address),
		refreshIntervalMs: 15_000,
	})
	const [showDeposit, setShowDeposit] = useState(false)
	const [showWithdraw, setShowWithdraw] = useState(false)

	const availNum = Number.isFinite(Number(portfolio?.summary?.availableCash))
		? Number(portfolio?.summary?.availableCash)
		: (parseFloat(availableBalance || '0') || 0)
	const avail = availNum.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
	const total = (parseFloat(totalCollateral || '0') || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

	return (
		<>
			<div className="bg-[#1A1A1A] rounded-md border border-[#222222]">
				<div className="flex items-center justify-between p-3">
					<h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Vault</h4>
					<div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">USDC</div>
				</div>
				<div className="px-3 pb-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-md border border-[#222222] bg-[#1A1A1A] p-3">
							<p className="text-[11px] font-medium text-[#808080] mb-1">Available</p>
							<p className="text-[10px] text-white font-mono">{avail} <span className="text-[#606060]">USDC</span></p>
						</div>
						<div className="rounded-md border border-[#222222] bg-[#1A1A1A] p-3">
							<p className="text-[11px] font-medium text-[#808080] mb-1">Total Collateral</p>
							<p className="text-[10px] text-white font-mono">{total} <span className="text-[#606060]">USDC</span></p>
						</div>
					</div>
					<div className="flex items-center gap-3 mt-3">
						<button
							onClick={() => setShowDeposit(true)}
							className="flex-1 text-xs font-medium rounded-md px-3 py-2 bg-[#1A1A1A] border border-[#222222] text-white"
						>
							Deposit
						</button>
						<button
							onClick={() => setShowWithdraw(true)}
							className="flex-1 text-xs font-medium rounded-md px-3 py-2 bg-[#1A1A1A] border border-[#222222] text-white"
						>
							Withdraw
						</button>
					</div>
				</div>
			</div>

			<VaultActionModal isOpen={showDeposit} action="deposit" onClose={() => setShowDeposit(false)} />
			<VaultActionModal isOpen={showWithdraw} action="withdraw" onClose={() => setShowWithdraw(false)} />
		</>
	)
}



