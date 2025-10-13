/**
 * 🔄 V1 Wallet Portfolio Hook (Database-based)
 * 
 * Provides wallet portfolio data using V1 database and Alchemy API.
 * Reverted from V2 contract calls to maintain compatibility with existing event database.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

// ==========================================
// 🏷️ V1 INTERFACES & TYPES
// ==========================================

export interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
  error?: string;
}

export interface AlchemyTokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logo?: string;
}

export interface AlchemyApiResponse {
  tokenBalances: AlchemyTokenBalance[];
  tokenMetadata: { [contractAddress: string]: AlchemyTokenMetadata };
}

// Token interface matching DepositModal expectations
export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  amount: string;        // Formatted balance with symbol (e.g., "100.00 USDC")
  value: string;         // USD value (e.g., "$100.00")
  network?: string;
  contractAddress: string;
  decimals: number;
  isLowBalance?: boolean;
  icon: string;
  networkIcon?: string;
}

export interface PortfolioSummary {
  totalValue: string;         // Total USD value (e.g., "1234.56")
  profitLoss: string;         // Profit/loss amount (calculated from token values)
  profitLossPercentage: string; // Profit/loss percentage
}

export interface WalletPortfolioData {
  tokens: TokenInfo[];
  summary: PortfolioSummary;
  isLoading: boolean;
  error: string | null;
}

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================

// Convert hex balance to decimal
function hexToDecimal(hexBalance: string, decimals: number): number {
  if (!hexBalance || hexBalance === '0x0') return 0;
  const balance = parseInt(hexBalance, 16);
  return balance / Math.pow(10, decimals);
}

// Format balance with proper decimals
function formatBalance(balance: number, decimals: number = 2): string {
  if (balance < 0.01 && balance > 0) {
    return '< 0.01';
  }
  return balance.toFixed(decimals);
}

// Get token icon from symbol
function getTokenIcon(symbol: string): string {
  const iconMap: { [key: string]: string } = {
    'USDC': 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg',
    'USDT': 'https://cryptologos.cc/logos/tether-usdt-logo.svg',
    'DAI': 'https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.svg',
    'MOCK_USDC': 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg',
  };
  return iconMap[symbol] || 'https://via.placeholder.com/32/888888/ffffff?text=?';
}

// Get network name from contract address (simplified)
function getNetworkFromContract(contractAddress: string): string {
  // Known Polygon addresses (lowercase for comparison)
  const polygonAddresses = [
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase(), // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'.toLowerCase(), // USDT
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'.toLowerCase(), // DAI
    '0xA2258Ff3aC4f5c77ca17562238164a0205A5b289'.toLowerCase(), // MockUSDC (HyperLiquid)
  ];
  
  if (polygonAddresses.includes(contractAddress.toLowerCase())) {
    return 'polygon';
  }
  
  return 'polygon'; // Default to polygon
}

// V1 stablecoin addresses for price estimation (lowercase for comparison)
const STABLECOIN_ADDRESSES = [
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase(), // USDC
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'.toLowerCase(), // USDT
  '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'.toLowerCase(), // DAI
  '0xA2258Ff3aC4f5c77ca17562238164a0205A5b289'.toLowerCase(), // MockUSDC (HyperLiquid)
];

// ==========================================
// 🎣 MAIN HOOK
// ==========================================

export function useWalletPortfolio(walletAddress?: string): WalletPortfolioData {
  const [data, setData] = useState<WalletPortfolioData>({
    tokens: [],
    summary: {
      totalValue: '0.00',
      profitLoss: '0.00',
      profitLossPercentage: '0.00'
    },
    isLoading: false,
    error: null
  });

  // ==========================================
  // 📊 V1 PORTFOLIO DATA FETCHING
  // ==========================================

  const fetchPortfolioData = useCallback(async () => {
    if (!walletAddress) {
      console.log('⚠️ No wallet address provided');
      return;
    }

    setData(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log('🔄 Fetching V1 portfolio for wallet:', walletAddress);

      // Call V1 portfolio API (Alchemy-based)
      const response = await fetch(`/api/wallet/portfolio?address=${encodeURIComponent(walletAddress!)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as { success: boolean; data: AlchemyApiResponse; message?: string };
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to fetch portfolio');
      }

      console.log('📊 V1 Portfolio data received:', result.data);

      const { tokenBalances, tokenMetadata }: AlchemyApiResponse = result.data;

      // Process tokens
      const processedTokens: TokenInfo[] = tokenBalances
        .filter(token => !token.error && token.tokenBalance !== '0x0')
        .map(token => {
          const metadata = tokenMetadata[token.contractAddress];
          if (!metadata) return null;

          const balance = hexToDecimal(token.tokenBalance, metadata.decimals);
          const isStablecoin = STABLECOIN_ADDRESSES.includes(token.contractAddress.toLowerCase());
          const value = isStablecoin ? balance : balance; // Assume 1:1 for now, could add price API

          return {
            id: token.contractAddress,
            symbol: metadata.symbol,
            name: metadata.name,
            amount: `${formatBalance(balance)} ${metadata.symbol}`,
            value: `$${formatBalance(value, 2)}`,
            network: getNetworkFromContract(token.contractAddress),
            contractAddress: token.contractAddress,
            decimals: metadata.decimals,
            isLowBalance: balance < 50,
            icon: getTokenIcon(metadata.symbol),
            networkIcon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiM4MjQ3RTUiLz4KPHBhdGggZD0iTTkgMTZMMTcgMjQgMjMgMTYgMTcgOCA5IDE2WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+'
          };
        })
        .filter((token): token is TokenInfo => token !== null);

      // Calculate totals
      const totalValue = processedTokens.reduce((sum: number, token: TokenInfo) => {
        const value = parseFloat(token.value.replace('$', ''));
        return sum + (isNaN(value) ? 0 : value);
      }, 0);

      // Simple P&L calculation (could be enhanced with historical data)
      const profitLoss = 0; // Would need historical data for accurate P&L
      const profitLossPercentage = totalValue > 0 ? ((profitLoss / totalValue) * 100).toFixed(2) : '0';

      setData({
        tokens: processedTokens,
        summary: {
          totalValue: formatBalance(totalValue, 2),
          profitLoss: formatBalance(profitLoss, 2),
          profitLossPercentage
        },
        isLoading: false,
        error: null
      });

      console.log('✅ V1 Portfolio data processed successfully');

    } catch (error) {
      console.error('❌ V1 Portfolio fetch failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setData(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
    }
  }, [walletAddress]);

  // ==========================================
  // 🔄 EFFECTS
  // ==========================================

  useEffect(() => {
    if (walletAddress) {
      fetchPortfolioData();
    }
  }, [walletAddress, fetchPortfolioData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!walletAddress) return;

    const interval = setInterval(() => {
      fetchPortfolioData();
    }, 30000);

    return () => clearInterval(interval);
  }, [walletAddress, fetchPortfolioData]);

  // ==========================================
  // 📤 RETURN HOOK INTERFACE
  // ==========================================

  return data;
} 