/**
 * 🔄 V1 Wallet Portfolio Hook (Database-based)
 * 
 * Provides wallet portfolio data using V1 database and Alchemy API.
 * Reverted from V2 contract calls to maintain compatibility with existing event database.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { env } from '@/lib/env';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

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
    return 'hyperliquid_testnet';
  }
  
  return 'hyperliquid_testnet'; // Default to hyperliquid_testnet
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
      console.log('🔄 Fetching on-chain portfolio for wallet (HyperLiquid Testnet):', walletAddress);

      const provider = new ethers.JsonRpcProvider(env.RPC_URL, env.CHAIN_ID);

      // Minimal ERC20 ABI
      const ERC20_ABI = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
      ];

      const mockUsdcAddress = (CONTRACT_ADDRESSES as any).mockUSDC || (CONTRACT_ADDRESSES as any).MOCK_USDC;
      if (!mockUsdcAddress || mockUsdcAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('MockUSDC address not configured');
      }

      const mockUsdc = new ethers.Contract(mockUsdcAddress, ERC20_ABI, provider);
      const [rawBalance, decimals, symbol, name] = await Promise.all([
        mockUsdc.balanceOf(walletAddress),
        mockUsdc.decimals(),
        mockUsdc.symbol().catch(() => 'MOCK_USDC'),
        mockUsdc.name().catch(() => 'HyperLiquid Mock USDC'),
      ]);

      const balanceNum = parseFloat(ethers.formatUnits(rawBalance, Number(decimals)));
      const valueUsd = balanceNum; // 1:1 assumption for stablecoin

      const token: TokenInfo = {
        id: mockUsdcAddress,
        symbol: symbol || 'MOCK_USDC',
        name: name || 'HyperLiquid Mock USDC',
        amount: `${formatBalance(balanceNum)} ${symbol || 'MOCK_USDC'}`,
        value: `$${formatBalance(valueUsd, 2)}`,
        network: 'hyperliquid_testnet',
        contractAddress: mockUsdcAddress,
        decimals: Number(decimals),
        isLowBalance: balanceNum < 50,
        icon: getTokenIcon(symbol || 'MOCK_USDC'),
        networkIcon: undefined,
      };

      setData({
        tokens: [token],
        summary: {
          totalValue: formatBalance(valueUsd, 2),
          profitLoss: '0.00',
          profitLossPercentage: '0.00',
        },
        isLoading: false,
        error: null,
      });

      console.log('✅ On-chain portfolio data processed successfully');
    } catch (error) {
      console.error('❌ On-chain portfolio fetch failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setData(prev => ({ ...prev, isLoading: false, error: errorMessage }));
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