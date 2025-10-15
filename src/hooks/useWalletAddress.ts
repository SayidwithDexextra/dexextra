'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from './useWallet';

export interface UseWalletAddressResult {
  walletAddress: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectWallet: () => Promise<boolean>;
  disconnectWallet: () => void;
}

export function useWalletAddress(): UseWalletAddressResult {
  const { address, isConnected, connect, disconnect } = useWallet();
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  const connectWallet = useCallback(async (): Promise<boolean> => {
    try {
      setIsConnecting(true);
      await connect();
      return true;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [connect]);

  const disconnectWallet = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return {
    walletAddress: address,
    isConnected,
    isConnecting,
    connectWallet,
    disconnectWallet
  };
}

export default useWalletAddress;
