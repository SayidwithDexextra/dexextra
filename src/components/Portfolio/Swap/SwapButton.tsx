'use client'

import { FC } from 'react'
import { ArrowLeftRight } from 'lucide-react'

export const SwapButton: FC = () => {
  return (
    <button className="group w-full flex items-center justify-center gap-1.5 p-1 rounded bg-[#2A2A2A] hover:bg-[#333333] transition-all duration-200">
      <ArrowLeftRight className="w-3 h-3 text-[#808080]" />
      <span className="text-[10px] text-[#808080]">Swap money</span>
    </button>
  )
}

export default SwapButton