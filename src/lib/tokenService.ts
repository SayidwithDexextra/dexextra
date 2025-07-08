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

// Fetch token balances using Alchemy Token API
async function fetchTokenBalancesFromAlchemy(
  walletAddress: string,
  tokenAddresses?: string[]
): Promise<AlchemyTokenBalanceResponse> {
  try {
    console.log("ALCHEMY_API_KEY", env.ALCHEMY_API_KEY)
    if (!env.ALCHEMY_API_KEY) {
      throw new Error('Alchemy API key not configured')
    }
    
    const url = `${ALCHEMY_API_BASE}/${env.ALCHEMY_API_KEY}`
    
    const requestBody = {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getTokenBalances',
      params: [
        walletAddress,
        tokenAddresses || 'DEFAULT_TOKENS'
      ]
    }

    const response = await axiosWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: requestBody,
    }, 15000)

    if (response.status !== 200) {
      throw new Error(`Alchemy API error: ${response.status}`)
    }

    if (response.data.error) {
      throw new Error(`Alchemy API error: ${response.data.error.message}`)
    }

    return response.data.result
  } catch (error) {
    console.error('Error fetching token balances from Alchemy:', error)
    throw error
  }
}

// Fetch token metadata using Alchemy API
async function fetchTokenMetadataFromAlchemy(
  contractAddresses: string[]
): Promise<AlchemyTokenMetadataResponse> {
  try {
    if (!env.ALCHEMY_API_KEY) {
      throw new Error('Alchemy API key not configured')
    }
    
    const url = `${ALCHEMY_API_BASE}/${env.ALCHEMY_API_KEY}`
    
    const metadata: AlchemyTokenMetadataResponse = {}
    
    // Fetch metadata for each token (Alchemy API allows batch requests)
    const promises = contractAddresses.map(async (address) => {
      try {
        const response = await axiosWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          data: {
            id: 1,
            jsonrpc: '2.0',
            method: 'alchemy_getTokenMetadata',
            params: [address]
          },
        }, 10000)

        if (response.status === 200) {
          const data = response.data
          if (data.result && !data.error) {
            metadata[address] = data.result
          }
        }
      } catch (error) {
        console.error(`Error fetching metadata for token ${address}:`, error)
      }
    })

    await Promise.all(promises)
    return metadata
  } catch (error) {
    console.error('Error fetching token metadata from Alchemy:', error)
    return {}
  }
}

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

// Get ETH balance
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

// Rate limiting for CoinGecko API
let lastPriceAPICall = 0
const PRICE_API_COOLDOWN = 10000 // 10 seconds between calls

