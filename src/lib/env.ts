import { z } from 'zod'

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Supabase (Server-side) - optional to allow NEXT_PUBLIC fallbacks on Vercel
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Supabase (Client-side - prefixed with NEXT_PUBLIC_)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Blockchain Configuration
  RPC_URL: z.string().url().default('https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-'),
  ARBITRUM_RPC_URL: z.string().url().optional(),
  // Optional backup RPC HTTP URLs
  RPC_URL_BACKUP: z.string().url().optional(),
  // Optional comma-separated list of additional RPC URLs
  RPC_URLS: z.string().optional(),
  WS_RPC_URL: z.string().url().default('wss://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-'),
  // Optional backup WS URL
  WS_RPC_URL_BACKUP: z.string().url().optional(),
  CHAIN_ID: z.string().transform(Number).default('999'), // Default to Polygon Mainnet
  
  // Settlement Configuration (removed - on-chain only system)
  // SETTLEMENT_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  
  // Network Configuration
  DEFAULT_NETWORK: z.string().default('hyperliquid'), // hyperliquid, hyperliquid_testnet, ethereum, mumbai, sepolia, hardhat

  // Core Contract Addresses
  MOCK_USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid USDC token address').optional(),
  MOCK_ORACLE_ADDRESS: z.string().optional(),
  CORE_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid central vault address').optional(),
  LIQUIDATION_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid liquidation manager address').optional(),
  FUTURES_MARKET_FACTORY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid factory address').optional(),
  POSITION_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid position manager address').optional(),
  VAULT_ANALYTICS_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid vault analytics address').optional(),
  DEFAULT_ORDERBOOK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid orderbook address').optional(),
  
  // Legacy Market-Specific Addresses (for backward compatibility only)
  // These should eventually be removed in favor of the dynamic market loading from Supabase
  ALUMINUM_ORDERBOOK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid aluminum orderbook address').optional(),
  ALUMINUM_MARKET_ID: z.string().optional(),
  
  // Order Book System Contract Addresses
  ORDER_ROUTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid order router address').optional(),
  CENTRAL_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid central vault address').optional(),
  SETTLEMENT_ENGINE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid settlement engine address').optional(),
  METRICS_MARKET_FACTORY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid factory address').optional(),
  UMA_ORACLE_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid UMA oracle address').optional(),
  USDC_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid USDC token address').default('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'),

  // Spoke Vault Addresses (per chain) - used for external deposits
  SPOKE_POLYGON_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Polygon spoke vault address').optional(),
  SPOKE_ARBITRUM_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Arbitrum spoke vault address').optional(),
  SPOKE_ARBITRUM_USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Arbitrum USDC address').optional(),
  SPOKE_ETHEREUM_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum spoke vault address').optional(),
  SPOKE_HYPERLIQUID_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Hyperliquid spoke vault address').optional(),

  // Market Table Default Configuration
  DEFAULT_MARKET_DECIMALS: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(18)).default('8'),
  DEFAULT_TICK_SIZE: z.string().transform(val => parseFloat(val)).pipe(z.number().min(0.00000001).max(10)).default('0.01'),
  DEFAULT_MINIMUM_ORDER_SIZE: z.string().transform(val => parseFloat(val)).pipe(z.number().min(0.00000001).max(100)).default('0.1'),
  DEFAULT_DATA_REQUEST_WINDOW_SECONDS: z.string().transform(val => parseInt(val)).pipe(z.number().min(60).max(86400)).default('3600'),

  // Event Listener Configuration
  EVENT_LISTENER_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  EVENT_BATCH_SIZE: z.string().transform(Number).default('400'),
  EVENT_CONFIRMATIONS: z.string().transform(Number).default('1'),
  EVENT_RETRY_ATTEMPTS: z.string().transform(Number).default('3'),
  EVENT_RETRY_DELAY: z.string().transform(Number).default('5000'),

  // Database (if using)
  DATABASE_URL: z.string().optional(),

  // Authentication (if using)
  AUTH_SECRET: z.string().min(1).default('dev-secret-key-change-in-production'),
  AUTH_EXPIRES_IN: z.string().min(1).default('7d'),

  // External Services
  API_KEY: z.string().min(1).default('placeholder-api-key'),
  API_URL: z.string().url().default('https://api.example.com'),
  // Wayback Machine SavePageNow API (server-side optional)
  WAYBACK_API_ACCESS_KEY: z.string().optional(),
  WAYBACK_API_SECRET: z.string().optional(),
  
  // CoinMarketCap API Key
  CMC_API_KEY: z.string().optional(),
  
  // Alchemy API for webhook-based event monitoring (required for production)
  ALCHEMY_API_KEY: z.string().optional(),
  
  // Alchemy webhook auth token for webhook management API (required for production)
  ALCHEMY_WEBHOOK_AUTH_TOKEN: z.string().optional(),
  
  // Alchemy webhook signing key for production security
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().optional(),

  // Order Book System Configuration
  REDIS_URL: z.string().url('Invalid Redis URL').default('redis://localhost:6379'),
  REDIS_TOKEN: z.string().optional(),
  PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format').optional(),
  
  // Service Configuration (on-chain only system)
  // MATCHING_ENGINE_ENABLED: z.string().transform(val => val === 'true').default('true'),
  // SETTLEMENT_QUEUE_ENABLED: z.string().transform(val => val === 'true').default('true'),
  WEBSOCKET_SERVICE_ENABLED: z.string().transform(val => val === 'true').default('true'),
  MONITORING_SERVICE_ENABLED: z.string().transform(val => val === 'true').default('true'),
  
  // Performance Configuration
  MAX_ORDERS_PER_LEVEL: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(1000)).default('100'),
  MAX_BATCH_SIZE: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(1000)).default('50'),
  // SETTLEMENT_INTERVAL_MS: z.string().transform(val => parseInt(val)).pipe(z.number().min(1000).max(60000)).default('5000'), // Removed - on-chain only
  CONFIRMATION_DEPTH: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).default('12'),
  
  // Trading Fees (in basis points)
  MAKER_FEE_RATE: z.string().transform(val => parseInt(val)).pipe(z.number().min(0).max(1000)).default('10'),
  TAKER_FEE_RATE: z.string().transform(val => parseInt(val)).pipe(z.number().min(0).max(1000)).default('15'),

  // Gas configuration
  GAS_BUFFER_PERCENT: z.string().transform(val => parseInt(val)).pipe(z.number().min(0).max(500)).default('80'),
  DEFAULT_GAS_LIMIT: z.string().transform(val => parseInt(val)).pipe(z.number().min(100000).max(30000000)).default('12000000'),
  MIN_GAS_LIMIT: z.string().transform(val => parseInt(val)).pipe(z.number().min(0).max(30000000)).default('0').optional(),
  MAX_GAS_LIMIT: z.string().transform(val => parseInt(val)).pipe(z.number().min(0).max(30000000)).default('0').optional(),
  
  // WebSocket Configuration
  WEBSOCKET_PORT: z.string().transform(val => parseInt(val)).pipe(z.number().min(1000).max(65535)).default('3001'),
  MAX_WEBSOCKET_CONNECTIONS: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(10000)).default('1000'),
  
  // Feature Flags
  ENABLE_FEATURE_X: z.string().transform((val) => val === 'true').default('false'),
  DEBUG_MODE: z.string().transform((val) => val === 'true').default('false'),
})

