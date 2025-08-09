/**
 * 🏗️ CENTRALIZED CONTRACT CONFIGURATION - DexContractsV2
 * 
 * This is the single source of truth for all DexContractsV2 smart contract addresses, ABIs, and configurations.
 * Update contract addresses here and they will propagate throughout the entire application.
 * 
 * 🚨 IMPORTANT: This system now exclusively supports DexContractsV2 architecture!
 */

import { isAddress } from 'viem';

// Import validated ABIs from dedicated ABI loader
export {
  METRIC_VAMM_ROUTER_ABI,
  CENTRALIZED_VAULT_ABI,
  METRIC_VAMM_FACTORY_ABI,
  METRIC_LIMIT_ORDER_MANAGER_ABI,
  METRIC_REGISTRY_ABI,
  AUTOMATION_FUNDING_MANAGER_ABI,
  LIMIT_ORDER_KEEPER_ABI,
  getABIInfo
} from './contractABIs';

// ==========================================
// 📋 CONTRACT ADDRESSES BY NETWORK - V2 ONLY
// ==========================================

export interface ContractAddresses {
  // DexContractsV2 System - Core Contracts
  DEXV2_FACTORY: string;
  DEXV2_VAULT: string;
  DEXV2_ROUTER: string;
  DEXV2_LIMIT_ORDER_MANAGER: string;
  DEXV2_AUTOMATION_FUNDING: string;
  DEXV2_LIMIT_ORDER_KEEPER: string;
  DEXV2_METRIC_REGISTRY: string;
  DEXV2_USDC: string;
  DEXV2_PRICE_ORACLE: string;
  
  // Specialized VAMMs (deployed via factory)
  POPULATION_VAMM: string;
  WEATHER_VAMM: string;
  ECONOMIC_VAMM: string;
}

export const CONTRACT_ADDRESSES: Record<string, ContractAddresses> = {
  // 🔴 Polygon Mainnet - PRODUCTION DEPLOYMENT (Updated with StartPrice functionality)
  polygon: {
    // Core DexContractsV2 System
    DEXV2_FACTORY: process.env.DEXV2_FACTORY_ADDRESS || "0x069331Cc5c881db1B1382416b189c198C5a2b356",
    DEXV2_VAULT: process.env.DEXV2_VAULT_ADDRESS || "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93",
    DEXV2_ROUTER: process.env.DEXV2_ROUTER_ADDRESS || "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5",
    DEXV2_LIMIT_ORDER_MANAGER: process.env.DEXV2_LIMIT_ORDER_MANAGER || "0x6c91c1A5D49707f4716344d0881c43215FC55D41",
    DEXV2_AUTOMATION_FUNDING: process.env.DEXV2_AUTOMATION_FUNDING || "0x0000000000000000000000000000000000000000",
    DEXV2_LIMIT_ORDER_KEEPER: process.env.DEXV2_LIMIT_ORDER_KEEPER || "0x0000000000000000000000000000000000000000",
    DEXV2_METRIC_REGISTRY: process.env.DEXV2_METRIC_REGISTRY || "0x0000000000000000000000000000000000000000",
    DEXV2_USDC: process.env.DEXV2_USDC_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    DEXV2_PRICE_ORACLE: process.env.DEXV2_PRICE_ORACLE || "0x0000000000000000000000000000000000000000",
    
    // Specialized VAMMs
    POPULATION_VAMM: process.env.POPULATION_VAMM || "0x0000000000000000000000000000000000000000",
    WEATHER_VAMM: process.env.WEATHER_VAMM || "0x0000000000000000000000000000000000000000",
    ECONOMIC_VAMM: process.env.ECONOMIC_VAMM || "0x0000000000000000000000000000000000000000"
  }
};

// ==========================================
// 📋 METRIC IDENTIFIERS  
// ==========================================

export const METRIC_IDS = {
  WORLD_POPULATION: "0x1158cb172f50c512c53a372cda1235efd733a42b897fc8ac9e9842d642dc72ac",
  GLOBAL_TEMPERATURE: "0xded08a6235000e1da2ef9b8982a30c15e5919064abdd60028a74192fbfc391d3", 
  US_GDP_GROWTH: "0x7b15b957f9064b03a0ee8cefccf2f61b19445298b4fedbd8f08873b3d09f404b"
} as const;

