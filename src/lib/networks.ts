/**
 * Network Configuration for DexExtra
 * Supports multiple blockchain networks including Ethereum, Polygon, and test networks
 */

export interface NetworkConfig {
  chainId: number
  name: string
  displayName: string
  rpcUrl: string
  wsRpcUrl?: string
  blockExplorer: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  isTestnet: boolean
  isMainnet: boolean
  icon?: string
  color?: string
}

export const NETWORKS: Record<string, NetworkConfig> = {
  // Polygon Mainnet
  polygon: {
    chainId: 137,
    name: 'polygon',
    displayName: 'Polygon Mainnet',
    rpcUrl: 'https://polygon-rpc.com/',
    wsRpcUrl: 'wss://polygon-rpc.com/',
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '🟣',
    color: '#8247E5'
  },

  // Polygon Mumbai (Testnet)
  mumbai: {
    chainId: 80001,
    name: 'mumbai',
    displayName: 'Polygon Mumbai',
    rpcUrl: 'https://rpc-mumbai.maticvigil.com/',
    wsRpcUrl: 'wss://rpc-mumbai.maticvigil.com/',
    blockExplorer: 'https://mumbai.polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    },
    isTestnet: true,
    isMainnet: false,
    icon: '🧪',
    color: '#8247E5'
  },

  // Ethereum Mainnet
  ethereum: {
    chainId: 1,
    name: 'ethereum',
    displayName: 'Ethereum Mainnet',
    rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/demo',
    wsRpcUrl: 'wss://eth-mainnet.alchemyapi.io/v2/demo',
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '⟠',
    color: '#627EEA'
  },

  // Ethereum Sepolia (Testnet)
  sepolia: {
    chainId: 11155111,
    name: 'sepolia',
    displayName: 'Ethereum Sepolia',
    rpcUrl: 'https://eth-sepolia.alchemyapi.io/v2/demo',
    wsRpcUrl: 'wss://eth-sepolia.alchemyapi.io/v2/demo',
    blockExplorer: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'SepoliaETH',
      decimals: 18
    },
    isTestnet: true,
    isMainnet: false,
    icon: '🧪',
    color: '#627EEA'
  },

  // Hardhat Local
  hardhat: {
    chainId: 31337,
    name: 'hardhat',
    displayName: 'Hardhat Local',
    rpcUrl: 'http://localhost:8545',
    wsRpcUrl: 'ws://localhost:8545',
    blockExplorer: 'http://localhost:8545',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: true,
    isMainnet: false,
    icon: '🔨',
    color: '#FFF100'
  },

  // Binance Smart Chain
  bsc: {
    chainId: 56,
    name: 'bsc',
    displayName: 'BSC Mainnet',
    rpcUrl: 'https://bsc-dataseed1.binance.org/',
    wsRpcUrl: 'wss://bsc-ws-node.nariox.org:443',
    blockExplorer: 'https://bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '🟡',
    color: '#F3BA2F'
  },

  // Arbitrum One
  arbitrum: {
    chainId: 42161,
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    wsRpcUrl: 'wss://arb1.arbitrum.io/ws',
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '🔵',
    color: '#28A0F0'
  },

  // Optimism
  optimism: {
    chainId: 10,
    name: 'optimism',
    displayName: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    wsRpcUrl: 'wss://mainnet.optimism.io',
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '🔴',
    color: '#FF0420'
  },

  // Base Mainnet
  base: {
    chainId: 8453,
    name: 'base',
    displayName: 'Base Mainnet',
    rpcUrl: 'https://base.blockscout.com/api/eth-rpc',
    wsRpcUrl: 'wss://base.blockscout.com/api/eth-rpc/websocket',
    blockExplorer: 'https://base.blockscout.com',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: false,
    isMainnet: true,
    icon: '🔵',
    color: '#0052FF'
  },

  // Base Sepolia (Testnet)
  baseSepolia: {
    chainId: 84532,
    name: 'base-sepolia',
    displayName: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    wsRpcUrl: 'wss://sepolia.base.org',
    blockExplorer: 'https://base-sepolia.blockscout.com',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    isTestnet: true,
    isMainnet: false,
    icon: '🧪',
    color: '#0052FF'
  }
}

