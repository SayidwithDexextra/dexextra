import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
// Removed contractDeployment import - smart contract functionality deleted

const ALCHEMY_API_BASE = 'https://polygon-mainnet.g.alchemy.com/v2'

// Custom token addresses to include in balance checks
const getCustomTokenAddresses = () => {
  const baseTokens = [
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT on Polygon  
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI on Polygon
  ]
  
  // Only include mock USDC in development mode
  if (process.env.NODE_ENV === 'development') {
    baseTokens.push('0xff541e2AEc7716725f8EDD02945A1Fe15664588b') // Mock USDC contract address (from orderbook deployment)
    console.log('🧪 Development mode: Including Mock USDC in token balance checks')
  } else {
    console.log('🚀 Production mode: Excluding Mock USDC from token balance checks')
  }
  
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

// Fetch token balances using Alchemy Token API (server-side only)
async function fetchTokenBalancesFromAlchemy(
  walletAddress: string,
  tokenAddresses?: string[]
): Promise<AlchemyTokenBalanceResponse> {
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`Alchemy API error: ${response.status}`)
  }

  const data = await response.json()

  if (data.error) {
    throw new Error(`Alchemy API error: ${data.error.message}`)
  }

  return data.result
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
  
  // Fetch metadata for each token (Alchemy API allows batch requests)
  const promises = contractAddresses.map(async (address) => {
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
      })

      if (response.ok) {
        const data = await response.json()
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

    // Fetch balances for both default tokens and our custom tokens
    const customTokenAddresses = getCustomTokenAddresses()
    
    console.log('🔍 Portfolio API Debug:', {
      walletAddress,
      customTokenAddresses,
      alchemyApiKey: env.ALCHEMY_API_KEY ? '✅ Set' : '❌ Missing'
    });

    const [defaultTokenBalances, customTokenBalances] = await Promise.all([
      fetchTokenBalancesFromAlchemy(walletAddress), // Default tokens
      fetchTokenBalancesFromAlchemy(walletAddress, customTokenAddresses) // Custom tokens
    ])
    
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
    const mockUSDCAddress = '0xff541e2AEc7716725f8EDD02945A1Fe15664588b'.toLowerCase()
    const mockUSDCBalance = tokenBalances.tokenBalances.find(token => 
      token.contractAddress.toLowerCase() === mockUSDCAddress
    )
    
    // console.log('🔍 Mock USDC Debug:', {
    //   mockUSDCAddress,
    //   mockUSDCBalance: mockUSDCBalance?.tokenBalance,
    //   mockUSDCError: mockUSDCBalance?.error,
    //   totalTokensFound: tokenBalances.tokenBalances.length
    // })
    
    // Filter tokens with non-zero balances to get metadata for
    const nonZeroTokens = tokenBalances.tokenBalances
      .filter(token => token.tokenBalance && token.tokenBalance !== '0x0' && !token.error)
    
    let tokenMetadata: AlchemyTokenMetadataResponse = {}
    
    if (nonZeroTokens.length > 0) {
      const tokenAddresses = nonZeroTokens.map(token => token.contractAddress)
      tokenMetadata = await fetchTokenMetadataFromAlchemy(tokenAddresses)
    }
    
    // Add fallback metadata for mock USDC if it's missing (development only)
    if (process.env.NODE_ENV === 'development') {
      const mockUSDCOriginalAddress = '0xff541e2AEc7716725f8EDD02945A1Fe15664588b'
      if (!tokenMetadata[mockUSDCOriginalAddress] && tokenBalances.tokenBalances.some(token => 
        token.contractAddress.toLowerCase() === mockUSDCAddress
      )) {
        console.log('📝 Adding fallback metadata for Mock USDC (development mode)')
        tokenMetadata[mockUSDCOriginalAddress] = {
          name: 'Mock USDC',
          symbol: 'MOCK_USDC',
          decimals: 6,
          logo: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/logos//LOGO-Dexetera-05@2x.png'
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        tokenBalances: tokenBalances.tokenBalances,
        tokenMetadata
      }
    })

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