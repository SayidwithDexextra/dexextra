'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from './useWallet';
import { VAMMMarket } from './useVAMMMarkets';

// Contract ABIs (Updated for Bonding Curve Trading)
const VAMM_ABI = [
  // Core trading functions
  "function openPosition(uint256 collateralAmount, bool isLong, uint256 leverage, uint256 minPrice, uint256 maxPrice) external returns (uint256 positionId)",
  "function addToPosition(uint256 positionId, uint256 collateralAmount, uint256 leverage, uint256 minPrice, uint256 maxPrice) external returns (uint256 newSize)",
  "function closePosition(uint256 positionId, uint256 sizeToClose, uint256 minPrice, uint256 maxPrice) external returns (int256 pnl)",
  "function liquidate(uint256 positionId) external",
  
  // Position management
  "function getPosition(uint256 positionId) external view returns (tuple(uint256 positionId, int256 size, bool isLong, uint256 entryPrice, uint256 entryFundingIndex, uint256 lastInteractionTime, bool isActive))",
  "function getUserPositions(address user) external view returns (tuple(uint256 positionId, int256 size, bool isLong, uint256 entryPrice, uint256 entryFundingIndex, uint256 lastInteractionTime, bool isActive)[])",
  "function getUserPositionIds(address user) external view returns (uint256[])",
  "function getUnrealizedPnL(uint256 positionId) external view returns (int256)",
  "function getTotalUnrealizedPnL(address user) external view returns (int256)",
  "function getUserSummary(address user) external view returns (uint256 totalLongSize, uint256 totalShortSize, int256 totalPnL, uint256 activePositionsCount)",
  
  // Bonding curve functions
  "function getMarkPrice() external view returns (uint256)",
  "function getTotalSupply() external view returns (uint256)",
  "function getBondingCurveInfo() external view returns (uint256 currentPrice, uint256 startPrice, uint256 totalSupply, uint256 steepness, uint256 exponent, uint256 maxPrice)",
  "function calculateBuyCost(uint256 amount) external view returns (uint256 totalCost)",
  "function calculateSellPayout(uint256 amount) external view returns (uint256 totalPayout)",
  "function getPriceImpact(uint256 size, bool isLong) external view returns (uint256)",
  
  // Funding mechanism
  "function updateFunding() external",
  "function getFundingRate() external view returns (int256)",
  "function getFundingState() external view returns (tuple(int256 fundingRate, uint256 fundingIndex, uint256 lastFundingTime, int256 premiumFraction))",
  
  // Contract info
  "function vault() external view returns (address)",
  "function oracle() external view returns (address)",
  "function owner() external view returns (address)",
  "function startingPrice() external view returns (uint256)",
  "function totalLongSize() external view returns (int256)",
  "function totalShortSize() external view returns (int256)",
  "function tradingFeeRate() external view returns (uint256)",
  "function maintenanceMarginRatio() external view returns (uint256)",
  "function paused() external view returns (bool)"
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
  positionId: string;
  size: string; // Positive for long, negative for short
  entryPrice: string;
  entryFundingIndex: string;
  lastInteractionTime: string;
  unrealizedPnL: string;
  isLong: boolean;
  positionSizeUsd: string;
  isActive: boolean;
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
        userPositionsData,
        marginAccountData,
        markPrice,
        fundingRate,
        collateralBalance,
        collateralAllowance,
        totalUnrealizedPnL,
        isActive,
        maxPriceAge,
        owner
      ] = await Promise.allSettled([
        vammContract.current.getUserPositions(walletData.address),
        vaultContract.current.getMarginAccount(walletData.address),
        vammContract.current.getMarkPrice(),
        vammContract.current.getFundingRate(),
        collateralContract.current.balanceOf(walletData.address),
        collateralContract.current.allowance(walletData.address, await vaultContract.current.getAddress()),
        vammContract.current.getTotalUnrealizedPnL(walletData.address),
        true,//oracleContract.current.isActive(),
        oracleContract.current.maxPriceAge(),
        vammContract.current.owner()
      ]);

      console.log('userPositionsData: ', userPositionsData);
      console.log('marginAccountData: ', marginAccountData);
      console.log('markPrice: ', markPrice);
      console.log('fundingRate: ', fundingRate);
      console.log('collateralBalance: ', collateralBalance);
      console.log('collateralAllowance: ', collateralAllowance);
      console.log('totalUnrealizedPnL: ', totalUnrealizedPnL);
      console.log('isActive: ', isActive);
      console.log('maxPriceAge: ', maxPriceAge);
      console.log('owner: ', owner);  

      // Extract values with fallbacks for failed calls
      const userPositionsResult = userPositionsData.status === 'fulfilled' ? userPositionsData.value : [];
      const marginAccountResult = marginAccountData.status === 'fulfilled' ? marginAccountData.value : { collateral: BigInt(0), reservedMargin: BigInt(0), unrealizedPnL: BigInt(0), lastFundingIndex: BigInt(0) };
      const markPriceValue = markPrice.status === 'fulfilled' ? markPrice.value : BigInt(0);
      const fundingRateValue = fundingRate.status === 'fulfilled' ? fundingRate.value : BigInt(0);
      const collateralBalanceValue = collateralBalance.status === 'fulfilled' ? collateralBalance.value : BigInt(0);
      const collateralAllowanceValue = collateralAllowance.status === 'fulfilled' ? collateralAllowance.value : BigInt(0);
      const totalUnrealizedPnLValue = totalUnrealizedPnL.status === 'fulfilled' ? totalUnrealizedPnL.value : BigInt(0);
      const isActiveValue = isActive.status === 'fulfilled' ? isActive.value : false;
      const maxPriceAgeValue = maxPriceAge.status === 'fulfilled' ? maxPriceAge.value : BigInt(0);
      const ownerValue = owner.status === 'fulfilled' ? owner.value : '0x0000000000000000000000000000000000000000';

      // Log any failed calls
      if (userPositionsData.status === 'rejected') console.warn('❌ Failed to get user positions:', userPositionsData.reason);
      if (marginAccountData.status === 'rejected') console.warn('❌ Failed to get margin account:', marginAccountData.reason);
      if (markPrice.status === 'rejected') console.warn('❌ Failed to get mark price:', markPrice.reason);
      if (fundingRate.status === 'rejected') console.warn('❌ Failed to get funding rate:', fundingRate.reason);
      if (collateralBalance.status === 'rejected') console.warn('❌ Failed to get collateral balance:', collateralBalance.reason);
      if (collateralAllowance.status === 'rejected') console.warn('❌ Failed to get collateral allowance:', collateralAllowance.reason);
      if (totalUnrealizedPnL.status === 'rejected') console.warn('❌ Failed to get total unrealized PnL:', totalUnrealizedPnL.reason);
      if (isActive.status === 'rejected') console.warn('❌ Failed to get isActive:', isActive.reason);
      if (maxPriceAge.status === 'rejected') console.warn('❌ Failed to get maxPriceAge:', maxPriceAge.reason);
      if (owner.status === 'rejected') console.warn('❌ Failed to get owner:', owner.reason);

      // Debug mark price formatting
      console.log('Raw markPrice:', markPriceValue.toString(), '→', ethers.formatEther(markPriceValue));

      // Process positions data
      console.log('📊 Raw positions data from contract:', userPositionsResult);

      let position: Position | null = null;
      let positions: Position[] = [];
      
      // Process all user positions
      if (userPositionsResult && userPositionsResult.length > 0) {
        console.log(`Processing ${userPositionsResult.length} positions`);
        
        // Fetch individual unrealized PnL for each position
        const positionPnLPromises = userPositionsResult.map(async (pos: any) => {
          try {
            const pnl = await vammContract.current!.getUnrealizedPnL(pos.positionId);
            return ethers.formatUnits(pnl, 6); // USDC has 6 decimals
          } catch (error) {
            console.warn(`❌ Failed to get PnL for position ${pos.positionId}:`, error);
            return '0';
          }
        });
        
        const positionPnLs = await Promise.all(positionPnLPromises);
        
        positions = userPositionsResult.map((pos: any, index: number) => {
          const positionSizeAbs = pos.size > BigInt(0) ? pos.size : -pos.size;
          const positionSizeUsdWei = positionSizeAbs * pos.entryPrice;
          
          const processedPosition: Position = {
            positionId: pos.positionId.toString(),
            size: pos.size.toString(),
            entryPrice: pos.entryPrice.toString(),
            entryFundingIndex: pos.entryFundingIndex.toString(),
            lastInteractionTime: pos.lastInteractionTime.toString(),
            unrealizedPnL: positionPnLs[index],
            isLong: pos.isLong,
            positionSizeUsd: ethers.formatUnits(positionSizeUsdWei, 24), // Format as USDC: 18 (price precision) + 6 (USDC decimals)
            isActive: pos.isActive,
          };
          
          return processedPosition;
        });

        // For backward compatibility, set the first position as the primary position
        if (positions.length > 0) {
          position = positions[0];
        }

        console.log('✅ Active positions detected:', positions);
      } else {
        console.log('❌ No active positions found');
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
      console.log('🔄 Starting collateral approval for amount:', amount);
      
      const amountWei = ethers.parseUnits(amount.toString(), 6); // USDC is 6 decimals
      const vaultAddress = await vaultContract.current!.getAddress();
      
      console.log('Approval details:', {
        amount: amount,
        amountWei: amountWei.toString(),
        vaultAddress: vaultAddress,
        userAddress: await signer.current.getAddress()
      });

      // Get current network to ensure compatibility
      const network = await signer.current.provider?.getNetwork();
      console.log('Current network:', network?.chainId, network?.name);

      // Estimate gas for the approval transaction
      let gasEstimate;
      try {
        gasEstimate = await (collateralContract.current as any).approve.estimateGas(vaultAddress, amountWei);
        console.log('Gas estimate:', gasEstimate.toString());
      } catch (gasError) {
        console.warn('Gas estimation failed, using default:', gasError);
        gasEstimate = BigInt(200000); // Increased default for approval operations
      }

      // Add 50% buffer to gas estimate for Polygon
      const gasLimit = (gasEstimate * BigInt(150)) / BigInt(100);
      
      // Get current gas price
      let gasPrice;
      try {
        const feeData = await signer.current.provider?.getFeeData();
        gasPrice = feeData?.gasPrice;
        console.log('Current gas price:', gasPrice?.toString());
      } catch (priceError) {
        console.warn('Failed to get gas price, using default:', priceError);
      }

      // Prepare transaction options
      const txOptions: any = {
        gasLimit: gasLimit,
      };

      // Add gas price only if we got it successfully
      if (gasPrice) {
        txOptions.gasPrice = gasPrice;
      }

      console.log('Transaction options:', txOptions);

      // Execute the approval transaction
      const tx = await (collateralContract.current as any).connect(signer.current).approve(
        vaultAddress, 
        amountWei,
        txOptions
      );
      
      console.log('Approval transaction sent:', tx.hash);
      await waitForTransaction(tx);

      console.log('✅ Approval completed successfully');
      await refreshData();
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error approving collateral:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to approve collateral';
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('insufficient funds')) {
          errorMessage = 'Insufficient ETH for gas fees. Please add ETH to your wallet.';
        } else if (msg.includes('user rejected')) {
          errorMessage = 'Transaction was rejected by user.';
        } else if (msg.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (msg.includes('gas')) {
          errorMessage = 'Gas estimation failed. Please try again with a different amount.';
        } else if (msg.includes('rpc') || msg.includes('internal')) {
          errorMessage = 'RPC endpoint error. Please try again or switch networks.';
        } else {
          errorMessage = error.message;
        }
      }
      
      return { 
        success: false, 
        error: errorMessage
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

      // Create connected contract instance for consistent usage
      const connectedContract = (vammContract.current as any).connect(signer.current);

      // Estimate gas for the openPosition transaction  
      let gasEstimate;
      try {
        gasEstimate = await connectedContract.openPosition.estimateGas(
          collateralAmount,
          params.isLong,
          leverage,
          minPrice,
          maxPrice
        );
        console.log('Gas estimate:', gasEstimate.toString());
      } catch (gasError) {
        console.warn('Gas estimation failed, using default:', gasError);
        gasEstimate = BigInt(800000); // Increased default for complex vAMM operations
      }

      // Add 50% buffer to gas estimate for Polygon + reentrancy guards
      const gasLimit = (gasEstimate * BigInt(150)) / BigInt(100);
      
      console.log('Final gas settings:', {
        originalEstimate: gasEstimate.toString(),
        finalGasLimit: gasLimit.toString(),
        bufferPercentage: '50%'
      });

      // Execute transaction with same connected contract instance
      const tx = await connectedContract.openPosition(
        collateralAmount,
        params.isLong,
        leverage,
        minPrice,
        maxPrice,
        { gasLimit: gasLimit }
      );
      
      console.log('🎯 Transaction sent:', tx.hash);
      const receipt = await waitForTransaction(tx);
      console.log('✅ Transaction confirmed');
      
      // Extract position ID from transaction receipt or logs
      console.log('📋 Transaction receipt:', receipt);
      
      await refreshData();
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error opening position:', error);
      
      // Extract more detailed error information
      let errorMessage = 'Failed to open position';
      
      if (error instanceof Error) {
        const errorStr = error.message;
        
        // Check for specific contract errors
        if (errorStr.includes('MetricVAMM: price slippage')) {
          errorMessage = 'Price slippage exceeded tolerance. Try increasing slippage or waiting for better price.';
        } else if (errorStr.includes('MetricVAMM: invalid collateral')) {
          errorMessage = 'Invalid collateral amount. Please check your input.';
        } else if (errorStr.includes('MetricVAMM: invalid leverage')) {
          errorMessage = 'Invalid leverage. Please use between 1x and 100x.';
        } else if (errorStr.includes('MetricVAMM: paused')) {
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

  // Close position (closes first position for backward compatibility)
  const closePosition = useCallback(async (sizePercent: number, slippageTolerance: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vammContract.current || !signer.current || !state.positions || state.positions.length === 0 || !state.markPrice) {
      return { success: false, error: 'No position to close' };
    }

    // Use the first position for backward compatibility - inline the logic to avoid circular dependency
    const position = state.positions[0];
    const positionId = BigInt(position.positionId);
    
    try {
      // Calculate size to close
      const positionSize = BigInt(position.size);
      const absoluteSize = positionSize < BigInt(0) ? -positionSize : positionSize;
      const sizeToClose = (absoluteSize * BigInt(Math.floor(sizePercent * 100))) / BigInt(10000);

      // Calculate slippage bounds
      const markPriceWei = ethers.parseEther(state.markPrice);
      const slippageAmount = (markPriceWei * BigInt(Math.floor(slippageTolerance * 100))) / BigInt(10000);
      
      const minPrice = position.isLong ? markPriceWei - slippageAmount : BigInt(0);
      const maxPrice = position.isLong ? ethers.MaxUint256 : markPriceWei + slippageAmount;

      const tx = await (vammContract.current as any).connect(signer.current).closePosition(
        positionId,
        sizeToClose,
        minPrice,
        maxPrice
      );
      
      await waitForTransaction(tx);
      await refreshData();
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error closing position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to close position' 
      };
    }
  }, [state.positions, state.markPrice, refreshData]);

  // Close specific position (for handling multiple positions independently)
  const closeSpecificPosition = useCallback(async (positionIndex: number, sizePercent: number, slippageTolerance: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!vammContract.current || !signer.current || !state.positions || !state.positions[positionIndex] || !state.markPrice) {
      return { success: false, error: 'Invalid position or not found' };
    }

    try {
      const position = state.positions[positionIndex];
      const positionId = BigInt(position.positionId);
      
      // Calculate size to close
      const positionSize = BigInt(position.size);
      const absoluteSize = positionSize < BigInt(0) ? -positionSize : positionSize;
      const sizeToClose = (absoluteSize * BigInt(Math.floor(sizePercent * 100))) / BigInt(10000);

      // Calculate slippage bounds
      const markPriceWei = ethers.parseEther(state.markPrice);
      const slippageAmount = (markPriceWei * BigInt(Math.floor(slippageTolerance * 100))) / BigInt(10000);
      
      const minPrice = position.isLong ? markPriceWei - slippageAmount : BigInt(0);
      const maxPrice = position.isLong ? ethers.MaxUint256 : markPriceWei + slippageAmount;

      console.log('🔄 Closing position with params:');
      console.log('positionId:', positionId.toString());
      console.log('sizeToClose:', sizeToClose.toString());
      console.log('minPrice:', ethers.formatEther(minPrice));
      console.log('maxPrice:', maxPrice === ethers.MaxUint256 ? 'MAX' : ethers.formatEther(maxPrice));

      const tx = await (vammContract.current as any).connect(signer.current).closePosition(
        positionId,
        sizeToClose,
        minPrice,
        maxPrice
      );
      
      await waitForTransaction(tx);
      
      console.log('🔄 Position closed successfully, refreshing data...');
      
      // Refresh all data to ensure consistency
      await refreshData();
      
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('❌ Error closing position:', error);
      
      // Extract more detailed error information
      let errorMessage = 'Failed to close position';
      
      if (error instanceof Error) {
        const errorStr = error.message;
        
        // Check for specific contract errors
        if (errorStr.includes('MetricVAMM: price slippage')) {
          errorMessage = 'Price slippage exceeded tolerance. Try increasing slippage or waiting for better price.';
        } else if (errorStr.includes('MetricVAMM: position not active')) {
          errorMessage = 'Position is not active or already closed.';
        } else if (errorStr.includes('MetricVAMM: not position owner')) {
          errorMessage = 'You are not the owner of this position.';
        } else if (errorStr.includes('MetricVAMM: invalid size')) {
          errorMessage = 'Invalid size to close. Cannot exceed position size.';
        } else {
          errorMessage = errorStr;
        }
      }
      
      return { 
        success: false, 
        error: errorMessage
      };
    }
  }, [state.positions, state.markPrice, refreshData]);

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