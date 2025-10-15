import { useState, useEffect } from 'react';
import { useWallet } from './useWallet.tsx';
import { initializeContracts } from '@/lib/contracts';
import { ethers } from 'ethers';

export interface MarginSummary {
  totalCollateral: number;
  lockedCollateral: number;
  availableCollateral: number;
  totalMarginUsed: number;
  unrealizedPnL: number;
  realizedPnL: number;
  marginUtilization: number;
  isHealthy: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useMarginSummary(): MarginSummary {
  const { walletData } = useWallet();
  const [contracts, setContracts] = useState<any>(null);
  const [summary, setSummary] = useState<MarginSummary>({
    totalCollateral: 0,
    lockedCollateral: 0,
    availableCollateral: 0,
    totalMarginUsed: 0,
    unrealizedPnL: 0,
    realizedPnL: 0,
    marginUtilization: 0,
    isHealthy: true,
    isLoading: true,
    error: null
  });

  // Initialize contracts when wallet is connected
  useEffect(() => {
    const init = async () => {
      if (!walletData.isConnected) {
        setSummary(prev => ({ ...prev, error: 'Wallet not connected', isLoading: false }));
        return;
      }

      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum)
        const signer = await provider.getSigner()
        const contractInstances = await initializeContracts(signer);
        setContracts(contractInstances);
      } catch (error: any) {
        console.error('Failed to initialize contracts:', error);
        setSummary(prev => ({ ...prev, error: 'Failed to initialize contracts', isLoading: false }));
      }
    };

    init();
  }, [walletData.isConnected, walletData.signer]);

  // Fetch margin summary and set up polling
  useEffect(() => {
    if (!contracts || !walletData.address) return;

    const fetchMarginSummary = async () => {
      try {
        // Get unified margin summary from CoreVault
        const [
          totalCollateral,
          marginUsed,
          marginReserved,
          availableCollateral,
          realizedPnL,
          unrealizedPnL,
          _totalCommitted,
          isHealthy
        ] = await contracts.vault.getUnifiedMarginSummary(walletData.address);

        setSummary({
          totalCollateral: parseFloat(ethers.formatUnits(totalCollateral, 6)),
          lockedCollateral: parseFloat(ethers.formatUnits(marginReserved, 6)),
          availableCollateral: parseFloat(ethers.formatUnits(availableCollateral, 6)),
          totalMarginUsed: parseFloat(ethers.formatUnits(marginUsed, 6)),
          unrealizedPnL: parseFloat(ethers.formatUnits(unrealizedPnL, 6)),
          realizedPnL: parseFloat(ethers.formatUnits(realizedPnL, 6)),
          marginUtilization: 0,
          isHealthy,
          isLoading: false,
          error: null
        });
      } catch (error: any) {
        console.error('Failed to fetch margin summary:', error);
        setSummary(prev => ({ ...prev, error: 'Failed to fetch margin summary', isLoading: false }));
      }
    };

    // Initial fetch
    fetchMarginSummary();

    // Poll every 2 seconds
    const interval = setInterval(fetchMarginSummary, 2000);

    return () => clearInterval(interval);
  }, [contracts, walletData.address]);

  return summary;
}
