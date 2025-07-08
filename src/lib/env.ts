import { z } from 'zod'

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Supabase
  SUPABASE_URL: z.string().url().default('https://placeholder.supabase.co'),
  SUPABASE_ANON_KEY: z.string().min(1).default('placeholder-anon-key'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Database (if using)
  DATABASE_URL: z.string().optional(),

  // Authentication (if using)
  AUTH_SECRET: z.string().min(1).default('dev-secret-key-change-in-production'),
  AUTH_EXPIRES_IN: z.string().min(1).default('7d'),

  // External Services
  API_KEY: z.string().min(1).default('placeholder-api-key'),
  API_URL: z.string().url().default('https://api.example.com'),
  
  // Alchemy API for token balances (optional - app works without it)
  ALCHEMY_API_KEY: z.string().optional(),

  // Feature Flags
  ENABLE_FEATURE_X: z.string().transform((val) => val === 'true').default('false'),
  DEBUG_MODE: z.string().transform((val) => val === 'true').default('false'),
})

/**
 * @type {Record<keyof z.infer<typeof envSchema>, string | undefined>}
 */
const processEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET || 'dev-secret-key-change-in-production',
  AUTH_EXPIRES_IN: process.env.AUTH_EXPIRES_IN || '7d',
  API_KEY: process.env.API_KEY || 'placeholder-api-key',
  API_URL: process.env.API_URL || 'https://api.example.com',
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY || 'KKxzX7tzui3wBU9NTnBLHuZki7c4kHSm' ,
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
    'API_KEY',
    'API_URL',
    // Note: ALCHEMY_API_KEY is optional even in production
  ],
}

const missingVars = requiredVars[parsed.data.NODE_ENV as keyof typeof requiredVars]
  .filter((key) => !parsed.data[key as keyof typeof parsed.data])

if (missingVars.length > 0) {
  console.error(
    `❌ Missing required environment variables for ${parsed.data.NODE_ENV}:`,
    missingVars.join(', ')
  )
  throw new Error('Missing required environment variables')
}

/**
 * Export validated environment variables
 */
export const env = parsed.data 