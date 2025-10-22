'use client'

import { FC, useState } from 'react'

type PerformanceTab = 'top' | 'worst'

export const PerformanceTabs: FC = () => {
  const [activeTab, setActiveTab] = useState<PerformanceTab>('top')

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setActiveTab('top')}
        className={`text-[10px] px-1.5 py-0.5 rounded transition-all duration-200 ${
          activeTab === 'top'
            ? 'bg-[#2A2A2A] text-white'
            : 'text-[#606060] hover:text-[#808080]'
        }`}
      >
        Top performance
      </button>
      <button
        onClick={() => setActiveTab('worst')}
        className={`text-[10px] px-1.5 py-0.5 rounded transition-all duration-200 ${
          activeTab === 'worst'
            ? 'bg-[#2A2A2A] text-white'
            : 'text-[#606060] hover:text-[#808080]'
        }`}
      >
        Worst performance
      </button>
    </div>
  )
}

export default PerformanceTabs