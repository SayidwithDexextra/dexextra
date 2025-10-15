'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

export interface UseWalletResult {
  address: string | null;
  isConnected: boolean;
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): UseWalletResult {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);

  // Initialize provider and check connection on mount
  useEffect(() => {
    const initProvider = async () => {
      // Check if window.ethereum is available
      if (typeof window !== 'undefined' && window.ethereum) {
        try {
          // Create provider
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(ethersProvider);
          
          // Check if already connected
          const accounts = await ethersProvider.listAccounts();
          if (accounts.length > 0) {
            const userSigner = await ethersProvider.getSigner();
            setAddress(await userSigner.getAddress());
            setSigner(userSigner);
            setIsConnected(true);
          }
        } catch (error) {
          console.error('Failed to initialize provider:', error);
        }
      }
    };

    initProvider();
  }, []);

  // Handle account changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = async (accounts: string[]) => {
        if (accounts.length > 0) {
          if (provider) {
            const userSigner = await provider.getSigner();
            setAddress(await userSigner.getAddress());
            setSigner(userSigner);
            setIsConnected(true);
          }
        } else {
          setAddress(null);
          setSigner(null);
          setIsConnected(false);
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [provider]);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!provider) {
      throw new Error('Provider not initialized');
    }

    try {
      // Request accounts
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      // Get signer and address
      const userSigner = await provider.getSigner();
      const userAddress = await userSigner.getAddress();
      
      // Update state
      setAddress(userAddress);
      setSigner(userSigner);
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [provider]);

  // Disconnect wallet (note: this doesn't actually disconnect the wallet, just clears the state)
  const disconnect = useCallback(() => {
    setAddress(null);
    setSigner(null);
    setIsConnected(false);
  }, []);

  return {
    address,
    isConnected,
    provider,
    signer,
    connect,
    disconnect
  };
}

export default useWallet;

// Add TypeScript interface for window.ethereum
declare global {
  interface Window {
    ethereum: any;
  }
}