/**
 * Check if we're running on the client side
 */
const isClientSide = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined'

/**
 * @type {Record<keyof z.infer<typeof envSchema>, string | undefined>}
 */
const processEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  // On client side, fall back to NEXT_PUBLIC_ versions for server-only vars
  SUPABASE_URL: isClientSide ? process.env.NEXT_PUBLIC_SUPABASE_URL : (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
  SUPABASE_ANON_KEY: isClientSide ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  
  // Blockchain
  RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || 'https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-',
  RPC_URL_BACKUP: process.env.RPC_URL_BACKUP,
  RPC_URLS: process.env.RPC_URLS,
  WS_RPC_URL: process.env.WS_RPC_URL || 'wss://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-',
  WS_RPC_URL_BACKUP: process.env.WS_RPC_URL_BACKUP,
  CHAIN_ID: process.env.CHAIN_ID || '999',
  DEFAULT_NETWORK: process.env.DEFAULT_NETWORK || 'hyperliquid',
  
  // Core Contract Addresses
  MOCK_USDC_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS : process.env.MOCK_USDC_ADDRESS,
  MOCK_ORACLE_ADDRESS: process.env.MOCK_ORACLE_ADDRESS,
  CORE_VAULT_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS : process.env.CORE_VAULT_ADDRESS,
  LIQUIDATION_MANAGER_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_LIQUIDATION_MANAGER_ADDRESS : process.env.LIQUIDATION_MANAGER_ADDRESS,
  FUTURES_MARKET_FACTORY_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS : process.env.FUTURES_MARKET_FACTORY_ADDRESS,
  POSITION_MANAGER_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS : process.env.POSITION_MANAGER_ADDRESS,
  VAULT_ANALYTICS_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_VAULT_ANALYTICS_ADDRESS : process.env.VAULT_ANALYTICS_ADDRESS,
  DEFAULT_ORDERBOOK_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS : process.env.DEFAULT_ORDERBOOK_ADDRESS,
  
  // Legacy Market-Specific Addresses
  ALUMINUM_ORDERBOOK_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_ALUMINUM_ORDERBOOK_ADDRESS : process.env.ALUMINUM_ORDERBOOK_ADDRESS,
  ALUMINUM_MARKET_ID: isClientSide ? process.env.NEXT_PUBLIC_ALUMINUM_MARKET_ID : process.env.ALUMINUM_MARKET_ID,
  
  // Market Table Default Configuration
  DEFAULT_MARKET_DECIMALS: process.env.DEFAULT_MARKET_DECIMALS || '8',
  DEFAULT_TICK_SIZE: process.env.DEFAULT_TICK_SIZE || '0.01',
  DEFAULT_MINIMUM_ORDER_SIZE: process.env.DEFAULT_MINIMUM_ORDER_SIZE || '0.1',
  DEFAULT_DATA_REQUEST_WINDOW_SECONDS: process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || '3600',
  
  // Event Listener
  EVENT_LISTENER_ENABLED: process.env.EVENT_LISTENER_ENABLED || 'true',
  EVENT_BATCH_SIZE: process.env.EVENT_BATCH_SIZE || '400',
  EVENT_CONFIRMATIONS: process.env.EVENT_CONFIRMATIONS || '1',
  EVENT_RETRY_ATTEMPTS: process.env.EVENT_RETRY_ATTEMPTS || '3',
  EVENT_RETRY_DELAY: process.env.EVENT_RETRY_DELAY || '5000',
  
  DATABASE_URL: process.env.DATABASE_URL,
  // Server-only variables with client-side defaults
  AUTH_SECRET: isClientSide ? 'client-side-placeholder' : (process.env.AUTH_SECRET || 'dev-secret-key-change-in-production'),
  AUTH_EXPIRES_IN: process.env.AUTH_EXPIRES_IN || '7d',
  API_KEY: isClientSide ? 'client-side-placeholder' : (process.env.API_KEY || 'placeholder-api-key'),
  API_URL: isClientSide ? 'https://api.example.com' : (process.env.API_URL || 'https://api.example.com'),
  WAYBACK_API_ACCESS_KEY: process.env.WAYBACK_API_ACCESS_KEY,
  WAYBACK_API_SECRET: process.env.WAYBACK_API_SECRET,
  CMC_API_KEY: process.env.CMC_API_KEY,
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  ALCHEMY_WEBHOOK_AUTH_TOKEN: process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN,
  ALCHEMY_WEBHOOK_SIGNING_KEY: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY,
  
  // Order Book System Configuration
  ORDER_ROUTER_ADDRESS: process.env.ORDER_ROUTER_ADDRESS,
  CENTRAL_VAULT_ADDRESS: process.env.CENTRAL_VAULT_ADDRESS,
  SETTLEMENT_ENGINE_ADDRESS: process.env.SETTLEMENT_ENGINE_ADDRESS,
  METRICS_MARKET_FACTORY_ADDRESS: process.env.METRICS_MARKET_FACTORY_ADDRESS,
  UMA_ORACLE_MANAGER_ADDRESS: process.env.UMA_ORACLE_MANAGER_ADDRESS,
  USDC_TOKEN_ADDRESS: process.env.USDC_TOKEN_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',

  // Spoke Vault Addresses (allow NEXT_PUBLIC_ fallbacks on client)
  SPOKE_POLYGON_VAULT_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_SPOKE_POLYGON_VAULT_ADDRESS : process.env.SPOKE_POLYGON_VAULT_ADDRESS,
  SPOKE_ARBITRUM_VAULT_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_SPOKE_ARBITRUM_VAULT_ADDRESS : process.env.SPOKE_ARBITRUM_VAULT_ADDRESS,
  SPOKE_ARBITRUM_USDC_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_SPOKE_ARBITRUM_USDC_ADDRESS : process.env.SPOKE_ARBITRUM_USDC_ADDRESS,
  SPOKE_ETHEREUM_VAULT_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_SPOKE_ETHEREUM_VAULT_ADDRESS : process.env.SPOKE_ETHEREUM_VAULT_ADDRESS,
  SPOKE_HYPERLIQUID_VAULT_ADDRESS: isClientSide ? process.env.NEXT_PUBLIC_SPOKE_HYPERLIQUID_VAULT_ADDRESS : process.env.SPOKE_HYPERLIQUID_VAULT_ADDRESS,
  
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_TOKEN: process.env.REDIS_TOKEN,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  
  // Service Configuration (on-chain only system)
  // MATCHING_ENGINE_ENABLED: process.env.MATCHING_ENGINE_ENABLED || 'true',
  // SETTLEMENT_QUEUE_ENABLED: process.env.SETTLEMENT_QUEUE_ENABLED || 'true',
  WEBSOCKET_SERVICE_ENABLED: process.env.WEBSOCKET_SERVICE_ENABLED || 'true',
  MONITORING_SERVICE_ENABLED: process.env.MONITORING_SERVICE_ENABLED || 'true',
  
  // Performance Configuration
  MAX_ORDERS_PER_LEVEL: process.env.MAX_ORDERS_PER_LEVEL || '100',
  MAX_BATCH_SIZE: process.env.MAX_BATCH_SIZE || '50',
  // SETTLEMENT_INTERVAL_MS: process.env.SETTLEMENT_INTERVAL_MS || '5000', // Removed - on-chain only
  CONFIRMATION_DEPTH: process.env.CONFIRMATION_DEPTH || '12',
  
  // Trading Fees
  MAKER_FEE_RATE: process.env.MAKER_FEE_RATE || '10',
  TAKER_FEE_RATE: process.env.TAKER_FEE_RATE || '15',

  // Gas configuration
  GAS_BUFFER_PERCENT: process.env.GAS_BUFFER_PERCENT || '80',
  DEFAULT_GAS_LIMIT: process.env.DEFAULT_GAS_LIMIT || '12000000',
  MIN_GAS_LIMIT: process.env.MIN_GAS_LIMIT || '0',
  MAX_GAS_LIMIT: process.env.MAX_GAS_LIMIT || '0',
  
  // WebSocket Configuration
  WEBSOCKET_PORT: process.env.WEBSOCKET_PORT || '3001',
  MAX_WEBSOCKET_CONNECTIONS: process.env.MAX_WEBSOCKET_CONNECTIONS || '1000',
  
  ENABLE_FEATURE_X: process.env.ENABLE_FEATURE_X || 'false',
  DEBUG_MODE: process.env.DEBUG_MODE || 'false',
}

