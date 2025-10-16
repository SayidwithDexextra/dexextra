import { createPublicClient, defineChain, http } from 'viem';
import { CHAIN_CONFIG } from './contractConfig';

// Define chain from validated environment configuration
const customChain = defineChain({
  id: CHAIN_CONFIG.chainId,
  name: 'hyperliquid_testnet',
  nativeCurrency: { name: 'Testnet ETH', symbol: 'tETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAIN_CONFIG.rpcUrl], webSocket: [CHAIN_CONFIG.wsRpcUrl] },
    public: { http: [CHAIN_CONFIG.rpcUrl], webSocket: [CHAIN_CONFIG.wsRpcUrl] },
  },
});

// Create a public client for reading from configured network
export const publicClient = createPublicClient({
  chain: customChain,
  transport: http(CHAIN_CONFIG.rpcUrl),
});

// Backup RPC URLs in case primary fails
const BACKUP_RPC_URLS = [
  'https://polygon-mainnet.g.alchemy.com/v2/demo',
  'https://rpc-mainnet.matic.network',
  'https://polygon-bor.publicnode.com',
];

// Create client with fallback support
export const createPolygonClient = () => {
  return createPublicClient({
    chain: customChain,
    transport: http(CHAIN_CONFIG.rpcUrl),
  });
};

// Helper to create client with custom RPC
export const createClientWithRPC = (rpcUrl: string) => {
  return createPublicClient({
    chain: customChain,
    transport: http(rpcUrl || CHAIN_CONFIG.rpcUrl),
  });
};

