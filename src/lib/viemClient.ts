import { createPublicClient, defineChain, fallback, http, webSocket } from 'viem';
import { CHAIN_CONFIG } from './contractConfig';
import { env } from './env';

// Define chain from validated environment configuration
const customChain = defineChain({
  id: CHAIN_CONFIG.chainId,
  name: 'hyperliquid',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAIN_CONFIG.rpcUrl], webSocket: [CHAIN_CONFIG.wsRpcUrl] },
    public: { http: [CHAIN_CONFIG.rpcUrl], webSocket: [CHAIN_CONFIG.wsRpcUrl] },
  },
});

// Multi-RPC fallback client (quorum=1, retry on 429/5xx)
const additionalRpcUrls: string[] = [];
if (env.RPC_URL_BACKUP) additionalRpcUrls.push(env.RPC_URL_BACKUP);
if (env.RPC_URLS) {
  additionalRpcUrls.push(
    ...env.RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)
  );
}
const uniqueRpcUrls = Array.from(new Set([CHAIN_CONFIG.rpcUrl, env.RPC_URL, ...additionalRpcUrls].filter(Boolean)));
const fallbackTransports = uniqueRpcUrls.map((url) => http(url, { retryCount: 2, timeout: 10_000 }));

export const publicClient = createPublicClient({
  chain: customChain,
  transport: fallback(fallbackTransports, { rank: false }),
});

// Backup RPC URLs configurable via env if needed (kept for future extension)
const BACKUP_RPC_URLS: string[] = [];

// Create client with fallback support
export const createPolygonClient = () => {
  return createPublicClient({
    chain: customChain,
    transport: fallback(fallbackTransports.length ? fallbackTransports : [http(CHAIN_CONFIG.rpcUrl)]),
  });
};

// Helper to create client with custom RPC
export const createClientWithRPC = (rpcUrl: string) => {
  return createPublicClient({
    chain: customChain,
    transport: http(rpcUrl || CHAIN_CONFIG.rpcUrl),
  });
};

// WebSocket client (if WS RPC is configured)
export const createWsClient = () => {
  if (!CHAIN_CONFIG.wsRpcUrl) {
    throw new Error('WS RPC URL not configured');
  }
  // viem currently uses a single WS URL; prefer primary, fallback can be handled by recreating client on error elsewhere
  return createPublicClient({
    chain: customChain,
    transport: webSocket(CHAIN_CONFIG.wsRpcUrl),
  });
};

