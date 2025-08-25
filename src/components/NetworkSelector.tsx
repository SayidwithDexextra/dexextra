'use client';

import React, { useState, useEffect } from 'react';
// Removed networks import - smart contract functionality deleted
import { getCurrentNetwork, switchNetwork, getChainId } from '@/lib/wallet';

interface NetworkSelectorProps {
  onNetworkChange?: (network: NetworkConfig) => void;
  showTestnets?: boolean;
  compact?: boolean;
}

const NetworkSelector: React.FC<NetworkSelectorProps> = ({ 
  onNetworkChange, 
  showTestnets = false,
  compact = false 
}) => {
  const [currentNetwork, setCurrentNetwork] = useState<NetworkConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current network on mount
  useEffect(() => {
    loadCurrentNetwork();
  }, []);

  const loadCurrentNetwork = async () => {
    try {
      const network = await getCurrentNetwork();
      setCurrentNetwork(network);
      setError(null);
    } catch (error) {
      console.error('Error loading current network:', error);
      setError('Unable to detect current network');
    }
  };

  const handleNetworkSwitch = async (network: NetworkConfig) => {
    setIsSwitching(true);
    setError(null);
    
    try {
       console.log('Switching to network:', network.displayName);
      await switchNetwork(network);
      
      // Wait a bit for the switch to complete
      setTimeout(async () => {
        await loadCurrentNetwork();
        setIsSwitching(false);
        setIsOpen(false);
        
        if (onNetworkChange) {
          onNetworkChange(network);
        }
      }, 1000);
      
    } catch (error: any) {
      console.error('Network switch failed:', error);
      setError(error.message || 'Network switch failed');
      setIsSwitching(false);
    }
  };

  // Filter networks based on showTestnets preference
  const availableNetworks = Object.values(NETWORKS).filter(network => {
    if (showTestnets) return true;
    return network.isMainnet;
  });

  // Sort networks: Polygon first, then Ethereum, then others
  const sortedNetworks = availableNetworks.sort((a, b) => {
    if (a.name === 'polygon') return -1;
    if (b.name === 'polygon') return 1;
    if (a.name === 'ethereum') return -1;
    if (b.name === 'ethereum') return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const NetworkOption = ({ network }: { network: NetworkConfig }) => (
    <button
      onClick={() => handleNetworkSwitch(network)}
      disabled={isSwitching || currentNetwork?.chainId === network.chainId}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
        currentNetwork?.chainId === network.chainId 
          ? 'bg-blue-50 text-blue-600 font-medium' 
          : 'text-gray-700'
      } ${isSwitching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="text-lg">{network.icon}</span>
      <div className="flex-1">
        <div className="font-medium">{network.displayName}</div>
        <div className="text-xs text-gray-500">
          Chain ID: {network.chainId} • {network.nativeCurrency.symbol}
        </div>
      </div>
      {currentNetwork?.chainId === network.chainId && (
        <span className="text-green-500 text-sm">✓</span>
      )}
    </button>
  );

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {currentNetwork ? (
            <>
              <span>{currentNetwork.icon}</span>
              <span className="text-sm font-medium">{currentNetwork.nativeCurrency.symbol}</span>
            </>
          ) : (
            <span className="text-sm text-gray-500">Select Network</span>
          )}
          <svg 
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
            <div className="py-2">
              {sortedNetworks.map((network) => (
                <NetworkOption key={network.chainId} network={network} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Network</h3>
        {error && (
          <span className="text-red-500 text-sm">{error}</span>
        )}
      </div>

      {/* Current Network Display */}
      {currentNetwork ? (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <span className="text-xl">{currentNetwork.icon}</span>
            <div>
              <div className="font-medium text-gray-800">{currentNetwork.displayName}</div>
              <div className="text-sm text-gray-600">
                Chain ID: {currentNetwork.chainId} • {currentNetwork.nativeCurrency.symbol}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="text-yellow-700 text-sm">
            {error || 'No network detected. Please connect your wallet.'}
          </div>
        </div>
      )}

      {/* Quick Switch Buttons */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-gray-700 mb-2">Quick Switch:</div>
        
        <button
          onClick={() => handleNetworkSwitch(NETWORKS.polygon)}
          disabled={isSwitching || currentNetwork?.chainId === 137}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            currentNetwork?.chainId === 137
              ? 'bg-purple-50 text-purple-600 border border-purple-200'
              : 'bg-gray-50 hover:bg-purple-50 border border-gray-200 hover:border-purple-200'
          } ${isSwitching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-lg">🟣</span>
          <div className="flex-1 text-left">
            <div className="font-medium">Polygon Mainnet</div>
            <div className="text-xs text-gray-500">Low fees • Fast transactions</div>
          </div>
          {currentNetwork?.chainId === 137 && <span className="text-green-500">✓</span>}
        </button>

        <button
          onClick={() => handleNetworkSwitch(NETWORKS.ethereum)}
          disabled={isSwitching || currentNetwork?.chainId === 1}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            currentNetwork?.chainId === 1
              ? 'bg-blue-50 text-blue-600 border border-blue-200'
              : 'bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200'
          } ${isSwitching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-lg">⟠</span>
          <div className="flex-1 text-left">
            <div className="font-medium">Ethereum Mainnet</div>
            <div className="text-xs text-gray-500">Most secure • Higher fees</div>
          </div>
          {currentNetwork?.chainId === 1 && <span className="text-green-500">✓</span>}
        </button>

        {showTestnets && (
          <>
            <button
              onClick={() => handleNetworkSwitch(NETWORKS.mumbai)}
              disabled={isSwitching || currentNetwork?.chainId === 80001}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                currentNetwork?.chainId === 80001
                  ? 'bg-purple-50 text-purple-600 border border-purple-200'
                  : 'bg-gray-50 hover:bg-purple-50 border border-gray-200 hover:border-purple-200'
              } ${isSwitching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-lg">🧪</span>
              <div className="flex-1 text-left">
                <div className="font-medium">Polygon Mumbai</div>
                <div className="text-xs text-gray-500">Testnet • Free MATIC</div>
              </div>
              {currentNetwork?.chainId === 80001 && <span className="text-green-500">✓</span>}
            </button>

            <button
              onClick={() => handleNetworkSwitch(NETWORKS.hardhat)}
              disabled={isSwitching || currentNetwork?.chainId === 31337}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                currentNetwork?.chainId === 31337
                  ? 'bg-yellow-50 text-yellow-600 border border-yellow-200'
                  : 'bg-gray-50 hover:bg-yellow-50 border border-gray-200 hover:border-yellow-200'
              } ${isSwitching ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="text-lg">🔨</span>
              <div className="flex-1 text-left">
                <div className="font-medium">Hardhat Local</div>
                <div className="text-xs text-gray-500">Development • localhost:8545</div>
              </div>
              {currentNetwork?.chainId === 31337 && <span className="text-green-500">✓</span>}
            </button>
          </>
        )}
      </div>

      {/* Toggle Testnets */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showTestnets}
            onChange={() => {/* This would be controlled by parent component */}}
            className="rounded"
          />
          Show testnets
        </label>
      </div>

      {/* Status */}
      {isSwitching && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-blue-700">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
            <span className="text-sm">Switching networks...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkSelector; 