import { FC } from 'react'
import PortfolioValue from './PortfolioValue'
import PerformanceTabs from './PerformanceTabs'
import AssetList from './AssetList'

const PortfolioOverview: FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a1a] to-[#4a1a8b] p-8">
      <div className="container mx-auto max-w-4xl">
        <div className="space-y-6">
          {/* Portfolio Value Card */}
          <div className="rounded-2xl bg-gradient-to-br from-[#0F0F0F] to-[#2A2A2A] p-6 shadow-lg transition-all duration-200 hover:shadow-xl">
            <PortfolioValue />
          </div>
          
          {/* Asset List Section */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <PerformanceTabs />
            <AssetList />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PortfolioOverview