/**
 * Validate that our environment variables match the schema
 */
const parsed = envSchema.safeParse(processEnv)

if (!parsed.success) {
  console.error(
    '❌ Invalid environment variables:',
    JSON.stringify(parsed.error.format(), null, 2)
  )
  throw new Error('Invalid environment variables')
}

/**
 * Validate that required environment variables are set for the current environment
 */
const requiredVars = {
  development: { client: [], server: [] },
  test: { client: [], server: [] },
  production: {
    client: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ],
    server: [
      'APP_URL',
      'AUTH_SECRET', 
      // Supabase server vars are optional when NEXT_PUBLIC_* are provided
      'API_KEY',
      'API_URL',
      'RPC_URL',
      'ALCHEMY_API_KEY',
      'ALCHEMY_WEBHOOK_AUTH_TOKEN',
    ]
  },
}

const currentEnv = parsed.data.NODE_ENV
const requiredForCurrentContext = isClientSide 
  ? requiredVars[currentEnv]?.client || []
  : requiredVars[currentEnv]?.server || []

const missingRequiredVars = requiredForCurrentContext.filter(
  (varName) => !parsed.data[varName as keyof typeof parsed.data]
)

if (missingRequiredVars.length > 0 && currentEnv === 'production' && !isClientSide) {
  console.error(
    `❌ Missing required environment variables for ${currentEnv}:`,
    missingRequiredVars
  )
  throw new Error(`Missing required environment variables: ${missingRequiredVars.join(', ')}`)
}

