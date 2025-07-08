'use client'

import { useState } from 'react'
import { TokenBalance } from '@/types/wallet'

interface TokenListProps {
  tokens: TokenBalance[]
  isLoading: boolean
  walletConnected: boolean
  onRefresh?: () => void
}

export default function TokenList({ 
  tokens, 
  isLoading, 
  walletConnected, 
  onRefresh 
}: TokenListProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    if (onRefresh && !refreshing) {
      setRefreshing(true)
      await onRefresh()
      setRefreshing(false)
    }
  }

  // Loading state
  if (isLoading && walletConnected && tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="relative">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
        <p className="mt-4 text-sm text-gray-400">
          Loading your token balances...
        </p>
      </div>
    )
  }

  // Empty state when wallet is not connected
  if (!walletConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">🔗</span>
        </div>
        <p className="text-sm text-gray-400 text-center">
          Connect your wallet to view token balances
        </p>
      </div>
    )
  }

  // Empty state when no tokens found
  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">🪙</span>
        </div>
        <p className="text-sm text-gray-400 text-center mb-4">
          No tokens found in your wallet
        </p>
        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {/* Refresh Button */}
      {onRefresh && (
        <div className="flex justify-between items-center px-4 py-2 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-300">
            Tokens ({tokens.length})
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg 
              className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Token List */}
      <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        {tokens.map((token, index) => (
          <TokenItem key={`${token.symbol}-${token.address}-${index}`} token={token} />
        ))}
      </div>
    </div>
  )
}

// Individual Token Item Component
function TokenItem({ token }: { token: TokenBalance }) {
  const getPercentageChangeColor = (change: number) => {
    if (change > 0) return 'text-green-400'
    if (change < 0) return 'text-red-400'
    return 'text-gray-400'
  }

  const getPercentageChangeText = (change: number) => {
    if (change === 0) return '0%'
    return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors">
      {/* Token Icon and Info */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-xl">
          {token.icon || '🪙'}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white text-sm">
              {token.symbol}
            </span>
            <span className="text-xs text-gray-400">
              {token.name}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{token.balanceFormatted}</span>
            {token.price && (
              <>
                <span>•</span>
                <span>${token.price.toFixed(token.price < 1 ? 6 : 2)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Value and Change */}
      <div className="flex flex-col items-end">
        <div className="text-sm font-medium text-white">
          {token.valueFormatted}
        </div>
        {token.changePercent24h !== undefined && (
          <div className={`text-xs ${getPercentageChangeColor(token.changePercent24h)}`}>
            {getPercentageChangeText(token.changePercent24h)}
          </div>
        )}
      </div>
    </div>
  )
} 