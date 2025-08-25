import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';

// Create a public client for reading from the Polygon network
export const publicClient = createPublicClient({
  chain: polygon,
  transport: http('https://polygon-rpc.com/'),
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
    chain: polygon,
    transport: http('https://polygon-rpc.com/'),
  });
};

// Helper to create client with custom RPC
export const createClientWithRPC = (rpcUrl: string) => {
  return createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });
};