/**
 * Validated environment variables with proper types
 */
export const env = parsed.data

/**
 * Helper function to get contract configuration from environment
 */
export function getContractConfig() {
  const contracts = []
  
  if (env.MOCK_USDC_ADDRESS) {
    contracts.push({
      address: env.MOCK_USDC_ADDRESS,
      abi: [],
      name: 'Mock USDC',
      type: 'Token' as const,
      startBlock: 0,
    })
  }
  
  if (env.MOCK_ORACLE_ADDRESS) {
    contracts.push({
      address: env.MOCK_ORACLE_ADDRESS,
      abi: [],
      name: 'Mock Oracle',
      type: 'Oracle' as const,
      startBlock: 0,
    })
  }
  
  if (env.CORE_VAULT_ADDRESS) {
    contracts.push({
      address: env.CORE_VAULT_ADDRESS,
      abi: [],
      name: 'Core Vault',
      type: 'Vault' as const,
      startBlock: 0,
    })
  }
  
  if (env.LIQUIDATION_MANAGER_ADDRESS) {
    contracts.push({
      address: env.LIQUIDATION_MANAGER_ADDRESS,
      abi: [],
      name: 'Liquidation Manager',
      type: 'LiquidationManager' as const,
      startBlock: 0,
    })
  }
  
  if (env.FUTURES_MARKET_FACTORY_ADDRESS) {
    contracts.push({
      address: env.FUTURES_MARKET_FACTORY_ADDRESS,
      abi: [],
      name: 'Futures Market Factory',
      type: 'Factory' as const,
      startBlock: 0,
    })
  }
  
  if (env.POSITION_MANAGER_ADDRESS) {
    contracts.push({
      address: env.POSITION_MANAGER_ADDRESS,
      abi: [],
      name: 'Position Manager',
      type: 'PositionManager' as const,
      startBlock: 0,
    })
  }
  
  if (env.VAULT_ANALYTICS_ADDRESS) {
    contracts.push({
      address: env.VAULT_ANALYTICS_ADDRESS,
      abi: [],
      name: 'Vault Analytics',
      type: 'VaultAnalytics' as const,
      startBlock: 0,
    })
  }
  
  return contracts
}

