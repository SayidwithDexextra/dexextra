'use client';

import { useEffect, useState } from 'react';

interface NetworkWarningBannerProps {
  userAddress?: string | null;
}

export const NetworkWarningBanner = ({ userAddress }: NetworkWarningBannerProps) => {
  const [isCorrectNetwork, setIsCorrectNetwork] = useState<boolean>(true);
  const [networkName, setNetworkName] = useState<string>('');

  useEffect(() => {
    const checkNetwork = async () => {
      if (typeof window !== 'undefined' && window.ethereum && userAddress) {
        try {
          // Get current chain ID
          const chainId = await window.ethereum.request({ method: 'eth_chainId' });
          
          // HyperLiquid Mainnet chainId is 999 (0x3E7)
          const expectedChainId = '0x3e7';
          
          // Check if on correct network
          const correct = chainId.toLowerCase() === expectedChainId.toLowerCase();
          setIsCorrectNetwork(correct);
          
          // Get network name
          if (!correct) {
            // Map common chain IDs to names
            const networkNames: Record<string, string> = {
              '0x1': 'Ethereum Mainnet',
              '0x5': 'Goerli Testnet',
              '0x89': 'Polygon Mainnet',
              '0x13881': 'Mumbai Testnet',
              '0x3e7': 'HyperLiquid Mainnet'
            };
            
            setNetworkName(networkNames[chainId] || `Unknown Network (${chainId})`);
          } else {
            setNetworkName('HyperLiquid Mainnet');
          }
        } catch (error) {
          console.error('Failed to check network:', error);
          setIsCorrectNetwork(false);
        }
      }
    };

    checkNetwork();
  }, [userAddress]);

  // Only show warning if connected to wrong network
  if (isCorrectNetwork || !userAddress) {
    return null;
  }

  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-2 mb-3">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        <span className="text-[10px] text-yellow-400">
          Please switch to HyperLiquid Mainnet. Currently on {networkName}.
        </span>
      </div>
    </div>
  );
};

export default NetworkWarningBanner;
