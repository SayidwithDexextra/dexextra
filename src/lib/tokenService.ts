import { TokenBalance, NFTItem, WalletPortfolio } from '@/types/wallet'
import { env } from './env'
import axios, { AxiosRequestConfig } from 'axios'

// Alchemy API configuration
const ALCHEMY_API_BASE = 'https://eth-mainnet.g.alchemy.com/v2'

// Minimum USD value threshold for displaying tokens
const MIN_TOKEN_VALUE_USD = 0.01

// Enhanced token icons mapping
const TOKEN_ICONS: Record<string, string> = {
  ETH: '💎',
  HYPE: '⚡',
  USDC: '💵',
  USDT: '💴',
  DAI: '💰',
  WETH: '🔷',
  MATIC: '🟣',
  LINK: '🔗',
  UNI: '🦄',
  AAVE: '👻',
  COMP: '🏛️',
  MKR: '🎯',
  SNX: '⚡',
  CRV: '🌊',
  SUSHI: '🍣',
  // Add more as needed
}

// Alchemy API types
interface AlchemyTokenBalance {
  contractAddress: string
  tokenBalance: string
  error?: string
}

interface AlchemyTokenMetadata {
  decimals: number
  name: string
  symbol: string
  logo?: string
}

interface AlchemyTokenBalanceResponse {
  address: string
  tokenBalances: AlchemyTokenBalance[]
}

interface AlchemyApiResponse {
  tokenBalances: AlchemyTokenBalance[]
  tokenMetadata?: AlchemyTokenMetadataResponse
}

interface AlchemyTokenMetadataResponse {
  [contractAddress: string]: AlchemyTokenMetadata
}

interface TokenPriceData {
  symbol: string
  price: number
  price_change_percentage_24h: number
}

interface EthereumProvider {
  request: (args: { method: string; params?: any[] }) => Promise<any>
}

// Fetch token balances and metadata using our API route (which calls Alchemy server-side)
async function fetchTokenBalancesFromAlchemy(
  walletAddress: string,
  tokenAddresses?: string[]
): Promise<AlchemyApiResponse> {
  try {
    console.log("🔄 Fetching token balances for:", walletAddress)
    
    // Call our server-side API route instead of Alchemy directly
    const url = `/api/wallet/portfolio?address=${encodeURIComponent(walletAddress)}`
    
    const response = await axiosWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }, 15000)

    if (response.status !== 200) {
      throw new Error(`Portfolio API error: ${response.status}`)
    }

    // Type the response data properly
    const apiResponse = response.data as { 
      success: boolean; 
      data?: AlchemyApiResponse; 
      error?: string 
    }

    if (!apiResponse.success) {
      throw new Error(`Portfolio API error: ${apiResponse.error || 'Unknown error'}`)
    }

    if (!apiResponse.data) {
      throw new Error('No data returned from portfolio API')
    }

    // Return both token balances and metadata
    return apiResponse.data
  } catch (error) {
    console.error('Error fetching token balances from Alchemy:', error)
    throw error
  }
}

// Note: fetchTokenMetadataFromAlchemy is now handled server-side in /api/wallet/portfolio
// This prevents client-side access to ALCHEMY_API_KEY

// Get token balance using ERC-20 contract (fallback method - currently unused)
async function _getTokenBalance(
  provider: EthereumProvider,
  tokenAddress: string,
  walletAddress: string,
  decimals: number = 18
): Promise<string> {
  try {
    // ERC-20 balanceOf method signature
    const balanceOfMethodId = '0x70a08231'
    const paddedAddress = walletAddress.slice(2).padStart(64, '0')
    const data = balanceOfMethodId + paddedAddress

    const result = await provider.request({
      method: 'eth_call',
      params: [
        {
          to: tokenAddress,
          data: data,
        },
        'latest',
      ],
    })

    if (result && result !== '0x') {
      const balance = parseInt(result, 16)
      return (balance / Math.pow(10, decimals)).toString()
    }

    return '0'
  } catch (error) {
    console.error(`Error fetching token balance for ${tokenAddress}:`, error)
    return '0'
  }
}

// Get ETH balance from connected provider
async function getEthBalance(provider: EthereumProvider, address: string): Promise<string> {
  try {
    const balance = await provider.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })
    
    if (balance) {
      const balanceInEth = parseInt(balance, 16) / Math.pow(10, 18)
      return balanceInEth.toString()
    }
    
    return '0'
  } catch (error) {
    console.error('Error fetching ETH balance:', error)
    return '0'
  }
}

// Arbitrum mainnet RPC URL (fallback to public RPC if env not set)
const ARBITRUM_RPC_URL = env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'

