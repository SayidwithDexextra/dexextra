'use client'

import { FC } from 'react'
import { PortfolioValue } from '../Value'
import { PerformanceTabs } from '../Performance'
import { AssetList } from '../Assets'

const PortfolioOverview: FC = () => {
  return (
    <div className="h-[600px] bg-[#0F0F0F] p-2">
      <div className="mx-auto h-full max-w-[480px]">
        <div className="grid h-full grid-rows-[auto_1fr] gap-2">
          {/* Portfolio Value Card */}
          <div className="group bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] hover:bg-[#2A2A2A] transition-all duration-200 p-2">
            <PortfolioValue />
          </div>
          
          {/* Asset List Section */}
          <div className="group bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 flex flex-col min-h-0">
            <div className="p-2 border-b border-[#222222]">
              <PerformanceTabs />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <AssetList />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PortfolioOverview