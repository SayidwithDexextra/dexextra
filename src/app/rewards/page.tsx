'use client'

import { ArbitrumFaucet, Faucet } from '@/components/Faucet'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'

export default function RewardsPage() {
  return (
    <div className="w-full min-h-screen md:h-screen bg-transparent flex flex-col md:flex-row px-3 py-3 md:px-4 md:py-4 box-border overflow-y-auto md:overflow-hidden gap-3 md:gap-0">
      
      {/* Left Sidebar - Information Panel */}
      <div className="w-full md:w-80 flex-shrink-0 md:mr-4 flex flex-col gap-3">
        
        {/* Header Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-3 md:p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400"></div>
            <span className="text-xs md:text-[11px] font-medium text-white">HyperLiquid MockUSDC Faucet</span>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded ml-auto">
              Rewards
            </div>
          </div>
          <div className="text-[11px] md:text-[10px] text-[#808080] leading-relaxed">
            Claim unlimited MockUSDC tokens from our HyperLiquid deployment for exploring Aluminum V1 futures and practicing trading strategies.
          </div>
        </div>

        {/* Network Status Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-3 md:p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400"></div>
              <span className="text-xs md:text-[11px] font-medium text-[#9CA3AF]">HyperLiquid Deployment</span>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
          </div>
          <div className="text-[11px] md:text-[10px] text-[#808080] mb-1">HyperLiquid Mainnet • Live</div>
          <div className="text-[10px] md:text-[9px] text-[#606060] break-all">MockUSDC: {`${(CONTRACT_ADDRESSES as any).mockUSDC?.slice(0,6)}...${(CONTRACT_ADDRESSES as any).mockUSDC?.slice(-4)}`} • Verified</div>
        </div>

        {/* HyperLiquid Features Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-3 md:p-2.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400"></div>
            <span className="text-xs md:text-[11px] font-medium text-[#9CA3AF]">HyperLiquid Features</span>
          </div>
          <div className="space-y-2.5 md:space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[11px] md:text-[10px] text-[#808080]">Aluminum V1 futures trading</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[11px] md:text-[10px] text-[#808080]">Optimized order matching</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[11px] md:text-[10px] text-[#808080]">Unlimited MockUSDC claiming</span>
            </div>
          </div>
        </div>

        {/* Disclaimer Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-3 md:p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]"></div>
            <span className="text-xs md:text-[11px] font-medium text-[#606060]">Important Notice</span>
          </div>
          <div className="text-[10px] md:text-[9px] text-[#606060] leading-relaxed">
            MockUSDC tokens from HyperLiquid deployment have no real value and are for platform exploration only. 
            Use them to understand Aluminum V1 trading mechanics and test VaultRouter functionality.
          </div>
        </div>
      </div>

      {/* Right Main Content - Faucets */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        <ArbitrumFaucet />

        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 md:flex-1 flex flex-col overflow-hidden">
          
          {/* Faucet Header */}
          <div className="flex items-center justify-between p-3 md:p-2.5 border-b border-[#1A1A1A] flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400"></div>
              <span className="text-xs md:text-[11px] font-medium text-white">HyperLiquid MockUSDC Faucet</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] md:text-[10px] text-[#606060]">Ready to claim</span>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
            </div>
          </div>

          {/* Faucet Content */}
          <div className="flex-1 p-3 md:p-2.5 overflow-auto">
            <Faucet />
          </div>

          {/* Quick Stats Footer - always visible on mobile, hover-reveal on desktop */}
          <div className="flex-shrink-0 border-t border-[#1A1A1A] bg-[#0F0F0F]">
            <div className="md:opacity-0 md:group-hover:opacity-100 md:max-h-0 md:group-hover:max-h-16 overflow-hidden md:transition-all md:duration-200">
              <div className="px-3 md:px-2.5 py-2">
                <div className="flex flex-col gap-1 text-[10px] md:text-[9px]">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
                    <span className="text-[#808080]">HyperLiquid Mainnet deployment • Live environment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0"></div>
                    <span className="text-[#606060] break-all">MockUSDC: {(CONTRACT_ADDRESSES as any).mockUSDC}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 