// Get ETH balance specifically from Arbitrum mainnet
async function getArbitrumEthBalance(address: string): Promise<string> {
  try {
    const response = await fetch(ARBITRUM_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    })

    const data = await response.json()
    
    if (data.result) {
      const balanceInEth = parseInt(data.result, 16) / Math.pow(10, 18)
      return balanceInEth.toString()
    }
    
    return '0'
  } catch (error) {
    console.error('Error fetching Arbitrum ETH balance:', error)
    return '0'
  }
}

// Rate limiting for CoinGecko API
let lastPriceAPICall = 0
const PRICE_API_COOLDOWN = 10000 // 10 seconds between calls

// Cache for price data to avoid returning empty on rate limit
// Pre-seed with fallback ETH price in case API fails initially
let cachedPriceData: Record<string, TokenPriceData> = {
  'ETH': { symbol: 'ETH', price: 2000, price_change_percentage_24h: 0 }
}

// Enhanced retry mechanism with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      console.warn(`Attempt ${attempt + 1} failed:`, error)
      
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000)
         console.log(`Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

// Fetch token prices from our API route to avoid CORS issues
export async function fetchTokenPrices(tokenSymbols: string[]): Promise<Record<string, TokenPriceData>> {
  try {
    // Rate limiting protection - return cached data if within cooldown
    const now = Date.now()
    if (now - lastPriceAPICall < PRICE_API_COOLDOWN) {
       console.log('Rate limiting: using cached price data', cachedPriceData)
      return cachedPriceData
    }
    
    if (tokenSymbols.length === 0) {
       console.log('No token symbols provided for price fetching')
      return cachedPriceData
    }
    
    // Limit to 50 tokens per request
    const limitedTokens = tokenSymbols.slice(0, 50)
    const tokensParam = limitedTokens.join(',')
    
     console.log('Fetching prices for tokens:', limitedTokens)
    
    // Use retry mechanism for the API call
    const priceData = await retryWithBackoff(async (): Promise<Record<string, any>> => {
      const response = await fetch(`/api/token-prices?tokens=${encodeURIComponent(tokensParam)}`, {
        headers: {
          'Accept': 'application/json',
        },
        // Add timeout
        signal: AbortSignal.timeout(15000)
      })
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('API rate limit hit')
          return {}
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json() as { error?: string; [key: string]: any }
      
      if (data.error) {
        throw new Error(data.error)
      }
      
      return data
    }, 3, 1000)
    
    lastPriceAPICall = now
    // Cache the price data for rate-limited requests
    cachedPriceData = { ...cachedPriceData, ...priceData }
     console.log('Successfully fetched prices for:', Object.keys(priceData), 'cached:', cachedPriceData)
    return priceData
    
  } catch (error) {
    console.error('Error fetching token prices after all retries:', error)
    console.log('📊 Using fallback cached price data:', cachedPriceData)
    
    // Reset rate limiting on error to allow immediate retry next time
    lastPriceAPICall = 0
    
    // Return cached data if available (with fallback ETH price)
    return cachedPriceData
  }
}

// Format token balance for display  
function formatTokenBalance(balance: string, _decimals: number): string {
  const num = parseFloat(balance)
  
  if (num === 0) return '0'
  if (num < 0.001) return '<0.001'
  if (num < 1) return num.toFixed(6)
  if (num < 1000) return num.toFixed(4)
  if (num < 1000000) return (num / 1000).toFixed(2) + 'K'
  if (num < 1000000000) return (num / 1000000).toFixed(2) + 'M'
  return (num / 1000000000).toFixed(2) + 'B'
}

// Format token value for display
function formatTokenValue(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Convert hex balance to decimal
function hexToDecimal(hex: string, decimals: number): string {
  if (!hex || hex === '0x' || hex === '0x0') return '0'
  
  try {
    const balance = BigInt(hex)
    const divisor = BigInt(10) ** BigInt(decimals)
    
    // Use BigInt division to maintain precision
    const wholePart = balance / divisor
    const remainder = balance % divisor
    
    if (remainder === BigInt(0)) {
      return wholePart.toString()
    }
    
    // Calculate decimal part with precision
    const decimalPart = Number(remainder) / Number(divisor)
    const result = Number(wholePart) + decimalPart
    
    // Return with appropriate precision
    return result.toFixed(18).replace(/\.?0+$/, '')
  } catch (error) {
    console.error('Error converting hex to decimal:', error)
    return '0'
  }
}

// Validate Ethereum address format
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

// Enhanced function to fetch complete portfolio data using Alchemy
export async function fetchWalletPortfolio(
  provider: EthereumProvider,
  walletAddress: string
): Promise<WalletPortfolio> {
  try {
    // Always display as Arbitrum ETH
    const nativeSymbol = 'ETH'
    const nativeName = 'Ethereum (Arbitrum)'
    const nativeIcon = TOKEN_ICONS['ETH'] || '💎'
    // Validate wallet address format
    if (!isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format')
    }

    // Get ETH balance from Arbitrum mainnet
    const ethBalance = await getArbitrumEthBalance(walletAddress)
    
    const tokens: TokenBalance[] = []
    let totalValue = 0
    
    try {
      // Try to fetch all token balances and metadata using Alchemy API
      const alchemyResponse = await fetchTokenBalancesFromAlchemy(walletAddress)

       console.log("🔄 Alchemy response:", alchemyResponse)
      
      // Filter out tokens with zero balances
      const nonZeroTokens = alchemyResponse.tokenBalances
        .filter(token => token.tokenBalance && token.tokenBalance !== '0x0' && !token.error)
      
      if (nonZeroTokens.length > 0) {
         console.log("🔄 Non-zero tokens:", nonZeroTokens)
        // Token metadata is already included in the response
        const tokenMetadata = alchemyResponse.tokenMetadata || {}
         console.log("🔄 Token metadata:", tokenMetadata)  
        
        // Get symbols for price fetching
        const tokenSymbols = Object.values(tokenMetadata).map(meta => meta.symbol)
        // Fetch ETH price for Arbitrum native token
        tokenSymbols.push(nativeSymbol)
        
        // Fetch prices
        const priceData = await fetchTokenPrices(tokenSymbols)
        
        // Add native first (always include regardless of value)
        const nativePrice = priceData[nativeSymbol]?.price || 0
        const nativeValue = parseFloat(ethBalance) * nativePrice
        totalValue += nativeValue
        
        tokens.push({
          symbol: nativeSymbol,
          name: nativeName,
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: nativePrice,
          value: nativeValue,
          changePercent24h: priceData[nativeSymbol]?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(nativeValue),
          icon: nativeIcon,
        })
        
        // Process other tokens and filter by minimum USD value
        nonZeroTokens.forEach(alchemyToken => {
          const metadata = tokenMetadata[alchemyToken.contractAddress]
          if (!metadata) return
          
          const balance = hexToDecimal(alchemyToken.tokenBalance, metadata.decimals)
          const balanceNum = parseFloat(balance)
          
          if (balanceNum > 0) {
            const priceInfo = priceData[metadata.symbol]
            const price = priceInfo?.price || 0
            const value = balanceNum * price
            
            // Only include tokens with value >= minimum threshold
            if (value >= MIN_TOKEN_VALUE_USD) {
              totalValue += value
              
              tokens.push({
                symbol: metadata.symbol,
                name: metadata.name,
                balance,
                decimals: metadata.decimals,
                address: alchemyToken.contractAddress,
                price,
                value,
                changePercent24h: priceInfo?.price_change_percentage_24h || 0,
                balanceFormatted: formatTokenBalance(balance, metadata.decimals),
                valueFormatted: formatTokenValue(value),
                icon: TOKEN_ICONS[metadata.symbol] || '🪙',
              })
            }
          }
        })

      } else {
        // If no tokens found via Alchemy, add just native (always include regardless of value)
        console.log('📊 No Alchemy tokens, fetching ETH price for symbol:', nativeSymbol)
        const priceData = await fetchTokenPrices([nativeSymbol])
        console.log('📊 Price data received:', priceData)
        const nativePrice = priceData[nativeSymbol]?.price || 0
        console.log('📊 Native price:', nativePrice, 'ETH balance:', ethBalance)
        const nativeValue = parseFloat(ethBalance) * nativePrice
        console.log('📊 Calculated native value:', nativeValue)
        totalValue += nativeValue
        
        tokens.push({
          symbol: nativeSymbol,
          name: nativeName,
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: nativePrice,
          value: nativeValue,
          changePercent24h: priceData[nativeSymbol]?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(nativeValue),
          icon: nativeIcon,
        })
      }
          } catch (alchemyError) {
        console.error('Alchemy API failed, no fallback available for all tokens:', alchemyError)
        
                // When Alchemy fails, just add native as we can't get all user tokens without it
        const priceData = await fetchTokenPrices([nativeSymbol])
        const nativePrice = priceData[nativeSymbol]?.price || 0
        const nativeValue = parseFloat(ethBalance) * nativePrice
        totalValue += nativeValue
        
        tokens.push({
          symbol: nativeSymbol,
          name: nativeName,
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: nativePrice,
          value: nativeValue,
          changePercent24h: priceData[nativeSymbol]?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(nativeValue),
          icon: nativeIcon,
        })
    }
    
    // Sort tokens by value (descending)
    tokens.sort((a, b) => (b.value || 0) - (a.value || 0))
    
    // Get native token value (HYPE for Hyperliquid, ETH otherwise)
    const nativeToken = tokens.find(t => t.symbol === nativeSymbol)
    const nativeTokenValue = nativeToken?.value || 0
    
    return {
      totalValue: totalValue.toString(),
      totalValueFormatted: formatTokenValue(totalValue),
      ethBalance,
      ethBalanceFormatted: formatTokenBalance(ethBalance, 18),
      ethValue: nativeTokenValue.toString(),
      ethValueFormatted: formatTokenValue(nativeTokenValue),
      tokens,
      nfts: [], // NFT fetching would be implemented separately
      isLoading: false,
      lastUpdated: new Date(),
    }
  } catch (error) {
    console.error('Error fetching wallet portfolio:', error)
    
    // Return empty portfolio on error
    return {
      totalValue: '0',
      totalValueFormatted: '$0.00',
      ethBalance: '0',
      ethBalanceFormatted: '0',
      ethValue: '0',
      ethValueFormatted: '$0.00',
      tokens: [],
      nfts: [],
      isLoading: false,
      lastUpdated: new Date(),
    }
  }
}

// Fetch NFTs for a wallet (placeholder implementation)
export async function fetchWalletNFTs(_walletAddress: string): Promise<NFTItem[]> {
  // This would integrate with OpenSea API or Alchemy NFT API
  // For now, return empty array
  return []
}

// Create an axios request with timeout and retry logic
async function axiosWithTimeout(url: string, options: AxiosRequestConfig = {}, timeoutMs: number = 30000) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log(`🔄 Making request to: ${url} (attempt ${attempt + 1}/${maxRetries})`)
      console.log("📝 Request options:", JSON.stringify(options, null, 2))
      
      const config: AxiosRequestConfig = {
        ...options,
        url,
        timeout: timeoutMs,
      }

      const response = await axios(config)
      console.log("✅ Request successful:", response.status, response.statusText)
      return response
      
    } catch (error) {
      console.error(`❌ Request failed (attempt ${attempt + 1}/${maxRetries}):`, error)
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          console.error("⏱️  Request timed out")
        }
        if (error.response) {
          console.error("📋 Response data:", error.response.data)
          console.error("📊 Response status:", error.response.status)
          console.error("📋 Response headers:", error.response.headers)
        } else if (error.request) {
          console.error("📡 No response received:", error.request)
        }
      }

      // If this was our last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error
      }

      // Calculate delay for next retry using exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      console.log(`Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
      
      attempt++
    }
  }

  // This should never be reached due to the throw in the last attempt
  throw new Error('Request failed after all retries')
}

