// Base hooks
export { useWallet } from './useWallet';
export { useETHPrice } from './useETHPrice';
export { useTokenData } from './useTokenData';
export { useMarketData } from './useMarketData';
export { useWalletAddress } from './useWalletAddress';
export { useWalletPortfolio } from './useWalletPortfolio';
export { usePageTitle, useDynamicPageTitle } from './usePageTitle';

// New Dexeterav5 CoreVault hook
export { useCoreVault } from './useCoreVault';

// Legacy contract hooks - will be replaced with direct CoreVault integration
export { 
  useContract,
  useMockUSDC,
  useFuturesMarketFactory,
  useAluminumOrderBook,
  useOrderBook,
  useTradingRouter
} from './useContract';

// Market data hooks
export { 
  useAluminumMarketData,
  useBitcoinMarketData
} from './useMarketData';

// Trading hooks
export { useTrading } from './useTrading';

// USDC Deposit hook
export { useUSDCDeposit } from './useUSDCDeposit';

// Performance detection
export { useDevicePerformance, usePerformanceTier } from './useDevicePerformance';
export type { PerformanceTier, DevicePerformanceInfo } from './useDevicePerformance';