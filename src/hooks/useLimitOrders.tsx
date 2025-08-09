import { useState, useEffect, useCallback } from 'react';
import { 
  formatUnits, 
  parseUnits, 
  getContract, 
  createWalletClient, 
  createPublicClient, 
  custom, 
  http, 
  WalletClient, 
  PublicClient 
} from 'viem';
import { polygon } from 'viem/chains';
import { useWallet } from './useWallet';

// Types for limit orders
export interface LimitOrder {
  orderHash: string;
  user: string;
  metricId: string;
  isLong: boolean;
  collateralAmount: number;
  leverage: number;
  triggerPrice: number;
  targetValue: number;
  positionType: 'CONTINUOUS' | 'SETTLEMENT' | 'PREDICTION';
  orderType: 'LIMIT' | 'MARKET_IF_TOUCHED' | 'STOP_LOSS' | 'TAKE_PROFIT';
  expiry: number;
  maxSlippage: number;
  keeperFee: number;
  isActive: boolean;
  createdAt: number;
  nonce: number;
}

export interface CreateLimitOrderParams {
  metricId: string;
  isLong: boolean;
  collateralAmount: number;
  leverage: number;
  triggerPrice: number;
  targetValue: number;
  positionType: 'CONTINUOUS' | 'SETTLEMENT' | 'PREDICTION';
  orderType: 'LIMIT' | 'MARKET_IF_TOUCHED' | 'STOP_LOSS' | 'TAKE_PROFIT';
  expiry: number; // timestamp
  maxSlippage: number; // basis points
}

export interface LimitOrderStats {
  totalCreated: number;
  totalExecuted: number;
  totalCancelled: number;
  totalFeesCollected: number;
}

interface LimitOrderHookReturn {
  // State
  userOrders: LimitOrder[];
  activeOrders: LimitOrder[];
  stats: LimitOrderStats | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createLimitOrder: (params: CreateLimitOrderParams) => Promise<{ success: boolean; orderHash?: string; error?: string }>;
  cancelLimitOrder: (orderHash: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  refreshData: () => Promise<void>;
}

// Contract addresses - these would come from your contracts configuration
const CONTRACT_ADDRESSES = {
  LIMIT_ORDER_MANAGER: '0x6c91c1A5D49707f4716344d0881c43215FC55D41', // Replace with your actual address
  USDC: '0xbD9E0b8e723434dCd41700e82cC4C8C539F66377' // Replace with your actual address
};

// ABIs - converted to viem format
const LIMIT_ORDER_MANAGER_ABI = [
  {
    name: 'createLimitOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metricId', type: 'string' },
      { name: 'isLong', type: 'bool' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
      { name: 'triggerPrice', type: 'uint256' },
      { name: 'targetValue', type: 'uint256' },
      { name: 'positionType', type: 'uint8' },
      { name: 'orderType', type: 'uint8' },
      { name: 'expiry', type: 'uint256' },
      { name: 'maxSlippage', type: 'uint256' }
    ],
    outputs: [{ type: 'bytes32' }]
  },
  {
    name: 'cancelLimitOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderHash', type: 'bytes32' },
      { name: 'reason', type: 'string' }
    ],
    outputs: []
  },
  {
    name: 'getUserActiveOrders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ 
      type: 'tuple[]',
      components: [
        { name: 'orderHash', type: 'bytes32' },
        { name: 'user', type: 'address' },
        { name: 'metricId', type: 'bytes32' },
        { name: 'isLong', type: 'bool' },
        { name: 'collateralAmount', type: 'uint256' },
        { name: 'leverage', type: 'uint256' },
        { name: 'triggerPrice', type: 'uint256' },
        { name: 'targetValue', type: 'uint256' },
        { name: 'positionType', type: 'uint8' },
        { name: 'orderType', type: 'uint8' },
        { name: 'expiry', type: 'uint256' },
        { name: 'maxSlippage', type: 'uint256' },
        { name: 'keeperFee', type: 'uint256' },
        { name: 'isActive', type: 'bool' },
        { name: 'createdAt', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }
      ]
    }]
  },
  {
    name: 'getOrderStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' }
    ]
  }
] as const;