// Refresh token prices periodically with enhanced error handling
export function createTokenPriceUpdater(
  onPriceUpdate: (prices: Record<string, TokenPriceData>) => void,
  tokens: string[] = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'USDC', 'ADA', 'AVAX', 'DOGE', 'TRX', 'LINK', 'DOT', 'MATIC', 'UNI', 'LTC']
): () => void {
  let retryCount = 0
  const maxRetries = 3
  
  const updatePrices = async () => {
    try {
       console.log('Periodic price update started')
      const prices = await fetchTokenPrices(tokens)
      
      if (Object.keys(prices).length > 0) {
         console.log('Periodic price update successful')
        onPriceUpdate(prices)
        retryCount = 0 // Reset retry count on success
      } else {
        // No price data received - handle gracefully without throwing
        console.warn('No price data received from API, will retry')
        
        // Increment retry count and try again if under limit
        if (retryCount < maxRetries) {
          retryCount++
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000)
           console.log(`Retrying price update in ${delay}ms...`)
          setTimeout(updatePrices, delay)
        } else {
          console.warn('Max retries reached for price update, will try again on next cycle')
          retryCount = 0 // Reset for next cycle
        }
      }
    } catch (error) {
      console.error(`Error updating token prices (attempt ${retryCount + 1}):`, error)
      
      // Retry with exponential backoff if we haven't exceeded max retries
      if (retryCount < maxRetries) {
        retryCount++
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000)
         console.log(`Retrying price update in ${delay}ms...`)
        setTimeout(updatePrices, delay)
      } else {
        console.warn('Max retries reached for price update, will try again on next cycle')
        retryCount = 0 // Reset for next cycle
      }
    }
  }
  
  // Initial update after a short delay
  const initialTimeout = setTimeout(updatePrices, 2000)
  
  // Set up periodic updates
  const interval = setInterval(updatePrices, 60000) // Update every minute
  
  return () => {
    clearTimeout(initialTimeout)
    clearInterval(interval)
  }
} 