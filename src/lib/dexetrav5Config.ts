/**
 * Dexetrav5 Configuration Bridge
 *
 * This module provides a bridge between the Dexetrav5/config/contracts.js
 * system and the Next.js frontend environment. It dynamically loads contract
 * configurations from Dexetrav5/config/contracts.js when running on the server,
 * and provides a compatible API for client-side code.
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Define a type for the loaded config from Dexetrav5/config/contracts.js
interface Dexetrav5ContractsConfig {
  ADDRESSES: Record<string, string>;
  NAMES: Record<string, string>;
  MARKET_INFO: Record<string, any>;
  NETWORKS: Record<string, any>;
  ROLES: Record<string, string>;
  getContract: (contractKey: string, options?: any) => Promise<any>;
  getAddress: (contractKey: string) => string;
  getNetworkConfig: () => any;
  getAllAddresses?: () => Record<string, string>;
  displayConfig: () => void;
  validateAddresses: () => boolean;
  refreshAddresses: () => Record<string, string>;
  // Add other functions/properties from contracts.js as needed
}

let dexetrav5ConfigInstance: Dexetrav5ContractsConfig | null = null;

/**
 * Gets the Dexetrav5 configuration singleton
 * Handles both server-side and client-side environments
 */
export function getDexetrav5Config(): Dexetrav5ContractsConfig {
  if (dexetrav5ConfigInstance) {
    return dexetrav5ConfigInstance;
  }

  // Determine if running in a Node.js environment (e.g., API routes, build process)
  // or a browser-like environment (client-side).
  if (typeof window === 'undefined') {
    try {
      // Temporarily set HARDHAT_NETWORK to avoid issues with contracts.js expecting it
      if (!process.env.HARDHAT_NETWORK) {
        process.env.HARDHAT_NETWORK = "localhost";
      }

      // Use require to load the CommonJS module
      const contractsJsPath = path.join(process.cwd(), 'Dexetrav5', 'config', 'contracts.js');
      const loadedConfig = require(contractsJsPath);

      // Ensure addresses are refreshed if they were loaded before network was set
      if (typeof loadedConfig.refreshAddresses === 'function') {
        loadedConfig.refreshAddresses();
      }

      // Add getAllAddresses if not present in the original module
      if (!loadedConfig.getAllAddresses) {
        loadedConfig.getAllAddresses = () => ({ ...loadedConfig.ADDRESSES });
      }

      dexetrav5ConfigInstance = {
        ADDRESSES: loadedConfig.ADDRESSES,
        NAMES: loadedConfig.NAMES,
        NETWORKS: loadedConfig.NETWORKS,
        MARKET_INFO: loadedConfig.MARKET_INFO,
        ROLES: loadedConfig.ROLES,
        getContract: loadedConfig.getContract,
        getAddress: loadedConfig.getAddress,
        getNetworkConfig: loadedConfig.getNetworkConfig,
        getAllAddresses: loadedConfig.getAllAddresses,
        displayConfig: loadedConfig.displayConfig,
        validateAddresses: loadedConfig.validateAddresses,
        refreshAddresses: loadedConfig.refreshAddresses,
      };
      console.log('✅ Dexetrav5 config loaded successfully from Dexetrav5/config/contracts.js');
    } catch (error) {
      console.error('❌ Error loading Dexetrav5 contract configuration:', error);
      // Fallback to a dummy config to prevent crashes
      dexetrav5ConfigInstance = createFallbackConfig();
    }
  } else {
    console.warn('⚠️ Dexetrav5 config accessed in browser environment. Using fallback configuration.');
    dexetrav5ConfigInstance = createFallbackConfig();
  }

  return dexetrav5ConfigInstance;
}

/**
 * Creates a fallback configuration for client-side or when loading fails
 */
function createFallbackConfig(): Dexetrav5ContractsConfig {
  return {
    ADDRESSES: {},
    NAMES: {},
    NETWORKS: {
      hyperliquid_testnet: {
        name: "HyperLiquid Testnet",
        chainId: 998,
        blockConfirmations: 2,
      }
    },
    MARKET_INFO: {},
    ROLES: {},
    getContract: async (key: string) => { 
      console.warn(`Fallback getContract called for ${key}`); 
      return null; 
    },
    getAddress: (key: string) => {
      console.warn(`Fallback getAddress called for ${key}`);
      // Provide a mock address for critical contracts if possible
      if (key === 'MOCK_USDC') return '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Common USDC address
      if (key === 'CORE_VAULT') return '0x0000000000000000000000000000000000000001';
      if (key === 'FUTURES_MARKET_FACTORY') return '0x0000000000000000000000000000000000000002';
      if (key === 'ALUMINUM_ORDERBOOK') return '0x0000000000000000000000000000000000000003';
      return '0x0000000000000000000000000000000000000000';
    },
    getAllAddresses: () => ({}),
      getNetworkConfig: () => ({
      name: "HyperLiquid Testnet",
      chainId: 998,
      blockConfirmations: 2,
    }),
    displayConfig: () => console.warn('Fallback displayConfig called'),
    validateAddresses: () => { console.warn('Fallback validateAddresses called'); return false; },
    refreshAddresses: () => ({}),
  };
}

// Additional helper functions for the frontend

/**
 * Gets all contract addresses from Dexetrav5 config
 */
export function getAllContractAddresses(): Record<string, string> {
  const config = getDexetrav5Config();
  return config.ADDRESSES;
}

/**
 * Gets market information for a specific market or all markets
 */
export function getMarketInfo(marketKey?: string): any {
  const config = getDexetrav5Config();
  if (marketKey) {
    return config.MARKET_INFO[marketKey] || null;
  }
  return config.MARKET_INFO;
}

/**
 * Gets network configuration
 */
export function getNetworkConfig(): any {
  const config = getDexetrav5Config();
  return config.getNetworkConfig();
}

/**
 * Validates that all required contracts are properly configured
 */
export function validateDexetrav5Config(): boolean {
  const config = getDexetrav5Config();
  return config.validateAddresses();
}

// Export types for use in other modules
export type { Dexetrav5ContractsConfig };