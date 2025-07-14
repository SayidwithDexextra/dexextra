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
    // Add your deployed contract addresses for Polygon Mainnet here
    // VAMM_FACTORY: '0x...',
    // MOCK_USDC: '0x...',
    // MOCK_ORACLE: '0x...',
  },
  mumbai: {
    // Add your deployed contract addresses for Mumbai testnet here
  },
  ethereum: {
    // Add your deployed contract addresses for Ethereum Mainnet here
  },
  sepolia: {
    // Add your deployed contract addresses for Sepolia testnet here
  },
  hardhat: {
    // These will be populated when deploying to local Hardhat network
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

 