const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  }
] as const;

export function useLimitOrders(): LimitOrderHookReturn {
  const { walletData } = useWallet();
  
  // State
  const [userOrders, setUserOrders] = useState<LimitOrder[]>([]);
  const [activeOrders, setActiveOrders] = useState<LimitOrder[]>([]);
  const [stats, setStats] = useState<LimitOrderStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get contract instances
  const getLimitOrderManager = useCallback(() => {
    if (!walletData.isConnected || !window.ethereum) return null;
    
    const walletClient = createWalletClient({
      chain: polygon,
      transport: custom(window.ethereum)
    });

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http()
    });

    return getContract({
      address: CONTRACT_ADDRESSES.LIMIT_ORDER_MANAGER as `0x${string}`,
      abi: LIMIT_ORDER_MANAGER_ABI,
      client: { public: publicClient, wallet: walletClient }
    });
  }, [walletData.isConnected]);

  const getUSDCContract = useCallback(() => {
    if (!walletData.isConnected || !window.ethereum) return null;
    
    const walletClient = createWalletClient({
      chain: polygon,
      transport: custom(window.ethereum)
    });

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http()
    });

    return getContract({
      address: CONTRACT_ADDRESSES.USDC as `0x${string}`,
      abi: USDC_ABI,
      client: { public: publicClient, wallet: walletClient }
    });
  }, [walletData.isConnected]);

  // Helper functions
  const getPositionTypeIndex = (type: string): number => {
    const types = ['CONTINUOUS', 'SETTLEMENT', 'PREDICTION'];
    return types.indexOf(type);
  };

  const getOrderTypeIndex = (type: string): number => {
    const types = ['LIMIT', 'MARKET_IF_TOUCHED', 'STOP_LOSS', 'TAKE_PROFIT'];
    return types.indexOf(type);
  };

  // Parse contract order data
  const parseContractOrder = useCallback((contractOrder: any): LimitOrder => {
    const positionTypes = ['CONTINUOUS', 'SETTLEMENT', 'PREDICTION'];
    const orderTypes = ['MARKET_IF_TOUCHED', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'];
    
    return {
      orderHash: contractOrder.orderHash,
      user: contractOrder.user,
      metricId: contractOrder.metricId,
      isLong: contractOrder.isLong,
      collateralAmount: parseFloat(formatUnits(contractOrder.collateralAmount, 6)), // USDC has 6 decimals
      leverage: Number(contractOrder.leverage),
      triggerPrice: parseFloat(formatUnits(contractOrder.triggerPrice, 6)),
      targetValue: parseFloat(formatUnits(contractOrder.targetValue, 6)),
      positionType: positionTypes[contractOrder.positionType] as any,
      orderType: orderTypes[contractOrder.orderType] as any,
      expiry: Number(contractOrder.expiry),
      maxSlippage: Number(contractOrder.maxSlippage),
      keeperFee: parseFloat(formatUnits(contractOrder.keeperFee, 6)),
      isActive: contractOrder.isActive,
      createdAt: Number(contractOrder.createdAt),
      nonce: Number(contractOrder.nonce)
    };
  }, []);

  // Refresh user orders and stats
  const refreshData = useCallback(async () => {
    if (!walletData.address) return;

    setIsLoading(true);
    setError(null);

    try {
      const contract = getLimitOrderManager();
      if (!contract) return;

      // Get user orders
      const contractOrders = await contract.read.getUserActiveOrders([walletData.address as `0x${string}`]);
      const parsedOrders = contractOrders.map(parseContractOrder);
      
      setUserOrders(parsedOrders);
      setActiveOrders(parsedOrders.filter((order: LimitOrder) => order.isActive));

      // Get stats
      const statsData = await contract.read.getOrderStats();
      setStats({
        totalCreated: Number(statsData[0]),
        totalExecuted: Number(statsData[1]),
        totalCancelled: Number(statsData[2]),
        totalFeesCollected: parseFloat(formatUnits(statsData[3], 6))
      });

    } catch (error: any) {
      console.error('Error refreshing limit orders data:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [walletData.address, getLimitOrderManager, parseContractOrder]);

  // Create limit order
  const createLimitOrder = useCallback(async (params: CreateLimitOrderParams): Promise<{ success: boolean; orderHash?: string; error?: string }> => {
    if (!walletData.isConnected || !walletData.address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const contract = getLimitOrderManager();
      if (!contract) {
        throw new Error('Contract not available');
      }

      // Check and handle USDC approval for fees
      const usdcContract = getUSDCContract();
      if (!usdcContract) {
        throw new Error('USDC contract not available');
      }

      const totalFees = parseUnits('5', 6); // $5 USDC (6 decimals)
      const allowance = await usdcContract.read.allowance([
        walletData.address as `0x${string}`, 
        CONTRACT_ADDRESSES.LIMIT_ORDER_MANAGER as `0x${string}`
      ]);
      
      if (allowance < totalFees) {
        const approveTx = await usdcContract.write.approve([
          CONTRACT_ADDRESSES.LIMIT_ORDER_MANAGER as `0x${string}`, 
          parseUnits('1000', 6)
        ], { account: walletData.address as `0x${string}` }); // Approve $1000 for future orders
        
        // Wait for approval transaction
        const publicClient = createPublicClient({
          chain: polygon,
          transport: http()
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      // Create the order
      const metricIdBytes32 = params.metricId.startsWith('0x') ? params.metricId : `0x${Buffer.from(params.metricId).toString('hex').padStart(64, '0')}`;
      
      const tx = await contract.write.createLimitOrder([
        metricIdBytes32,
        params.isLong,
        parseUnits(params.collateralAmount.toString(), 6),
        BigInt(params.leverage),
        parseUnits(params.triggerPrice.toString(), 6),
        parseUnits(params.targetValue.toString(), 6),
        getPositionTypeIndex(params.positionType),
        getOrderTypeIndex(params.orderType),
        BigInt(params.expiry),
        BigInt(params.maxSlippage)
      ], { account: walletData.address as `0x${string}` });

      // Wait for transaction and get receipt
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http()
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      
      // For simplicity, return the transaction hash as orderHash
      // In a real implementation, you'd parse the events to get the actual order hash
      const orderHash = tx;

      await refreshData();

      return { 
        success: true, 
        orderHash 
      };

    } catch (error: any) {
      console.error('Error creating limit order:', error);
      setError(error.message);
      return { 
        success: false, 
        error: error.message 
      };
    } finally {
      setIsLoading(false);
    }
  }, [walletData.isConnected, walletData.address, getLimitOrderManager, getUSDCContract, refreshData]);

  // Cancel limit order
  const cancelLimitOrder = useCallback(async (orderHash: string, reason: string = 'User cancellation'): Promise<{ success: boolean; error?: string }> => {
    if (!walletData.isConnected || !walletData.address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const contract = getLimitOrderManager();
      if (!contract) {
        throw new Error('Contract not available');
      }

      const tx = await contract.write.cancelLimitOrder([
        orderHash as `0x${string}`,
        reason
      ], { account: walletData.address as `0x${string}` });

      // Wait for transaction
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http()
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      await refreshData();

      return { success: true };

    } catch (error: any) {
      console.error('Error cancelling limit order:', error);
      setError(error.message);
      return { 
        success: false, 
        error: error.message 
      };
    } finally {
      setIsLoading(false);
    }
  }, [walletData.isConnected, walletData.address, getLimitOrderManager, refreshData]);

  // Auto-refresh data when wallet connects
  useEffect(() => {
    if (walletData.isConnected && walletData.address) {
      refreshData();
    }
  }, [walletData.isConnected, walletData.address, refreshData]);

  return {
    userOrders,
    activeOrders,
    stats,
    isLoading,
    error,
    createLimitOrder,
    cancelLimitOrder,
    refreshData
  };
} 