// Default network (Polygon Mainnet)
export const DEFAULT_NETWORK = NETWORKS.polygon

// Get network by chain ID
export const getNetworkByChainId = (chainId: number): NetworkConfig | undefined => {
  return Object.values(NETWORKS).find(network => network.chainId === chainId)
}

// Get network by name
export const getNetworkByName = (name: string): NetworkConfig | undefined => {
  return NETWORKS[name]
}

// Get all mainnet networks
export const getMainnetNetworks = (): NetworkConfig[] => {
  return Object.values(NETWORKS).filter(network => network.isMainnet)
}

// Get all testnet networks
export const getTestnetNetworks = (): NetworkConfig[] => {
  return Object.values(NETWORKS).filter(network => network.isTestnet)
}

// Check if chain ID is supported
export const isSupportedChainId = (chainId: number): boolean => {
  return Object.values(NETWORKS).some(network => network.chainId === chainId)
}

// Format chain ID for MetaMask
export const formatChainIdForMetaMask = (chainId: number): string => {
  return `0x${chainId.toString(16)}`
}

// Get RPC URL with API key if available
export const getRpcUrl = (network: NetworkConfig, apiKey?: string): string => {
  if (apiKey && network.rpcUrl.includes('alchemyapi.io')) {
    return network.rpcUrl.replace('/demo', `/${apiKey}`)
  }
  return network.rpcUrl
}

// Get WebSocket RPC URL with API key if available
export const getWsRpcUrl = (network: NetworkConfig, apiKey?: string): string => {
  if (!network.wsRpcUrl) return network.rpcUrl
  
  if (apiKey && network.wsRpcUrl.includes('alchemyapi.io')) {
    return network.wsRpcUrl.replace('/demo', `/${apiKey}`)
  }
  return network.wsRpcUrl
}

// Contract addresses for different networks
export const CONTRACT_ADDRESSES: Record<string, { [contractName: string]: string }> = {
  polygon: {
    // 🚀 UPDATED: NEW Deployment with $1 starting price - LATEST DEPLOYMENT 
    SIMPLE_VAMM: "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
    SIMPLE_VAULT: "0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e",
    SIMPLE_ORACLE: "0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711",
    SIMPLE_USDC: "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377",
    
    // Legacy bonding curve addresses (kept for reference)
    VAMM_FACTORY: "0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74",
    MOCK_USDC: "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377", // Updated to match SIMPLE_USDC
    MOCK_ORACLE: "0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711", // Updated to match SIMPLE_ORACLE
  },
  mumbai: {
    // Add your deployed contract addresses for Mumbai testnet here
    // VAMM_FACTORY: '0x...',
    // MOCK_USDC: '0x...',
    // MOCK_ORACLE: '0x...',
  },
  ethereum: {
    // Add your deployed contract addresses for Ethereum Mainnet here
    // VAMM_FACTORY: '0x...',
    // MOCK_USDC: '0x...',
    // MOCK_ORACLE: '0x...',
  },
  sepolia: {
    // Add your deployed contract addresses for Sepolia testnet here
    // VAMM_FACTORY: '0x...',
    // MOCK_USDC: '0x...',
    // MOCK_ORACLE: '0x...',
  },
  hardhat: {
    // Traditional Futures SimpleVAMM System (localhost addresses - update when deploying locally)
    SIMPLE_VAMM: "0x851356ae760d987E095750cCeb3bC6014560891C",
    SIMPLE_VAULT: "0x1613beB3B2C4f22Ee086B2b38C1476A3cE7f78E8", 
    SIMPLE_ORACLE: "0xa82fF9aFd8f496c3d6ac40E2a0F282E47488CFc9",
    SIMPLE_USDC: "0x9E545E3C0baAB3E08CdfD552C960A1050f373042",
  }
}

// Get contract address for specific network
export const getContractAddress = (networkName: string, contractName: string): string | undefined => {
  return CONTRACT_ADDRESSES[networkName]?.[contractName]
}

