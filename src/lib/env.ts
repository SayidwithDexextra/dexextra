import { z } from 'zod'

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Supabase (Server-side)
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Supabase (Client-side - prefixed with NEXT_PUBLIC_)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Blockchain Configuration
  RPC_URL: z.string().url().default('https://polygon-rpc.com/'),
  WS_RPC_URL: z.string().url().default('wss://polygon-rpc.com/'),
  CHAIN_ID: z.string().transform(Number).default('137'), // Default to Polygon Mainnet
  
  // Network Configuration
  DEFAULT_NETWORK: z.string().default('polygon'), // polygon, ethereum, mumbai, sepolia, hardhat

  // Contract Addresses (will be populated after deployment)
  VAMM_FACTORY_ADDRESS: z.string().optional(),
  MOCK_USDC_ADDRESS: z.string().optional(),
  MOCK_ORACLE_ADDRESS: z.string().optional(),

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
  
  // Alchemy API for webhook-based event monitoring (required for production)
  ALCHEMY_API_KEY: z.string().optional(),
  
  // Alchemy webhook auth token for webhook management API (required for production)
  ALCHEMY_WEBHOOK_AUTH_TOKEN: z.string().optional(),
  
  // Alchemy webhook signing key for production security
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().optional(),

  // Feature Flags
  ENABLE_FEATURE_X: z.string().transform((val) => val === 'true').default('false'),
  DEBUG_MODE: z.string().transform((val) => val === 'true').default('false'),
})

/**
 * Check if we're running on the client side
 */
const isClientSide = typeof window !== 'undefined'

/**
 * @type {Record<keyof z.infer<typeof envSchema>, string | undefined>}
 */
const processEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  // On client side, fall back to NEXT_PUBLIC_ versions for server-only vars
  SUPABASE_URL: isClientSide ? process.env.NEXT_PUBLIC_SUPABASE_URL : process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: isClientSide ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  
  // Blockchain
  RPC_URL: process.env.RPC_URL || 'https://polygon-rpc.com/',
  WS_RPC_URL: process.env.WS_RPC_URL || 'wss://polygon-rpc.com/',
  CHAIN_ID: process.env.CHAIN_ID || '137',
  DEFAULT_NETWORK: process.env.DEFAULT_NETWORK || 'polygon',
  
  // Contracts
  VAMM_FACTORY_ADDRESS: process.env.VAMM_FACTORY_ADDRESS,
  MOCK_USDC_ADDRESS: process.env.MOCK_USDC_ADDRESS,
  MOCK_ORACLE_ADDRESS: process.env.MOCK_ORACLE_ADDRESS,
  
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
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  ALCHEMY_WEBHOOK_AUTH_TOKEN: process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN,
  ALCHEMY_WEBHOOK_SIGNING_KEY: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY,
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
  development: [], // Development uses defaults for most variables
  test: [], // Test uses defaults for most variables
  production: [
    'APP_URL',
    'AUTH_SECRET',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'API_KEY',
    'API_URL',
    'RPC_URL',
    'ALCHEMY_API_KEY', // Required for webhook-based event monitoring
    'ALCHEMY_WEBHOOK_AUTH_TOKEN', // Required for webhook management API
    // Note: Contract addresses and other blockchain vars are optional but recommended in production
  ],
}

const currentEnv = parsed.data.NODE_ENV
const missingRequiredVars = requiredVars[currentEnv].filter(
  (varName) => !parsed.data[varName as keyof typeof parsed.data]
)

if (missingRequiredVars.length > 0 && currentEnv === 'production') {
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
  
  if (env.VAMM_FACTORY_ADDRESS) {
    contracts.push({
      address: env.VAMM_FACTORY_ADDRESS,
      abi: [], // Will be populated by the event listener
      name: 'vAMM Factory',
      type: 'Factory' as const,
      startBlock: 0, // Start from deployment block
    })
  }
  
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
  
  return contracts
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

if (true) {
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
  if (!isClientSide) {
    console.log('  - Server-side variables loaded ✅')
  } else {
    console.log('  - Client-side mode (using NEXT_PUBLIC_ variables)')
  }  
} 