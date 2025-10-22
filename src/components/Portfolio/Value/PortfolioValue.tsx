'use client'

import { FC, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { formatCurrency } from '@/utils/format'

export const PortfolioValue: FC = () => {
  const [isHidden, setIsHidden] = useState(false)
  const portfolioValue = 15571.50
  const performancePercentage = 16.0

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <h2 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
          Overview
        </h2>
        <div className="flex items-baseline gap-2">
          <h1 className="font-mono text-[11px] font-medium text-white">
            {isHidden ? '****' : formatCurrency(portfolioValue)}
          </h1>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-green-400">
              +{performancePercentage.toFixed(1)}%
            </span>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
          </div>
        </div>
      </div>
      
      <button
        onClick={() => setIsHidden(!isHidden)}
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-[#2A2A2A] rounded"
        aria-label={isHidden ? 'Show balance' : 'Hide balance'}
      >
        {isHidden ? <EyeOff className="w-3 h-3 text-[#606060]" /> : <Eye className="w-3 h-3 text-[#606060]" />}
      </button>
    </div>
  )
}

export default PortfolioValue