// Popular RPC providers (with placeholders for API keys)
export const RPC_PROVIDERS = {
  alchemy: {
    ethereum: 'https://eth-mainnet.alchemyapi.io/v2/',
    polygon: 'https://polygon-mainnet.g.alchemy.com/v2/',
    mumbai: 'https://polygon-mumbai.g.alchemy.com/v2/',
    sepolia: 'https://eth-sepolia.alchemyapi.io/v2/',
  },
  infura: {
    ethereum: 'https://mainnet.infura.io/v3/',
    polygon: 'https://polygon-mainnet.infura.io/v3/',
    mumbai: 'https://polygon-mumbai.infura.io/v3/',
    sepolia: 'https://sepolia.infura.io/v3/',
  },
  quicknode: {
    ethereum: 'https://api.quicknode.com/ethereum/mainnet/',
    polygon: 'https://api.quicknode.com/polygon/mainnet/',
  }
}

// Network detection and validation utilities
export async function detectCurrentNetwork(): Promise<{ chainId: number; name: string; supported: boolean } | null> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return null;
  }

  try {
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    const chainId = parseInt(chainIdHex, 16);
    
    // Find network config
    const networkConfig = Object.values(NETWORKS).find(network => network.chainId === chainId);
    
    return {
      chainId,
      name: networkConfig?.displayName || `Unknown Network (${chainId})`,
      supported: !!networkConfig
    };
  } catch (error) {
    console.error('Failed to detect network:', error);
    return null;
  }
}

export async function ensureCorrectNetwork(expectedChainId: number): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return { success: false, error: 'No wallet provider found' };
  }

  try {
    const current = await detectCurrentNetwork();
    
    if (!current) {
      return { success: false, error: 'Failed to detect current network' };
    }

    if (current.chainId === expectedChainId) {
      return { success: true };
    }

    // Try to switch to the expected network
    const expectedNetwork = Object.values(NETWORKS).find(n => n.chainId === expectedChainId);
    if (!expectedNetwork) {
      return { success: false, error: `Unsupported network with chain ID ${expectedChainId}` };
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${expectedChainId.toString(16)}` }],
      });
      return { success: true };
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        // Network not added to wallet, try to add it
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${expectedChainId.toString(16)}`,
              chainName: expectedNetwork.displayName,
              nativeCurrency: expectedNetwork.nativeCurrency,
              rpcUrls: [expectedNetwork.rpcUrl],
              blockExplorerUrls: [expectedNetwork.blockExplorer],
            }],
          });
          return { success: true };
        } catch (addError: any) {
          return { success: false, error: `Failed to add network: ${addError?.message || 'Unknown error'}` };
        }
      }
      return { success: false, error: `Failed to switch network: ${switchError.message}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get the expected chain ID for the current environment
export function getExpectedChainId(): number {
  const defaultNetwork = process.env.DEFAULT_NETWORK || 'polygon';
  const chainIdFromEnv = process.env.CHAIN_ID;
  
  if (chainIdFromEnv) {
    return parseInt(chainIdFromEnv);
  }
  
  const networkConfig = NETWORKS[defaultNetwork];
  return networkConfig?.chainId || 137; // Default to Polygon
}

// Check if current network matches expected
export async function validateNetworkMatch(): Promise<{ isValid: boolean; currentChainId?: number; expectedChainId: number; message: string }> {
  const expectedChainId = getExpectedChainId();
  const current = await detectCurrentNetwork();
  
  if (!current) {
    return {
      isValid: false,
      expectedChainId,
      message: 'Unable to detect current network. Please check your wallet connection.'
    };
  }
  
  const isValid = current.chainId === expectedChainId;
  const expectedNetwork = Object.values(NETWORKS).find(n => n.chainId === expectedChainId);
  
  return {
    isValid,
    currentChainId: current.chainId,
    expectedChainId,
    message: isValid 
      ? `Connected to correct network: ${current.name}`
      : `Network mismatch: Connected to ${current.name} but expected ${expectedNetwork?.displayName || expectedChainId}. Please switch networks in your wallet.`
  };
}

 