/**
 * Get core contract addresses
 */
export function getCoreContractAddresses() {
  return {
    mockUSDC: env.MOCK_USDC_ADDRESS,
    coreVault: env.CORE_VAULT_ADDRESS,
    liquidationManager: env.LIQUIDATION_MANAGER_ADDRESS,
    futuresMarketFactory: env.FUTURES_MARKET_FACTORY_ADDRESS,
    positionManager: env.POSITION_MANAGER_ADDRESS,
    vaultAnalytics: env.VAULT_ANALYTICS_ADDRESS,
    defaultOrderBook: env.DEFAULT_ORDERBOOK_ADDRESS,
    
    // Legacy market-specific addresses (for backward compatibility)
    aluminumOrderBook: env.ALUMINUM_ORDERBOOK_ADDRESS,
    aluminumMarketId: env.ALUMINUM_MARKET_ID,
  }
}

/**
 * Get order book system contract configuration
 */
export function getOrderBookContractConfig() {
  return {
    orderRouter: env.ORDER_ROUTER_ADDRESS,
    centralVault: env.CENTRAL_VAULT_ADDRESS,
    settlementEngine: env.SETTLEMENT_ENGINE_ADDRESS,
    metricsMarketFactory: env.METRICS_MARKET_FACTORY_ADDRESS,
    umaOracleManager: env.UMA_ORACLE_MANAGER_ADDRESS,
    usdcToken: env.USDC_TOKEN_ADDRESS,
  }
}

