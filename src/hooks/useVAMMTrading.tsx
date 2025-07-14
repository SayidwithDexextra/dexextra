'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from './useWallet';
import { VAMMMarket } from './useVAMMMarkets';

// Contract ABIs
const VAMM_ABI = [
  "function openPosition(uint256 collateralAmount, bool isLong, uint256 leverage, uint256 minPrice, uint256 maxPrice) external returns (uint256 positionSize)",
  "function closePosition(uint256 sizeToClose, uint256 minPrice, uint256 maxPrice) external returns (int256 pnl)",
  "function getPosition(address user) external view returns (tuple(int256 size, uint256 entryPrice, uint256 entryFundingIndex, uint256 lastInteractionTime))",
  "function getMarkPrice() external view returns (uint256)",
  "function getFundingRate() external view returns (int256)",
  "function getUnrealizedPnL(address user) external view returns (int256)",
  "function getPriceImpact(uint256 size, bool isLong) external view returns (uint256)",
  "function updateFunding() external",
  "function vault() external view returns (address)",
  "function oracle() external view returns (address)",
  "function owner() external view returns (address)"
];

const ORACLE_ABI = [
  "function isActive() external view returns (bool)",
  "function maxPriceAge() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function getPrice() external view returns (uint256)"
];

const VAULT_ABI = [
  "function depositCollateral(address user, uint256 amount) external",
  "function withdrawCollateral(address user, uint256 amount) external",
  "function getMarginAccount(address user) external view returns (tuple(uint256 collateral, uint256 reservedMargin, int256 unrealizedPnL, uint256 lastFundingIndex))",
  "function getAvailableMargin(address user) external view returns (uint256)",
  "function getTotalMargin(address user) external view returns (int256)",
  "function collateralToken() external view returns (address)"
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

// Types
export interface Position {
  size: string; // Positive for long, negative for short
  entryPrice: string;
  entryFundingIndex: string;
  lastInteractionTime: string;
  unrealizedPnL: string;
  isLong: boolean;
  positionSizeUsd: string;
}

export interface MarginAccount {
  collateral: string;
  reservedMargin: string;
  unrealizedPnL: string;
  lastFundingIndex: string;
  availableMargin: string;
  totalMargin: string;
}

export interface VAMMTradingState {
  position: Position | null;
  positions: Position[]; // Array of positions for independent management
  marginAccount: MarginAccount | null;
  markPrice: string;
  fundingRate: string;
  collateralBalance: string;
  collateralAllowance: string;
  isLoading: boolean;
  error: string | null;
  isActive: boolean;
  maxPriceAge: string;
  owner: string;
}

export interface TradeParams {
  amount: number; // USD amount
  isLong: boolean;
  leverage: number;
  slippageTolerance: number; // Percentage (e.g., 0.5 for 0.5%)
}

export interface UseVAMMTradingReturn extends VAMMTradingState {
  openPosition: (params: TradeParams) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  closePosition: (sizePercent: number, slippageTolerance: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  closeSpecificPosition: (positionIndex: number, sizePercent: number, slippageTolerance: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  depositCollateral: (amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  withdrawCollateral: (amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  approveCollateral: (amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  refreshData: () => Promise<void>;
  forceRefresh: () => Promise<void>;
  clearPositionState: () => void;
  getPriceImpact: (amount: number, isLong: boolean, leverage: number) => Promise<string>;
}

export interface VAMMTradingOptions {
  enablePolling?: boolean;
  pollingInterval?: number;
  onlyPollWithPosition?: boolean;
}

// Helper function to wait for transaction with timeout and retry logic
async function waitForTransaction(tx: any, timeout: number = 120000): Promise<void> {
  try {
    await tx.wait(1, timeout); // Wait for 1 confirmation with custom timeout
  } catch (waitError: any) {
    // If wait times out, check if transaction was actually mined
    if (waitError.code === 'TIMEOUT' || waitError.message?.includes('timeout')) {
      console.warn('⚠️ Transaction wait timed out, checking if transaction was mined...');
      
      // Try to get transaction receipt manually
      if (!window.ethereum) {
        throw new Error('Ethereum provider not available');
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      let receipt = null;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts && !receipt) {
        try {
          receipt = await provider.getTransactionReceipt(tx.hash);
          if (receipt) {
            console.log('✅ Transaction was mined successfully after timeout');
            break;
          }
                    } catch (_receiptError) {
              console.log(`Attempt ${attempts + 1}: Transaction still pending...`);
            }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds between attempts
      }
      
      if (!receipt) {
        throw new Error('Transaction submitted but confirmation timeout. Please check your wallet for the transaction status.');
      }
    } else {
      throw waitError;
    }
  }
}

// Register VAMM contract for event monitoring
async function registerVAMMForEventMonitoring(vammAddress: string, vaultAddress: string, marketSymbol: string) {
  try {
    console.log('🔗 Registering VAMM contract for event monitoring:', vammAddress);
    
    const response = await fetch('/api/events/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contracts: [
          {
            name: `vAMM-${marketSymbol}`,
            address: vammAddress,
            type: 'vAMM',
            symbol: marketSymbol
          },
          {
            name: `Vault-${marketSymbol}`,
            address: vaultAddress,
            type: 'Vault',
            symbol: marketSymbol
          }
        ]
      }),
    });

    if (response.ok) {
      console.log('✅ VAMM contract registered for event monitoring');
    } else {
      console.warn('⚠️ Failed to register VAMM contract for event monitoring');
    }
  } catch (error) {
    console.error('❌ Error registering VAMM contract:', error);
  }
}

export function useVAMMTrading(vammMarket?: VAMMMarket, options?: VAMMTradingOptions): UseVAMMTradingReturn {
  const { 
    enablePolling = false, 
    pollingInterval = 30000, 
    onlyPollWithPosition = false 
  } = options || {};
  
  const { walletData } = useWallet();
  const [state, setState] = useState<VAMMTradingState>({
    position: null,
    positions: [],
    marginAccount: null,
    markPrice: '0',
    fundingRate: '0',
    collateralBalance: '0',
    collateralAllowance: '0',
    isLoading: true,
    error: null,
    isActive: false,
    maxPriceAge: '0',
    owner: '0x0000000000000000000000000000000000000000',
  });

  const [contractsReady, setContractsReady] = useState<boolean>(false);

  // Refs to store contract instances
  const vammContract = useRef<ethers.Contract | null>(null);
  const vaultContract = useRef<ethers.Contract | null>(null);
  const collateralContract = useRef<ethers.Contract | null>(null);
  const oracleContract = useRef<ethers.Contract | null>(null);
  const signer = useRef<ethers.Signer | null>(null);

  // Initialize contracts
  const initializeContracts = useCallback(async () => {
    if (!vammMarket?.vamm_address || !walletData.isConnected || !window.ethereum) {
      setContractsReady(false);
      return;
    }

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      setContractsReady(false);

      const provider = new ethers.BrowserProvider(window.ethereum);
      signer.current = await provider.getSigner();

      // Initialize vAMM contract
      vammContract.current = new ethers.Contract(
        vammMarket.vamm_address,
        VAMM_ABI,
        provider
      );

      // Get vault address and initialize vault contract
      const vaultAddress = vammMarket.vault_address || await vammContract.current.vault();
      vaultContract.current = new ethers.Contract(vaultAddress, VAULT_ABI, provider);

      // Get oracle address and initialize oracle contract
      const oracleAddress = vammMarket.oracle_address || await vammContract.current.oracle();
      oracleContract.current = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);

      // Get collateral token address and initialize collateral contract
      const collateralAddress = await vaultContract.current.collateralToken();
      collateralContract.current = new ethers.Contract(collateralAddress, ERC20_ABI, provider);

      // Mark contracts as ready
      setContractsReady(true);

      console.log('✅ VAMM contracts initialized:', {
        vamm: vammMarket.vamm_address,
        vault: vaultAddress,
        oracle: oracleAddress,
        collateral: collateralAddress,
      });

      // Register contracts for event monitoring
      await registerVAMMForEventMonitoring(
        vammMarket.vamm_address,
        vaultAddress,
        vammMarket.symbol
      );

    } catch (error) {
      console.error('❌ Error initializing contracts:', error);
      setContractsReady(false);
      setState(prev => ({ 
        ...prev, 
        error: 'Failed to initialize contracts',
        isLoading: false 
      }));
    }
  }, [vammMarket?.vamm_address, vammMarket?.vault_address, vammMarket?.symbol, walletData.isConnected]);

  // Refresh all contract data
  const refreshData = useCallback(async () => {
    if (!contractsReady || !vammContract.current || !vaultContract.current || !collateralContract.current || !oracleContract.current || !walletData.address) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      // Add small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

      const [
        positionData,
        marginAccountData,
        markPrice,
        fundingRate,
        collateralBalance,
        collateralAllowance,
        unrealizedPnL,
        isActive,
        maxPriceAge,
        owner
      ] = await Promise.allSettled([
        vammContract.current.getPosition(walletData.address),
        vaultContract.current.getMarginAccount(walletData.address),
        vammContract.current.getMarkPrice(),
        vammContract.current.getFundingRate(),
        collateralContract.current.balanceOf(walletData.address),
        collateralContract.current.allowance(walletData.address, await vaultContract.current.getAddress()),
        vammContract.current.getUnrealizedPnL(walletData.address),
        oracleContract.current.isActive(),
        oracleContract.current.maxPriceAge(),
        vammContract.current.owner()
      ]);

      console.log('positionData: ', positionData);
      console.log('marginAccountData: ', marginAccountData);
      console.log('markPrice: ', markPrice);
      console.log('fundingRate: ', fundingRate);
      console.log('collateralBalance: ', collateralBalance);
      console.log('collateralAllowance: ', collateralAllowance);
      console.log('unrealizedPnL: ', unrealizedPnL);
      console.log('isActive: ', isActive);
      console.log('maxPriceAge: ', maxPriceAge);
      console.log('owner: ', owner);  

      // Extract values with fallbacks for failed calls
      const positionResult = positionData.status === 'fulfilled' ? positionData.value : { size: BigInt(0), entryPrice: BigInt(0), entryFundingIndex: BigInt(0), lastInteractionTime: BigInt(0) };
      const marginAccountResult = marginAccountData.status === 'fulfilled' ? marginAccountData.value : { collateral: BigInt(0), reservedMargin: BigInt(0), unrealizedPnL: BigInt(0), lastFundingIndex: BigInt(0) };
      const markPriceValue = markPrice.status === 'fulfilled' ? markPrice.value : BigInt(0);
      const fundingRateValue = fundingRate.status === 'fulfilled' ? fundingRate.value : BigInt(0);
      const collateralBalanceValue = collateralBalance.status === 'fulfilled' ? collateralBalance.value : BigInt(0);
      const collateralAllowanceValue = collateralAllowance.status === 'fulfilled' ? collateralAllowance.value : BigInt(0);
      const unrealizedPnLValue = unrealizedPnL.status === 'fulfilled' ? unrealizedPnL.value : BigInt(0);
      const isActiveValue = isActive.status === 'fulfilled' ? isActive.value : false;
      const maxPriceAgeValue = maxPriceAge.status === 'fulfilled' ? maxPriceAge.value : BigInt(0);
      const ownerValue = owner.status === 'fulfilled' ? owner.value : '0x0000000000000000000000000000000000000000';

      // Log any failed calls
      if (positionData.status === 'rejected') console.warn('❌ Failed to get position:', positionData.reason);
      if (marginAccountData.status === 'rejected') console.warn('❌ Failed to get margin account:', marginAccountData.reason);
      if (markPrice.status === 'rejected') console.warn('❌ Failed to get mark price:', markPrice.reason);
      if (fundingRate.status === 'rejected') console.warn('❌ Failed to get funding rate:', fundingRate.reason);
      if (collateralBalance.status === 'rejected') console.warn('❌ Failed to get collateral balance:', collateralBalance.reason);
      if (collateralAllowance.status === 'rejected') console.warn('❌ Failed to get collateral allowance:', collateralAllowance.reason);
      if (unrealizedPnL.status === 'rejected') console.warn('❌ Failed to get unrealized PnL:', unrealizedPnL.reason);
      if (isActive.status === 'rejected') console.warn('❌ Failed to get isActive:', isActive.reason);
      if (maxPriceAge.status === 'rejected') console.warn('❌ Failed to get maxPriceAge:', maxPriceAge.reason);
      if (owner.status === 'rejected') console.warn('❌ Failed to get owner:', owner.reason);

      // Debug mark price formatting
      console.log('Raw markPrice:', markPriceValue.toString(), '→', ethers.formatEther(markPriceValue));

      // Process position data
      console.log('📊 Raw position data from contract:', {
        size: positionResult.size.toString(),
        entryPrice: positionResult.entryPrice.toString(), // Raw value for proper display
        entryFundingIndex: positionResult.entryFundingIndex.toString(),
        lastInteractionTime: positionResult.lastInteractionTime.toString(),
        unrealizedPnL: unrealizedPnLValue.toString(),
      });

      let position: Position | null = null;
      let positions: Position[] = [];
      
      // More robust position detection - check both size and entry price
      const hasPosition = positionResult.size !== BigInt(0) && positionResult.entryPrice !== BigInt(0);
      
      if (hasPosition) {
        const isLong = positionResult.size > BigInt(0);
        const positionSizeAbs = isLong ? positionResult.size : -positionResult.size;
        
        // Position size is already in the correct units from the contract
        // Calculate position size in USD by multiplying size by entry price
        const positionSizeUsdWei = positionSizeAbs * positionResult.entryPrice;

        position = {
          size: positionResult.size.toString(),
          entryPrice: positionResult.entryPrice.toString(), // Raw value for proper display
          entryFundingIndex: positionResult.entryFundingIndex.toString(),
          lastInteractionTime: positionResult.lastInteractionTime.toString(),
          unrealizedPnL: ethers.formatUnits(unrealizedPnLValue, 6), // USDC has 6 decimals, not 18
          isLong,
          positionSizeUsd: ethers.formatUnits(positionSizeUsdWei, 24), // Format as USDC: 18 (price precision) + 6 (USDC decimals)
        };

        // Add position to positions array for independent management
        positions = [position];

        console.log('✅ Active position detected:', position);
      } else {
        console.log('❌ No active position (size or entryPrice is zero)');
      }

      // Process margin account data - use fallback for failed calls
      let availableMargin = BigInt(0);
      let totalMargin = BigInt(0);
      
      try {
        availableMargin = await vaultContract.current.getAvailableMargin(walletData.address);
        totalMargin = await vaultContract.current.getTotalMargin(walletData.address);
      } catch (error) {
        console.warn('❌ Failed to get additional margin data:', error);
      }

      const marginAccount: MarginAccount = {
        collateral: ethers.formatUnits(marginAccountResult.collateral, 6), // USDC has 6 decimals
        reservedMargin: ethers.formatUnits(marginAccountResult.reservedMargin, 6), // USDC has 6 decimals
        unrealizedPnL: ethers.formatUnits(marginAccountResult.unrealizedPnL, 6), // USDC has 6 decimals
        lastFundingIndex: marginAccountResult.lastFundingIndex.toString(),
        availableMargin: ethers.formatUnits(availableMargin, 6), // USDC has 6 decimals
        totalMargin: ethers.formatUnits(totalMargin, 6), // USDC has 6 decimals
      };

      setState(prev => ({
        ...prev,
        position,
        positions,
        marginAccount,
        markPrice: ethers.formatEther(markPriceValue),
        fundingRate: fundingRateValue.toString(),
        collateralBalance: ethers.formatUnits(collateralBalanceValue, 6), // USDC has 6 decimals
        collateralAllowance: ethers.formatUnits(collateralAllowanceValue, 6), // USDC has 6 decimals
        isLoading: false,
        error: null,
        isActive: isActiveValue,
        maxPriceAge: maxPriceAgeValue.toString(),
        owner: ownerValue,
      }));

    } catch (error) {
      console.error('❌ Error refreshing VAMM data:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh data',
        isLoading: false,
      }));
    }
  }, [walletData.address, contractsReady]);

  // Force refresh - clears cache and re-fetches all data
  const forceRefresh = useCallback(async () => {
    console.log('🔄 Force refreshing VAMM data...');
    
    // Clear current state first
    setState(prev => ({
      ...prev,
      position: null,
      positions: [],
      isLoading: true,
      error: null,
    }));

    // Wait a moment to ensure state is cleared
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Refresh data
    await refreshData();
  }, [refreshData]);

  // Clear position state manually (for debugging)
  const clearPositionState = useCallback(() => {
    console.log('🧹 Manually clearing position state...');
    setState(prev => ({
      ...prev,
      position: null,
      positions: [],
      error: null,
    }));
  }, []);

  // Approve collateral spending
  const approveCollateral = useCallback(async (amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!collateralContract.current || !signer.current) {
      return { success: false, error: 'Contracts not initialized' };
    }

    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDC is 6 decimals
      const vaultAddress = await vaultContract.current!.getAddress();
      
      const tx = await (collateralContract.current as any).connect(signer.current).approve(vaultAddress, amountWei);
      await waitForTransaction(tx);

      await refreshData();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error approving collateral:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to approve collateral' 
      };
    }
  }, [refreshData]);

  // Deposit collateral
  const depositCollateral = useCallback(async (amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vaultContract.current || !signer.current || !walletData.address) {
      return { success: false, error: 'Contracts not initialized' };
    }

    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDC is 6 decimals
      
      const tx = await (vaultContract.current as any).connect(signer.current).depositCollateral(walletData.address, amountWei);
      await waitForTransaction(tx);

      await refreshData();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error depositing collateral:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to deposit collateral' 
      };
    }
  }, [walletData.address, refreshData]);

  // Withdraw collateral
  const withdrawCollateral = useCallback(async (amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vaultContract.current || !signer.current || !walletData.address) {
      return { success: false, error: 'Contracts not initialized' };
    }

    try {
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDC is 6 decimals
      
      const tx = await (vaultContract.current as any).connect(signer.current).withdrawCollateral(walletData.address, amountWei);
      await waitForTransaction(tx);

      await refreshData();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error withdrawing collateral:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to withdraw collateral' 
      };
    }
  }, [walletData.address, refreshData]);

  // Get price impact for a trade
  const getPriceImpact = useCallback(async (amount: number, isLong: boolean, leverage: number): Promise<string> => {
    if (!vammContract.current) return '0';

    try {
      const positionSize = ethers.parseEther((amount * leverage).toString());
      const priceImpact = await (vammContract.current as any).getPriceImpact(positionSize, isLong);
      return ethers.formatEther(priceImpact);
    } catch (error) {
      console.error('❌ Error getting price impact:', error);
      return '0';
    }
  }, []);

  // Open position
  const openPosition = useCallback(async (params: TradeParams): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vammContract.current || !signer.current || !state.markPrice) {
      return { success: false, error: 'Contracts not initialized' };
    }

    try {
      const collateralAmount = ethers.parseUnits(params.amount.toString(), 6); // USDC is 6 decimals
      const leverage = BigInt(params.leverage);
      
      // Calculate slippage bounds with more robust logic
      const markPriceWei = ethers.parseEther(state.markPrice);
      const slippageAmount = (markPriceWei * BigInt(Math.floor(params.slippageTolerance * 100))) / BigInt(10000);
      
      // For shorts, we want to be more conservative with price bounds
      let minPrice: bigint;
      let maxPrice: bigint;
      
      if (params.isLong) {
        // For long positions: allow price to be lower than mark price (better execution)
        minPrice = markPriceWei - slippageAmount;
        maxPrice = ethers.MaxUint256; // No upper limit for longs
      } else {
        // For short positions: allow price to be higher than mark price (better execution)
        minPrice = BigInt(0); // No lower limit for shorts
        maxPrice = markPriceWei + slippageAmount;
      }
      
      // Ensure minPrice is not negative
      if (minPrice < BigInt(0)) minPrice = BigInt(0);

      console.log('🔄 Opening position with params:');
      console.log('collateralAmount:', collateralAmount.toString());
      console.log('isLong:', params.isLong);
      console.log('leverage:', leverage.toString());
      console.log('markPrice:', ethers.formatEther(markPriceWei));
      console.log('slippageTolerance:', params.slippageTolerance);
      console.log('minPrice:', ethers.formatEther(minPrice));
      console.log('maxPrice:', maxPrice === ethers.MaxUint256 ? 'MAX' : ethers.formatEther(maxPrice));

      const tx = await (vammContract.current as any).connect(signer.current).openPosition(
        collateralAmount,
        params.isLong,
        leverage,
        minPrice,
        maxPrice
      );
      
      console.log('🎯 Transaction sent:', tx.hash);
      await waitForTransaction(tx);
      console.log('✅ Transaction confirmed');
      
      await refreshData();
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error opening position:', error);
      
      // Extract more detailed error information
      let errorMessage = 'Failed to open position';
      
      if (error instanceof Error) {
        const errorStr = error.message;
        
        // Check for specific contract errors
        if (errorStr.includes('vAMM: price slippage')) {
          errorMessage = 'Price slippage exceeded tolerance. Try increasing slippage or waiting for better price.';
        } else if (errorStr.includes('vAMM: invalid collateral')) {
          errorMessage = 'Invalid collateral amount. Please check your input.';
        } else if (errorStr.includes('vAMM: invalid leverage')) {
          errorMessage = 'Invalid leverage. Please use between 1x and 100x.';
        } else if (errorStr.includes('vAMM: paused')) {
          errorMessage = 'Trading is currently paused on this market.';
        } else if (errorStr.includes('Vault: insufficient margin')) {
          errorMessage = 'Insufficient margin. Please deposit more collateral.';
        } else if (errorStr.includes('Oracle: inactive')) {
          errorMessage = 'Oracle is inactive. Please refresh the oracle or contact support.';
        } else if (errorStr.includes('Oracle: price too old')) {
          errorMessage = 'Oracle price is stale. Please refresh the oracle.';
        } else if (errorStr.includes('execution reverted')) {
          errorMessage = 'Transaction failed during execution. Please check contract state and try again.';
        } else {
          errorMessage = errorStr;
        }
      }
      
      return { 
        success: false, 
        error: errorMessage
      };
    }
  }, [state.markPrice, refreshData]);

  // Close position
  const closePosition = useCallback(async (sizePercent: number, slippageTolerance: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vammContract.current || !signer.current || !state.position || !state.markPrice) {
      return { success: false, error: 'No position to close' };
    }

    try {
      // Calculate size to close
      const positionSize = BigInt(state.position.size);
      const absoluteSize = positionSize < BigInt(0) ? -positionSize : positionSize;
      const sizeToClose = (absoluteSize * BigInt(Math.floor(sizePercent * 100))) / BigInt(10000);

      // Calculate slippage bounds
      const markPriceWei = ethers.parseEther(state.markPrice);
      const slippageAmount = (markPriceWei * BigInt(Math.floor(slippageTolerance * 100))) / BigInt(10000);
      
      const minPrice = state.position.isLong ? markPriceWei - slippageAmount : BigInt(0);
      const maxPrice = state.position.isLong ? ethers.MaxUint256 : markPriceWei + slippageAmount;

      const tx = await (vammContract.current as any).connect(signer.current).closePosition(
        sizeToClose,
        minPrice,
        maxPrice
      );
      
      await waitForTransaction(tx);
      
      // Clear position state immediately after successful close
      console.log('🔄 Position closed successfully, clearing state...');
      setState(prev => ({
        ...prev,
        position: null,
        positions: [],
      }));
      
      // Then refresh all data to ensure consistency
      await refreshData();
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error closing position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to close position' 
      };
    }
  }, [state.position, state.markPrice, refreshData]);

  // Close specific position (for handling multiple positions independently)
  const closeSpecificPosition = useCallback(async (positionIndex: number, sizePercent: number, slippageTolerance: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    // For now, this works the same as closePosition since we only have one position
    // In the future, this could be extended to handle multiple positions
    if (positionIndex !== 0 || !state.positions[positionIndex]) {
      return { success: false, error: 'Invalid position index' };
    }

    return closePosition(sizePercent, slippageTolerance);
  }, [state.positions, closePosition]);

  // Initialize contracts when dependencies change
  useEffect(() => {
    initializeContracts();
  }, [initializeContracts]);

  // Refresh data when contracts are ready
  useEffect(() => {
    if (contractsReady && vammContract.current && vaultContract.current && collateralContract.current && oracleContract.current && walletData.address) {
      refreshData();
    }
  }, [walletData.address, contractsReady]); // Removed refreshData from deps

  // Set up periodic refresh only when enabled and conditions are met
  useEffect(() => {
    if (!contractsReady || !vammContract.current || !oracleContract.current || !enablePolling) return;

    // If onlyPollWithPosition is true, only poll when user has a position
    if (onlyPollWithPosition && !state.position) return;

    console.log('🔄 Starting periodic refresh with interval:', pollingInterval);
    
    const interval = setInterval(() => {
      if (contractsReady) {
        // Double check position requirement if enabled
        if (onlyPollWithPosition && !state.position) {
          console.log('⏸️ Stopping poll - no position detected');
          return;
        }
        refreshData();
      }
    }, pollingInterval);

    return () => {
      console.log('🛑 Stopping periodic refresh');
      clearInterval(interval);
    };
  }, [contractsReady, enablePolling, pollingInterval, onlyPollWithPosition, state.position]); // Added new deps

  return {
    ...state,
    openPosition,
    closePosition,
    closeSpecificPosition,
    depositCollateral,
    withdrawCollateral,
    approveCollateral,
    refreshData,
    forceRefresh,
    clearPositionState,
    getPriceImpact,
  };
} 