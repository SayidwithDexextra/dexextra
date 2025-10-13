import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig'
// Removed contractDeployment import - smart contract functionality deleted

const ALCHEMY_API_BASE = 'https://polygon-mainnet.g.alchemy.com/v2'

// Custom token addresses to include in balance checks
const getCustomTokenAddresses = () => {
  const baseTokens = [
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT on Polygon  
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI on Polygon
  ]
  
  // Always include MockUSDC from current contract configuration
  baseTokens.push(CONTRACT_ADDRESSES.mockUSDC) // MockUSDC from HyperLiquid deployment
  console.log(`🔗 Including MockUSDC from contract config: ${CONTRACT_ADDRESSES.mockUSDC}`)
  
  return baseTokens
}

interface AlchemyTokenBalance {
  contractAddress: string
  tokenBalance: string
  error?: string
}

interface AlchemyTokenBalanceResponse {
  tokenBalances: AlchemyTokenBalance[]
}

interface AlchemyTokenMetadata {
  name: string
  symbol: string
  decimals: number
  logo?: string
}

interface AlchemyTokenMetadataResponse {
  [contractAddress: string]: AlchemyTokenMetadata
}

// JSON-RPC response types for Alchemy endpoints
interface JsonRpcError {
  code: number
  message: string
}

interface AlchemyBalancesRpcResponse {
  jsonrpc: string
  id: number
  result?: AlchemyTokenBalanceResponse
  error?: JsonRpcError
}

interface AlchemyMetadataRpcResponse {
  jsonrpc: string
  id: number
  result?: AlchemyTokenMetadata
  error?: JsonRpcError
}

// Simple in-memory caches (per server instance)
const portfolioCache = new Map<string, { data: any; expiry: number }>()
const tokenMetadataCache = new Map<string, { data: AlchemyTokenMetadata; expiry: number }>()

const CACHE_TTL_MS = 60_000 // 1 minute cache for portfolio and token metadata
const METADATA_BATCH_LIMIT = 15 // Limit metadata RPCs per batch to avoid 429

// Shared delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Fetch token balances using Alchemy Token API (server-side only)
async function fetchTokenBalancesFromAlchemy(
  walletAddress: string,
  tokenAddresses?: string[]
): Promise<AlchemyTokenBalanceResponse> {
  if (!env.ALCHEMY_API_KEY) {
    throw new Error('Alchemy API key not configured')
  }
  
  const url = `${ALCHEMY_API_BASE}/${env.ALCHEMY_API_KEY}`
  
  // Retry with exponential backoff for 429s and transient errors
  const maxRetries = 4
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const requestBody = {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getTokenBalances',
      params: [
        walletAddress,
        tokenAddresses || 'DEFAULT_TOKENS'
      ]
    }

    // Add per-request timeout using AbortController
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (response.status === 429) {
        const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 20_000)
        console.warn(`Alchemy 429 on balances (attempt ${attempt + 1}/${maxRetries + 1}). Backing off ${backoff}ms`)
        await delay(backoff)
        continue
      }

      if (!response.ok) {
        throw new Error(`Alchemy API error: ${response.status}`)
      }

      const data = await response.json() as AlchemyBalancesRpcResponse
      if (data.error) {
        // If Alchemy returns structured error with 429 message, treat similarly
        const message: string = data.error?.message || ''
        if (message.includes('exceeded its compute units') || message.includes('rate limit')) {
          const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 20_000)
          console.warn(`Alchemy rate notice on balances (attempt ${attempt + 1}/${maxRetries + 1}). Backing off ${backoff}ms`)
          await delay(backoff)
          continue
        }
        throw new Error(`Alchemy API error: ${message}`)
      }

      return (data.result as AlchemyTokenBalanceResponse)
    } catch (err) {
      clearTimeout(timeoutId)
      if ((err as Error).name === 'AbortError') {
        const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 10_000)
        console.warn(`Alchemy balances timeout, retrying in ${backoff}ms`)
        await delay(backoff)
        continue
      }
      if (attempt === maxRetries) {
        throw err
      }
      const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 10_000)
      console.warn(`Alchemy balances error '${(err as Error).message}', retrying in ${backoff}ms`)
      await delay(backoff)
    }
  }

  throw new Error('Failed to fetch balances after retries')
}