// ==========================================
// 📚 CONTRACT ABIS & INTERFACES - V2 ONLY
// ==========================================

// ABIs are now imported from ./contractABIs.ts with validation

// Simple ABIs that don't need validation
export const PRICE_ORACLE_ABI = [
  { type: 'function', name: 'getPrice', inputs: [], outputs: [{ type: 'uint256', name: '' }], stateMutability: 'view' },
  { type: 'function', name: 'getPriceWithTimestamp', inputs: [], outputs: [{ type: 'uint256', name: 'price' }, { type: 'uint256', name: 'timestamp' }], stateMutability: 'view' },
  { type: 'function', name: 'isActive', inputs: [], outputs: [{ type: 'bool', name: '' }], stateMutability: 'view' },
  { type: 'function', name: 'getMaxPriceAge', inputs: [], outputs: [{ type: 'uint256', name: '' }], stateMutability: 'view' }
] as const;

export const MOCK_USDC_ABI = [
  // Standard ERC20 Functions
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'allowance', inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'transfer', inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'transferFrom', inputs: [{ type: 'address', name: 'from' }, { type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  
  // Mock USDC specific functions
  { type: 'function', name: 'faucet', inputs: [{ type: 'uint256', name: 'amount' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'mint', inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [], stateMutability: 'nonpayable' },
  
  // Events
  { type: 'event', name: 'Transfer', inputs: [{ type: 'address', name: 'from', indexed: true }, { type: 'address', name: 'to', indexed: true }, { type: 'uint256', name: 'value' }] },
  { type: 'event', name: 'Approval', inputs: [{ type: 'address', name: 'owner', indexed: true }, { type: 'address', name: 'spender', indexed: true }, { type: 'uint256', name: 'value' }] }
] as const;

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================

/**
 * Get contract addresses for a specific network
 * @param network The network name (polygon, mumbai, localhost)
 * @returns Contract addresses for the network
 */
export function getContractAddresses(network?: string): ContractAddresses {
  const defaultNetwork = getDefaultNetwork();
  const targetNetwork = network || defaultNetwork;
  
  const addresses = CONTRACT_ADDRESSES[targetNetwork];
  if (!addresses) {
    throw new Error(`❌ No contract addresses configured for network: ${targetNetwork}`);
  }
  
  return addresses;
}

/**
 * Get a specific contract address for a network
 * @param network The network name  
 * @param contractName The contract name (e.g., 'SIMPLE_VAMM', 'DEXV2_ROUTER')
 * @returns The contract address
 */
export function getContractAddress(network: string, contractName: keyof ContractAddresses): string {
  const addresses = getContractAddresses(network);
  const address = addresses[contractName];
  
  // Check if address is a placeholder or zero address
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    console.warn(`⚠️ Contract ${contractName} not deployed on ${network}. Address: ${address}`);
    if (network === 'polygon') {
      throw new Error(`Contract ${contractName} is not properly configured for ${network}. Please deploy the contract first.`);
    }
  }
  
  return address;
}

/**
 * Validate if an address is a valid Ethereum address
 * @param address The address to validate
 * @returns True if valid
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Get default network for the current environment
 * @returns The default network name
 */
export function getDefaultNetwork(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'polygon';
}

/**
 * Check if DexV2 system is enabled for a network
 * @param network The network name
 * @returns True if DexV2 is enabled
 */
export function isDexV2Enabled(network?: string): boolean {
  const targetNetwork = network || getDefaultNetwork();
  return targetNetwork === 'polygon';
}

/**
 * Get preferred system version for a network
 * @param network The network name
 * @returns 'v1' or 'v2'
 */
export function getPreferredSystem(network: string): 'v1' | 'v2' {
  return isDexV2Enabled(network) ? 'v2' : 'v1';
}

/**
 * Configuration for contract deployment
 */
export interface DeploymentConfig {
  network: string;
  addresses: ContractAddresses;
  deployer: string;
  deploymentDate: string;
  marketSymbol: string;
  startingPrice: string;
  systemVersion: 'v1' | 'v2';
} 