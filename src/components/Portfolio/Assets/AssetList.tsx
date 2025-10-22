'use client'

import { FC } from 'react'
import Image from 'next/image'
import { SwapButton } from '../Swap'

interface Asset {
  symbol: string
  name: string
  logo: string
  value: number
  performance: number
}

const mockAssets: Asset[] = [
  {
    symbol: 'TSLA',
    name: 'Tesla',
    logo: '/Dexicon/tesla.png',
    value: 8295.40,
    performance: 5.05
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    logo: '/Dexicon/microsoft.png',
    value: 4294.20,
    performance: 4.45
  },
  {
    symbol: 'NVDA',
    name: 'Nvidia',
    logo: '/Dexicon/nvidia.png',
    value: 1295.85,
    performance: 3.61
  },
  {
    symbol: 'AAPL',
    name: 'Apple',
    logo: '/Dexicon/apple.png',
    value: 859.40,
    performance: 3.45
  },
  {
    symbol: 'SPOT',
    name: 'Spotify',
    logo: '/Dexicon/spotify.png',
    value: 205.00,
    performance: 2.24
  }
]

export const AssetList: FC = () => {
  return (
    <div className="flex flex-col h-full">
      <div className="space-y-0.5">
        {mockAssets.map((asset) => (
          <div
            key={asset.symbol}
            className="group flex items-center justify-between px-2 py-1.5 hover:bg-[#2A2A2A] transition-all duration-200"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
                <Image
                  src={asset.logo}
                  alt={asset.name}
                  width={20}
                  height={20}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1">
                  <span className="text-[11px] font-medium text-white">
                    {asset.name}
                  </span>
                  <span className="text-[9px] text-[#606060]">
                    {asset.symbol}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="text-right">
                <p className="text-[10px] font-mono text-white">
                  ${asset.value.toLocaleString()}
                </p>
                <p className="text-[9px] text-green-400">
                  +{asset.performance}%
                </p>
              </div>
              <div className="w-1 h-1 rounded-full bg-green-400 flex-shrink-0" />
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-auto p-2 border-t border-[#222222]">
        <SwapButton />
      </div>
    </div>
  )
}

export default AssetList