// Fetch token prices from our API route to avoid CORS issues
export async function fetchTokenPrices(tokenSymbols: string[]): Promise<Record<string, TokenPriceData>> {
  try {
    // Rate limiting protection
    const now = Date.now()
    if (now - lastPriceAPICall < PRICE_API_COOLDOWN) {
      console.log('Rate limiting: using cached price data')
      return {}
    }
    lastPriceAPICall = now

    if (tokenSymbols.length === 0) {
      console.log('No token symbols provided for price fetching')
      return {}
    }
    
    // Limit to 50 tokens per request
    const limitedTokens = tokenSymbols.slice(0, 50)
    const tokensParam = limitedTokens.join(',')
    
    console.log('Fetching prices for tokens:', limitedTokens)
    
    const response = await fetch(`/api/token-prices?tokens=${encodeURIComponent(tokensParam)}`, {
      headers: {
        'Accept': 'application/json',
      },
    })
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('API rate limit hit, returning empty prices')
        return {}
      }
      throw new Error(`API error: ${response.status}`)
    }
    
    const priceData = await response.json()
    
    if (priceData.error) {
      throw new Error(priceData.error)
    }
    
    console.log('Successfully fetched prices for:', Object.keys(priceData))
    return priceData
  } catch (error) {
    console.error('Error fetching token prices:', error)
    return {}
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
    // Validate wallet address format
    if (!isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format')
    }

    // Get ETH balance
    const ethBalance = await getEthBalance(provider, walletAddress)
    
    const tokens: TokenBalance[] = []
    let totalValue = 0
    
    try {
      // Try to fetch all token balances using Alchemy API
      const alchemyResponse = await fetchTokenBalancesFromAlchemy(walletAddress)

      console.log("🔄 Alchemy response:", alchemyResponse)
      
      // Filter out tokens with zero balances
      const nonZeroTokens = alchemyResponse.tokenBalances
        .filter(token => token.tokenBalance && token.tokenBalance !== '0x0' && !token.error)
      
      if (nonZeroTokens.length > 0) {
        console.log("🔄 Non-zero tokens:", nonZeroTokens)
        // Get token metadata
        const tokenAddresses = nonZeroTokens.map(token => token.contractAddress)
        const tokenMetadata = await fetchTokenMetadataFromAlchemy(tokenAddresses)
        console.log("🔄 Token metadata:", tokenMetadata)  
        
        // Get symbols for price fetching
        const tokenSymbols = Object.values(tokenMetadata).map(meta => meta.symbol)
        tokenSymbols.push('ETH') // Add ETH for price fetching
        
        // Fetch prices
        const priceData = await fetchTokenPrices(tokenSymbols)
        
        // Add ETH first (always include regardless of value)
        const ethPrice = priceData['ETH']?.price || 0
        const ethValue = parseFloat(ethBalance) * ethPrice
        totalValue += ethValue
        
        tokens.push({
          symbol: 'ETH',
          name: 'Ethereum',
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: ethPrice,
          value: ethValue,
          changePercent24h: priceData['ETH']?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(ethValue),
          icon: TOKEN_ICONS['ETH'] || '💎',
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
        // If no tokens found via Alchemy, add just ETH (always include regardless of value)
        const priceData = await fetchTokenPrices(['ETH'])
        const ethPrice = priceData['ETH']?.price || 0
        const ethValue = parseFloat(ethBalance) * ethPrice
        totalValue += ethValue
        
        tokens.push({
          symbol: 'ETH',
          name: 'Ethereum',
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: ethPrice,
          value: ethValue,
          changePercent24h: priceData['ETH']?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(ethValue),
          icon: TOKEN_ICONS['ETH'] || '💎',
        })
      }
          } catch (alchemyError) {
        console.error('Alchemy API failed, no fallback available for all tokens:', alchemyError)
        
                // When Alchemy fails, just add ETH as we can't get all user tokens without it
        const priceData = await fetchTokenPrices(['ETH'])
        const ethPrice = priceData['ETH']?.price || 0
        const ethValue = parseFloat(ethBalance) * ethPrice
        totalValue += ethValue
        
        tokens.push({
          symbol: 'ETH',
          name: 'Ethereum',
          balance: ethBalance,
          decimals: 18,
          address: '0x0',
          price: ethPrice,
          value: ethValue,
          changePercent24h: priceData['ETH']?.price_change_percentage_24h || 0,
          balanceFormatted: formatTokenBalance(ethBalance, 18),
          valueFormatted: formatTokenValue(ethValue),
          icon: TOKEN_ICONS['ETH'] || '💎',
        })
    }
    
    // Sort tokens by value (descending)
    tokens.sort((a, b) => (b.value || 0) - (a.value || 0))
    
    const ethPrice = tokens.find(t => t.symbol === 'ETH')?.price || 0
    const ethValue = parseFloat(ethBalance) * ethPrice
    
    return {
      totalValue: totalValue.toString(),
      totalValueFormatted: formatTokenValue(totalValue),
      ethBalance,
      ethBalanceFormatted: formatTokenBalance(ethBalance, 18),
      ethValue: ethValue.toString(),
      ethValueFormatted: formatTokenValue(ethValue),
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

// Create an axios request with timeout
async function axiosWithTimeout(url: string, options: AxiosRequestConfig = {}, timeoutMs: number = 10000) {
  console.log("🔄 Making request to:", url)
  console.log("📝 Request options:", JSON.stringify(options, null, 2))
  
  const config: AxiosRequestConfig = {
    ...options,
    url,
    timeout: timeoutMs,
  }

  try {
    console.log("🔄 Making request to:", url)
    console.log("📝 Request options:", JSON.stringify(config, null, 2))
    const response = await axios(config)
    console.log("✅ Request successful:", response.status, response.statusText)
    return response
  } catch (error) {
    console.error("❌ Request failed:", error)
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        console.error("⏱️  Request timed out")
        throw new Error('Request timeout')
      }
      if (error.response) {
        console.error("📋 Response data:", error.response.data)
        console.error("📊 Response status:", error.response.status)
        console.error("📋 Response headers:", error.response.headers)
      } else if (error.request) {
        console.error("📡 No response received:", error.request)
      }
    }
    throw error
  }
}

// Refresh token prices periodically
export function createTokenPriceUpdater(
  onPriceUpdate: (prices: Record<string, TokenPriceData>) => void
): () => void {
  const interval = setInterval(async () => {
    try {
      const prices = await fetchTokenPrices(['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'LINK', 'UNI'])
      onPriceUpdate(prices)
    } catch (error) {
      console.error('Error updating token prices:', error)
    }
  }, 60000) // Update every minute
  
  return () => clearInterval(interval)
} 