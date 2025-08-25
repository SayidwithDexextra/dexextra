'use client'

import { Faucet } from '@/components/Faucet'

export default function RewardsPage() {
  return (
    <div className="w-full h-screen bg-transparent flex px-4 py-4 box-border overflow-hidden">
      
      {/* Left Sidebar - Information Panel */}
      <div className="w-80 flex-shrink-0 mr-4 flex flex-col gap-3">
        
        {/* Header Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400"></div>
            <span className="text-[11px] font-medium text-white">Token Faucet</span>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded ml-auto">
              Rewards
            </div>
          </div>
          <div className="text-[10px] text-[#808080] leading-relaxed">
            Claim unlimited test USDC tokens for exploring Dexetra markets and practicing trading strategies.
          </div>
        </div>

        {/* Network Status Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400"></div>
              <span className="text-[11px] font-medium text-[#9CA3AF]">Network Status</span>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
          </div>
          <div className="text-[10px] text-[#808080] mb-1">Polygon Mainnet</div>
          <div className="text-[9px] text-[#606060]">Test environment • No gas fees for claiming</div>
        </div>

        {/* Features Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5 flex-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400"></div>
            <span className="text-[11px] font-medium text-[#9CA3AF]">Features</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[10px] text-[#808080]">Unlimited token claiming</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[10px] text-[#808080]">Instant transactions</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[10px] text-[#808080]">No daily limits</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
              <span className="text-[10px] text-[#808080]">Practice trading safely</span>
            </div>
          </div>
        </div>

        {/* Disclaimer Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]"></div>
            <span className="text-[11px] font-medium text-[#606060]">Important Notice</span>
          </div>
          <div className="text-[9px] text-[#606060] leading-relaxed">
            Test tokens have no real value and are for platform exploration only. 
            Use them to understand trading mechanics before using real assets.
          </div>
        </div>
      </div>

      {/* Right Main Content - Faucet */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex-1 flex flex-col overflow-hidden">
          
          {/* Faucet Header */}
          <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A] flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400"></div>
              <span className="text-[11px] font-medium text-white">USDC Faucet</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#606060]">Ready to claim</span>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
            </div>
          </div>

          {/* Faucet Content */}
          <div className="flex-1 p-2.5 overflow-auto">
            <Faucet />
          </div>

          {/* Quick Stats Footer */}
          <div className="flex-shrink-0 border-t border-[#1A1A1A] bg-[#0F0F0F]">
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-12 overflow-hidden transition-all duration-200">
              <div className="px-2.5 py-2">
                <div className="flex items-center justify-between text-[9px]">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0"></div>
                    <span className="text-[#808080]">Connected to Polygon • Test environment active</span>
                  </div>
                  <span className="text-[#606060]">Instant claiming available</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 