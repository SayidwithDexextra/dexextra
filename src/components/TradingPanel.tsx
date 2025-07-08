'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';

interface TradingPanelProps {
  tokenData: TokenData;
}

export default function TradingPanel({ tokenData }: TradingPanelProps) {
  const [activeTab, setActiveTab] = useState<'swap' | 'buy'>('swap');
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  return (
    <div className="bg-[#1A1A1A] rounded-xl p-6">
      {/* Tab Navigation */}
      <div className="flex mb-6">
        <button
          onClick={() => setActiveTab('swap')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'swap' 
              ? 'bg-[#2A2A2A] text-white' 
              : 'text-[#808080] hover:text-white'
          }`}
        >
          Swap
        </button>
        <button
          onClick={() => setActiveTab('buy')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'buy' 
              ? 'bg-[#2A2A2A] text-white' 
              : 'text-[#808080] hover:text-white'
          }`}
        >
          Buy
        </button>
      </div>

      {/* Sell Section */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-[#808080] mb-2">
          Sell
        </label>
        <div className="relative">
          <input
            type="number"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-[#2A2A2A] border border-[#333333] rounded-lg px-4 py-3 text-white text-2xl font-medium focus:outline-none focus:border-[#4A90E2] focus:ring-2 focus:ring-[#4A90E2]/20"
          />
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
            <Image 
              src="/globe.svg" 
              alt="SOL" 
              width={24}
              height={24}
              className="w-6 h-6 rounded-full"
            />
            <span className="text-white font-medium">SOL</span>
            <button className="text-[#808080] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="flex justify-between items-center mt-2 text-sm text-[#808080]">
          <span>$0.00</span>
          <span>0.00 SOL</span>
          <button className="text-[#4A90E2] hover:text-[#6BB6FF]">Max</button>
        </div>
      </div>

      {/* Swap Direction Button */}
      <div className="flex justify-center mb-6">
        <button className="bg-[#2A2A2A] hover:bg-[#3A3A3A] border border-[#333333] rounded-full p-2 transition-colors">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-[#808080]">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"/>
          </svg>
        </button>
      </div>

      {/* Buy Section */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-[#808080] mb-2">
          Buy
        </label>
        <div className="relative">
          <input
            type="number"
            value={buyAmount}
            onChange={(e) => setBuyAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-[#2A2A2A] border border-[#333333] rounded-lg px-4 py-3 text-white text-2xl font-medium focus:outline-none focus:border-[#4A90E2] focus:ring-2 focus:ring-[#4A90E2]/20"
          />
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
            {tokenData.logo && (
              <Image 
                src={tokenData.logo} 
                alt={tokenData.symbol} 
                width={24}
                height={24}
                className="w-6 h-6 rounded-full"
              />
            )}
            <span className="text-white font-medium">{tokenData.symbol}</span>
            <button className="text-[#808080] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="flex justify-between items-center mt-2 text-sm text-[#808080]">
          <span>$0.00</span>
          <span>0.00 {tokenData.symbol}</span>
        </div>
      </div>

      {/* Connect Wallet Button */}
      {!isConnected ? (
        <button 
          onClick={() => setIsConnected(true)}
          className="w-full bg-[#4A90E2] hover:bg-[#6BB6FF] text-white font-medium py-3 rounded-lg transition-colors"
        >
          Connect {tokenData.chain} Wallet
        </button>
      ) : (
        <div className="space-y-3">
          <button className="w-full bg-[#4A90E2] hover:bg-[#6BB6FF] text-white font-medium py-3 rounded-lg transition-colors">
            {activeTab === 'swap' ? 'Swap' : 'Buy'} {tokenData.symbol}
          </button>
          <div className="text-xs text-[#808080] space-y-1">
            <div className="flex justify-between">
              <span>Rate:</span>
              <span>1 SOL = {(tokenData.price * 200).toFixed(2)} {tokenData.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span>Fee:</span>
              <span>0.3%</span>
            </div>
            <div className="flex justify-between">
              <span>Slippage:</span>
              <span>0.5%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 