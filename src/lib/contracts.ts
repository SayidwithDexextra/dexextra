import { Address } from 'viem';

// Import compiled ABIs from the HyperLiquid deployment
import VaultRouterABI from './abis/VaultRouter.json';
import OrderBookFactoryABI from './abis/OrderBookFactoryMinimal.json';
import TradingRouterABI from './abis/TradingRouter.json';
import OrderBookABI from './abis/OrderBook.json';
import OrderBookHyperLiquidABI from './abis/OrderBookHyperLiquid.json';
import UpgradeManagerABI from './abis/UpgradeManager.json';

// Static contract addresses from latest deployment (September 2, 2025)
export const CONTRACT_ADDRESSES = {
  mockUSDC: '0xA2258Ff3aC4f5c77ca17562238164a0205A5b289' as Address,
  vaultRouter: '0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7' as Address,
  orderBookFactory: '0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75' as Address,
  tradingRouter: '0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B' as Address,
  upgradeManager: '0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9' as Address,
  
  // Legacy compatibility aliases
  centralVault: '0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7' as Address, // Maps to vaultRouter
  orderRouter: '0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B' as Address, // Maps to tradingRouter
  factory: '0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75' as Address, // Maps to orderBookFactory
  umaOracleManager: '0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9' as Address, // Maps to upgradeManager
  
  // Market-specific addresses
  aluminumOrderBook: '0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE' as Address,
} as const;

// Static ABI configurations
export const CONTRACT_ABIS = {
  MockUSDC: [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function faucet(uint256 amount) external',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
  ],
  VaultRouter: VaultRouterABI.abi,
  OrderBookFactory: OrderBookFactoryABI.abi,
  TradingRouter: TradingRouterABI.abi,
  OrderBook: OrderBookHyperLiquidABI.abi,
  UpgradeManager: UpgradeManagerABI.abi,
} as const;

// Contract configurations with static addresses
export const CONTRACTS = {
  mockUSDC: {
    address: CONTRACT_ADDRESSES.mockUSDC,
    abi: CONTRACT_ABIS.MockUSDC,
  },
  vaultRouter: {
    address: CONTRACT_ADDRESSES.vaultRouter,
    abi: CONTRACT_ABIS.VaultRouter,
  },
  orderBookFactory: {
    address: CONTRACT_ADDRESSES.orderBookFactory,
    abi: CONTRACT_ABIS.OrderBookFactory,
  },
  tradingRouter: {
    address: CONTRACT_ADDRESSES.tradingRouter,
    abi: CONTRACT_ABIS.TradingRouter,
  },
  upgradeManager: {
    address: CONTRACT_ADDRESSES.upgradeManager,
    abi: CONTRACT_ABIS.UpgradeManager,
  },
  orderBook: {
    address: CONTRACT_ADDRESSES.aluminumOrderBook,
    abi: CONTRACT_ABIS.OrderBook,
  },
  
  // Legacy compatibility aliases for components still using uppercase
  MockUSDC: {
    address: CONTRACT_ADDRESSES.mockUSDC,
    abi: CONTRACT_ABIS.MockUSDC,
  },
  VaultRouter: {
    address: CONTRACT_ADDRESSES.vaultRouter,
    abi: CONTRACT_ABIS.VaultRouter,
  },
  OrderBookFactory: {
    address: CONTRACT_ADDRESSES.orderBookFactory,
    abi: CONTRACT_ABIS.OrderBookFactory,
  },
  TradingRouter: {
    address: CONTRACT_ADDRESSES.tradingRouter,
    abi: CONTRACT_ABIS.TradingRouter,
  },
  UpgradeManager: {
    address: CONTRACT_ADDRESSES.upgradeManager,
    abi: CONTRACT_ABIS.UpgradeManager,
  },
  OrderBook: {
    address: CONTRACT_ADDRESSES.aluminumOrderBook,
    abi: CONTRACT_ABIS.OrderBook,
  },
} as const;

// Static deployment info
export const DEPLOYMENT_INFO = {
  network: 'Polygon Mainnet',
  chainId: 137,
  verificationStatus: 'verified',
  scalingFixesApplied: true,
  deploymentDate: 'September 2, 2025',
} as const;

// Backward compatibility exports
export { CONTRACTS as getContractDynamic };