// Rate limiter for Alchemy API calls
const rateLimiter = {
  lastCallTime: 0,
  minInterval: 100, // Minimum time between calls in ms
  async waitForNextSlot() {
    const now = Date.now();
    const timeToWait = Math.max(0, this.lastCallTime + this.minInterval - now);
    if (timeToWait > 0) {
      await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    this.lastCallTime = Date.now();
  }
};

// Calculate backoff time based on retry count and status
function getBackoffTime(retryCount: number, status?: number): number {
  // For rate limit (429), use longer backoff
  if (status === 429) {
    return Math.min(1000 * Math.pow(2, retryCount + 2), 30000); // Max 30 seconds
  }
  // Regular exponential backoff for other errors
  return 1000 * Math.pow(2, retryCount);
}

// Fetch token metadata using Alchemy Token API (server-side only)
async function fetchTokenMetadataFromAlchemy(
  contractAddresses: string[]
): Promise<AlchemyTokenMetadataResponse> {
  if (!env.ALCHEMY_API_KEY) {
    throw new Error('Alchemy API key not configured')
  }
  
  const url = `${ALCHEMY_API_BASE}/${env.ALCHEMY_API_KEY}`
  const metadata: AlchemyTokenMetadataResponse = {}
  
  // De-duplicate and apply cache
  const uniqueAddresses = Array.from(new Set(contractAddresses.map(a => a.toLowerCase())))

  // Helper to resolve a single address with retries and cache
  const resolveOne = async (address: string) => {
    const cacheKey = address.toLowerCase()
    const cached = tokenMetadataCache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      metadata[address] = cached.data
      return
    }

    const maxRetries = 4
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await rateLimiter.waitForNextSlot()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'alchemy_getTokenMetadata',
            params: [address]
          }),
          signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (response.status === 429) {
          const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 20_000)
          console.warn(`Alchemy 429 on metadata ${address} (attempt ${attempt + 1}/${maxRetries + 1}). Backing off ${backoff}ms`)
          await delay(backoff)
          continue
        }
        if (!response.ok) {
          throw new Error(`API returned non-success response: ${response.status}`)
        }
        const data = await response.json() as AlchemyMetadataRpcResponse
        if (data.result && !data.error) {
          tokenMetadataCache.set(cacheKey, { data: data.result, expiry: Date.now() + CACHE_TTL_MS })
          metadata[address] = data.result
          return
        }
        const message: string = data.error?.message || ''
        if (message.includes('exceeded its compute units') || message.includes('rate limit')) {
          const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 20_000)
          await delay(backoff)
          continue
        }
        throw new Error(message || 'Unknown metadata error')
      } catch (error) {
        clearTimeout(timeoutId)
        if ((error as Error).name === 'AbortError') {
          const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 10_000)
          await delay(backoff)
          continue
        }
        if (attempt === maxRetries) {
          console.error(`Failed metadata for ${address}:`, error)
          return
        }
        const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 10_000)
        await delay(backoff)
      }
    }
  }

  // Process in small batches to limit concurrent pressure
  for (let i = 0; i < uniqueAddresses.length; i += METADATA_BATCH_LIMIT) {
    const batch = uniqueAddresses.slice(i, i + METADATA_BATCH_LIMIT)
    await Promise.all(batch.map(addr => resolveOne(addr)))
    // Small pause between batches to smooth CU/s
    await delay(150)
  }

  return metadata
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('address')

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      )
    }

    // Validate wallet address format (basic validation)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      )
    }

    // Serve from cache when available
    const cacheKey = walletAddress.toLowerCase()
    const cached = portfolioCache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      return NextResponse.json({ success: true, data: cached.data })
    }

    // Fetch balances for both default tokens and our custom tokens
    const customTokenAddresses = getCustomTokenAddresses()
    
    // console.log('🔍 Portfolio API Debug:', {
    //   walletAddress,
    //   customTokenAddresses,
    //   alchemyApiKey: env.ALCHEMY_API_KEY ? '✅ Set' : '❌ Missing'
    // });

    // Sequentialize calls to reduce CU/s bursts
    const defaultTokenBalances = await fetchTokenBalancesFromAlchemy(walletAddress)
    // Small spacing between calls
    await delay(100)
    const customTokenBalances = await fetchTokenBalancesFromAlchemy(walletAddress, customTokenAddresses)
    
    // Combine both results, avoiding duplicates
    const combinedTokens = new Map<string, AlchemyTokenBalance>()
    
    // Add default tokens
    defaultTokenBalances.tokenBalances.forEach(token => {
      combinedTokens.set(token.contractAddress.toLowerCase(), token)
    })
    
    // Add custom tokens (override defaults if there are duplicates)
    customTokenBalances.tokenBalances.forEach(token => {
      combinedTokens.set(token.contractAddress.toLowerCase(), token)
    })
    
    const tokenBalances = {
      tokenBalances: Array.from(combinedTokens.values())
    }
    
    // Debug logging for mock USDC
    const mockUSDCAddress = CONTRACT_ADDRESSES.mockUSDC.toLowerCase()
    const mockUSDCBalance = tokenBalances.tokenBalances.find(token => 
      token.contractAddress.toLowerCase() === mockUSDCAddress
    )
    
    console.log('🔍 Mock USDC Debug:', {
      mockUSDCAddress,
      mockUSDCBalance: mockUSDCBalance?.tokenBalance,
      mockUSDCError: mockUSDCBalance?.error,
      totalTokensFound: tokenBalances.tokenBalances.length
    })
    
    // Filter tokens with non-zero balances to get metadata for
    const nonZeroTokens = tokenBalances.tokenBalances
      .filter(token => token.tokenBalance && token.tokenBalance !== '0x0' && !token.error)
    
    let tokenMetadata: AlchemyTokenMetadataResponse = {}
    
    if (nonZeroTokens.length > 0) {
      const tokenAddresses = nonZeroTokens.map(token => token.contractAddress)
      tokenMetadata = await fetchTokenMetadataFromAlchemy(tokenAddresses)
    }
    
    // Add fallback metadata for mock USDC if it's missing
    const mockUSDCOriginalAddress = CONTRACT_ADDRESSES.mockUSDC
    if (!tokenMetadata[mockUSDCOriginalAddress] && tokenBalances.tokenBalances.some(token => 
      token.contractAddress.toLowerCase() === mockUSDCAddress
    )) {
      console.log('📝 Adding fallback metadata for Mock USDC from contract config')
      tokenMetadata[mockUSDCOriginalAddress] = {
        name: 'HyperLiquid Mock USDC',
        symbol: 'MOCK_USDC',
        decimals: 6,
        logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png'
      }
    }

    const responsePayload = {
      success: true,
      data: {
        tokenBalances: tokenBalances.tokenBalances,
        tokenMetadata
      }
    }

    // Update cache
    portfolioCache.set(cacheKey, { data: responsePayload.data, expiry: Date.now() + CACHE_TTL_MS })

    return NextResponse.json(responsePayload)

  } catch (error) {
    console.error('Error fetching wallet portfolio:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch wallet portfolio',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
} 