import React from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';

interface TokenHeaderProps {
  tokenData: TokenData;
}

export default function TokenHeader({ tokenData }: TokenHeaderProps) {
  const isPositive = tokenData.priceChange24h >= 0;
  
  return (
    <div className="bg-[#0A0A0A] border-b border-[#333333] px-8 py-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between">
          {/* Token Info */}
          <div className="flex items-center gap-4">
            {tokenData.logo && (
              <Image 
                src={tokenData.logo} 
                alt={tokenData.name}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full"
              />
            )}
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1">
                {tokenData.name}
              </h1>
              <div className="flex items-center gap-2 text-[#808080] text-sm">
                <span className="bg-[#2A2A2A] px-2 py-1 rounded text-xs">
                  {tokenData.symbol}
                </span>
                <span className="bg-[#2A2A2A] px-2 py-1 rounded text-xs">
                  {tokenData.chain}
                </span>
                <span className="bg-[#2A2A2A] px-2 py-1 rounded text-xs">
                  TOKEN
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button className="text-[#808080] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3L13 6H11V10H9V6H7L10 3Z"/>
                <path d="M4 12H16V14H4V12Z"/>
              </svg>
            </button>
            <button className="text-[#808080] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"/>
              </svg>
            </button>
            <button className="text-[#808080] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Price Info */}
        <div className="flex items-baseline gap-4 mt-4">
          <span className="text-4xl font-bold text-white">
            ${tokenData.price.toFixed(tokenData.price < 1 ? 5 : 2)}
          </span>
          <span className={`text-lg font-medium ${isPositive ? 'text-[#00D084]' : 'text-[#FF4747]'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(tokenData.priceChange24h).toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
} 