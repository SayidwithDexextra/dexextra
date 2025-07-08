'use client';

import { useState, useEffect } from 'react';
import { TokenData } from '@/types/token';

interface UseTokenDataReturn {
  tokenData: TokenData | null;
  isLoading: boolean;
  error: string | null;
}

export function useTokenData(symbol: string): UseTokenDataReturn {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTokenData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Generate mock data based on the token symbol
        const mockData = generateMockTokenData(symbol);
        setTokenData(mockData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch token data');
      } finally {
        setIsLoading(false);
      }
    };

    if (symbol) {
      fetchTokenData();
    }
  }, [symbol]);

  return { tokenData, isLoading, error };
}

function generateMockTokenData(symbol: string): TokenData {
  // Generate consistent but random-looking data based on symbol
  const hash = hashCode(symbol);
  const random = (min: number, max: number) => {
    const seed = Math.abs(hash) % 1000;
    return min + (seed / 1000) * (max - min);
  };

  const price = random(0.0001, 10);
  const priceChange = random(-50, 300);
  const marketCap = random(1000000, 100000000);
  const volume = random(100000, 50000000);
  const marketCapChange = priceChange + random(-10, 10);

  // Map common token symbols to names and chains
  const tokenMap: Record<string, { name: string; chain: string; logo?: string }> = {
    'BTC': { name: 'Bitcoin', chain: 'BITCOIN', logo: '/bitcoin.png' },
    'ETH': { name: 'Ethereum', chain: 'ETHEREUM', logo: '/ethereum.png' },
    'SOL': { name: 'Solana', chain: 'SOLANA', logo: '/solana.png' },
    'USDC': { name: 'USD Coin', chain: 'ETHEREUM', logo: '/usdc.png' },
    'USDT': { name: 'Tether', chain: 'ETHEREUM', logo: '/usdt.png' },
    'DEGENAI': { name: 'Degen Spartan AI', chain: 'SOLANA', logo: '/degenai.png' },
    'PEPE': { name: 'Pepe', chain: 'ETHEREUM', logo: '/pepe.png' },
    'DOGE': { name: 'Dogecoin', chain: 'DOGECOIN', logo: '/doge.png' },
  };

  const tokenInfo = tokenMap[symbol.toUpperCase()] || {
    name: `${symbol.toUpperCase()} Token`,
    chain: 'SOLANA',
  };

  return {
    symbol: symbol.toUpperCase(),
    name: tokenInfo.name,
    price,
    priceChange24h: priceChange,
    marketCap,
    marketCapChange24h: marketCapChange,
    volume24h: volume,
    fullyDilutedValuation: marketCap * random(1, 2),
    chain: tokenInfo.chain,
    logo: tokenInfo.logo,
    description: `${tokenInfo.name} is a revolutionary cryptocurrency token.`,
    website: `https://${symbol.toLowerCase()}.com`,
    twitter: `https://twitter.com/${symbol.toLowerCase()}`,
    telegram: `https://t.me/${symbol.toLowerCase()}`,
    circulating_supply: random(1000000, 1000000000),
    total_supply: random(1000000000, 10000000000),
    max_supply: random(10000000000, 100000000000),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
} 