/**
 * Get market default configuration
 */
export function getMarketDefaults() {
  return {
    decimals: env.DEFAULT_MARKET_DECIMALS,
    tickSize: env.DEFAULT_TICK_SIZE,
    minimumOrderSize: env.DEFAULT_MINIMUM_ORDER_SIZE,
    dataRequestWindowSeconds: env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS,
  }
}

/**
 * Get service configuration for order book system
 */
export function getServiceConfig() {
  return {
    matchingEngineEnabled: false, // Disabled - on-chain only system
    settlementQueueEnabled: false, // Disabled - on-chain only system
    websocketServiceEnabled: env.WEBSOCKET_SERVICE_ENABLED,
    monitoringServiceEnabled: env.MONITORING_SERVICE_ENABLED,
  }
}

/**
 * Get performance configuration
 */
export function getPerformanceConfig() {
  return {
    maxOrdersPerLevel: env.MAX_ORDERS_PER_LEVEL,
    maxBatchSize: env.MAX_BATCH_SIZE,
    settlementInterval: 5000, // Fixed value - on-chain only system
    confirmationDepth: env.CONFIRMATION_DEPTH,
    makerFeeRate: env.MAKER_FEE_RATE,
    takerFeeRate: env.TAKER_FEE_RATE,
  }
}

/**
 * Get Redis configuration
 */
export function getRedisConfig() {
  return {
    url: env.REDIS_URL,
    token: env.REDIS_TOKEN,
  }
}

/**
 * Get WebSocket configuration
 */
export function getWebSocketConfig() {
  return {
    port: env.WEBSOCKET_PORT,
    maxConnections: env.MAX_WEBSOCKET_CONNECTIONS,
  }
}

/**
 * Get event listener configuration from environment
 */
export function getEventListenerConfig() {
  return {
    rpcUrl: env.RPC_URL,
    wsRpcUrl: env.WS_RPC_URL,
    contracts: getContractConfig(),
    batchSize: env.EVENT_BATCH_SIZE,
    confirmations: env.EVENT_CONFIRMATIONS,
    retryAttempts: env.EVENT_RETRY_ATTEMPTS,
    retryDelay: env.EVENT_RETRY_DELAY,
  }
}

const environmentType = isClientSide ? 'client-side' : 'server-side'
console.log(`✅ Environment variables validated successfully (${environmentType})`)

if (false) {
   console.log('🐛 Debug mode enabled')
   console.log(`📋 Environment configuration (${environmentType}):`)
   console.log('  - NODE_ENV:', env.NODE_ENV)
   console.log('  - RPC_URL:', env.RPC_URL)
   console.log('  - CHAIN_ID:', env.CHAIN_ID)
   console.log('  - Event Listener Enabled:', env.EVENT_LISTENER_ENABLED)
   console.log('  - Contracts configured:', getContractConfig().length)
   console.log('  - ALCHEMY_API_KEY:', env.ALCHEMY_API_KEY)  
   console.log('  - ALCHEMY_WEBHOOK_AUTH_TOKEN:', env.ALCHEMY_WEBHOOK_AUTH_TOKEN)
   console.log('  - ALCHEMY_WEBHOOK_SIGNING_KEY:', env.ALCHEMY_WEBHOOK_SIGNING_KEY)
   console.log('  - CMC_API_KEY:', env.CMC_API_KEY)
  if (!isClientSide) {
     console.log('  - Server-side variables loaded ✅')
  } else {
     console.log('  - Client-side mode (using NEXT_PUBLIC_ variables)')
  }  
}