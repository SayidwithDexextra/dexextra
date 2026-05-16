'use client'

import React from 'react'
import { useNetworkGuard } from '@/hooks/useNetworkGuard'

interface NetworkSwitchOverlayProps {
  children: React.ReactNode
  mode?: 'overlay' | 'inline' | 'banner'
  showWhenDisconnected?: boolean
}

const NETWORK_ICONS: Record<number, string> = {
  999: '/chains/hyperliquid.svg',
  998: '/chains/hyperliquid.svg',
  42161: '/chains/arbitrum.svg',
  1: '/chains/ethereum.svg',
  137: '/chains/polygon.svg',
}

export function NetworkSwitchOverlay({ 
  children, 
  mode = 'overlay',
  showWhenDisconnected = false 
}: NetworkSwitchOverlayProps) {
  const {
    isConnected,
    isOnCorrectNetwork,
    isSwitching,
    walletChainId,
    expectedChainId,
    networkName,
    error,
    switchNetwork,
    dismissError,
  } = useNetworkGuard()

  // Don't show overlay if wallet is not connected (unless explicitly requested)
  if (!showWhenDisconnected && !isConnected) {
    return <>{children}</>
  }

  // If connected and on correct network, show children normally
  if (isOnCorrectNetwork) {
    return <>{children}</>
  }
  
  // Log for debugging
  console.log('[NetworkSwitchOverlay] Showing overlay:', { isConnected, walletChainId, expectedChainId, isOnCorrectNetwork })

  const currentNetworkName = walletChainId 
    ? getNetworkName(walletChainId) 
    : 'Unknown Network'

  const handleSwitch = async () => {
    dismissError()
    await switchNetwork()
  }

  if (mode === 'banner') {
    return (
      <>
        <NetworkBanner
          currentNetwork={currentNetworkName}
          targetNetwork={networkName}
          isSwitching={isSwitching}
          error={error}
          onSwitch={handleSwitch}
          onDismissError={dismissError}
        />
        {children}
      </>
    )
  }

  if (mode === 'inline') {
    return (
      <NetworkInlineBlock
        currentNetwork={currentNetworkName}
        targetNetwork={networkName}
        expectedChainId={expectedChainId}
        isSwitching={isSwitching}
        error={error}
        onSwitch={handleSwitch}
        onDismissError={dismissError}
      />
    )
  }

  return (
    <div className="relative">
      {children}
      <NetworkOverlayModal
        currentNetwork={currentNetworkName}
        targetNetwork={networkName}
        expectedChainId={expectedChainId}
        isSwitching={isSwitching}
        error={error}
        onSwitch={handleSwitch}
        onDismissError={dismissError}
      />
    </div>
  )
}

function getNetworkName(chainId: number): string {
  const names: Record<number, string> = {
    999: 'Hyperliquid',
    998: 'Hyperliquid Testnet',
    42161: 'Arbitrum One',
    1: 'Ethereum',
    137: 'Polygon',
    10: 'Optimism',
    8453: 'Base',
    56: 'BNB Chain',
    43114: 'Avalanche',
  }
  return names[chainId] || `Chain ${chainId}`
}

interface NetworkUIProps {
  currentNetwork: string
  targetNetwork: string
  expectedChainId?: number
  isSwitching: boolean
  error: string | null
  onSwitch: () => void
  onDismissError: () => void
}

function NetworkOverlayModal({
  currentNetwork,
  targetNetwork,
  expectedChainId,
  isSwitching,
  error,
  onSwitch,
  onDismissError,
}: NetworkUIProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-lg">
      <div className="bg-[#1a1a2e] border border-yellow-500/30 rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Wrong Network</h3>
            <p className="text-sm text-gray-400">Switch to {targetNetwork} to trade</p>
          </div>
        </div>

        <div className="bg-black/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Current</span>
            <span className="text-sm font-medium text-red-400">{currentNetwork}</span>
          </div>
          <div className="flex items-center justify-center my-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Required</span>
            <span className="text-sm font-medium text-green-400">{targetNetwork}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-400">{error}</p>
            <button 
              onClick={onDismissError}
              className="text-xs text-red-300 hover:text-red-200 mt-1 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <button
          onClick={onSwitch}
          disabled={isSwitching}
          className="w-full py-3 px-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 disabled:from-gray-600 disabled:to-gray-600 text-black font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
        >
          {isSwitching ? (
            <>
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Switching...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Switch to {targetNetwork}
            </>
          )}
        </button>

        <p className="text-xs text-gray-500 text-center mt-3">
          Your wallet will prompt you to switch networks
        </p>
      </div>
    </div>
  )
}

function NetworkInlineBlock({
  currentNetwork,
  targetNetwork,
  isSwitching,
  error,
  onSwitch,
  onDismissError,
}: NetworkUIProps) {
  return (
    <div className="bg-[#1a1a2e] border border-yellow-500/30 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">Wrong Network Detected</h3>
          <p className="text-sm text-gray-400">
            You're on <span className="text-red-400">{currentNetwork}</span>, but trading requires <span className="text-green-400">{targetNetwork}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-400">{error}</p>
          <button 
            onClick={onDismissError}
            className="text-xs text-red-300 hover:text-red-200 mt-1 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <button
        onClick={onSwitch}
        disabled={isSwitching}
        className="w-full py-3 px-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 disabled:from-gray-600 disabled:to-gray-600 text-black font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
      >
        {isSwitching ? (
          <>
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Switching Network...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch to {targetNetwork}
          </>
        )}
      </button>
    </div>
  )
}

function NetworkBanner({
  currentNetwork,
  targetNetwork,
  isSwitching,
  error,
  onSwitch,
  onDismissError,
}: NetworkUIProps) {
  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-3">
      <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm text-yellow-200">
            Wrong network: <span className="text-red-400">{currentNetwork}</span> → Switch to <span className="text-green-400">{targetNetwork}</span> to trade
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {error && (
            <button 
              onClick={onDismissError}
              className="text-xs text-red-400 hover:text-red-300"
              title={error}
            >
              Error
            </button>
          )}
          <button
            onClick={onSwitch}
            disabled={isSwitching}
            className="px-4 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 text-black text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {isSwitching ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Switching...
              </>
            ) : (
              'Switch Network'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NetworkSwitchOverlay
