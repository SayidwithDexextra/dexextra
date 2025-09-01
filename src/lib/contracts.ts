import { Address } from 'viem';
import { CONTRACT_ADDRESSES } from './contractConfig';

// Import compiled ABIs from the latest deployment
import MetricsMarketFactoryABI from './abis/MetricsMarketFactory.json';
import CentralVaultABI from './abis/CentralVault.json';
import OrderRouterABI from './abis/OrderRouter.json';
import OrderBookABI from './abis/OrderBook.json';
import UMAOracleManagerABI from './abis/UMAOracleManager.json';

// Export contract configurations with latest ABIs and addresses
export const CONTRACTS = {
  MetricsMarketFactory: {
    address: CONTRACT_ADDRESSES.factory,
    abi: MetricsMarketFactoryABI.abi,
  },
  CentralVault: {
    address: CONTRACT_ADDRESSES.centralVault,
    abi: CentralVaultABI.abi,
  },
  OrderRouter: {
    address: CONTRACT_ADDRESSES.orderRouter,
    abi: OrderRouterABI.abi,
  },
  OrderBook: {
    // Note: OrderBook is deployed per market, address will vary
    abi: OrderBookABI.abi,
  },
  UMAOracleManager: {
    address: CONTRACT_ADDRESSES.umaOracleManager,
    abi: UMAOracleManagerABI.abi,
  },
  MockUSDC: {
    address: CONTRACT_ADDRESSES.mockUSDC,
    abi: [
      'function balanceOf(address owner) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function transfer(address to, uint256 amount) external returns (bool)',
      'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function name() view returns (string)',
      'function totalSupply() view returns (uint256)',
      'event Transfer(address indexed from, address indexed to, uint256 value)',
      'event Approval(address indexed owner, address indexed spender, uint256 value)',
    ],
  },
} as const;

// Contract deployment info
export const DEPLOYMENT_INFO = {
  network: 'Polygon Mainnet',
  chainId: 137,
  deploymentDate: '2025-01-27',
  deployerAddress: '0x1Bc0a803de77a004086e6010cD3f72ca7684e444' as Address,
  verificationStatus: 'verified',
  
  // Deployment transaction hashes
  transactionHashes: {
    UMAOracleManager: '0xf057dcb7dafe02cc20c436ecda8dab02625860aef659e3f1d20b5d1c5c2bac72',
    CentralVault: '0xf057dcb7dafe02cc20c436ecda8dab02625860aef659e3f1d20b5d1c5c2bac72',
    OrderRouter: '0xf057dcb7dafe02cc20c436ecda8dab02625860aef659e3f1d20b5d1c5c2bac72',
    MetricsMarketFactory: '0xf057dcb7dafe02cc20c436ecda8dab02625860aef659e3f1d20b5d1c5c2bac72',
  },
  
  // Block numbers
  deploymentBlocks: {
    UMAOracleManager: 75737476,
    CentralVault: 75737476,
    OrderRouter: 75737476,
    MetricsMarketFactory: 75737476,
  },
} as const;

// Helper function to get contract configuration by name
export function getContract(contractName: keyof typeof CONTRACTS) {
  return CONTRACTS[contractName];
}

// Helper function to check if address is a known contract
export function isKnownContract(address: string): boolean {
  return Object.values(CONTRACT_ADDRESSES).includes(address as Address);
}

// Helper function to get contract name by address
export function getContractNameByAddress(address: string): string | null {
  for (const [name, contractAddress] of Object.entries(CONTRACT_ADDRESSES)) {
    if (contractAddress.toLowerCase() === address.toLowerCase()) {
      return name;
    }
  }
  return null;
}

export default CONTRACTS;
