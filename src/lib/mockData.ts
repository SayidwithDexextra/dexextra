// Mock data for development - provides sample VAMM markets and token data
// This allows UI development without requiring smart contract connections

export interface VAMMMarket {
  id: string;
  symbol: string;
  description: string;
  category: string[];
  oracle_address: string;
  initial_price: number;
  price_decimals: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  deployment_fee: number;
  is_active: boolean;
  vamm_address?: string;
  vault_address?: string;
  market_id?: string;
  deployment_status: string;
  created_at: string;
  user_address?: string;
  settlement_period_days?: number;
}

export interface TokenData {
  name: string;
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  marketCapChange24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  chain: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
}

// Mock VAMM Markets Data
export const MOCK_VAMM_MARKETS: VAMMMarket[] = [
  {
    id: 'btc-market-001',
    symbol: 'BTC',
    description: 'Bitcoin price prediction market - the original cryptocurrency',
    category: ['Cryptocurrency', 'Major Assets'],
    oracle_address: '0x1234567890123456789012345678901234567890',
    initial_price: 43250.50,
    price_decimals: 2,
    banner_image_url: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    deployment_fee: 100,
    is_active: true,
    vamm_address: '0xBTC1234567890123456789012345678901234567890',
    vault_address: '0xVBTC123456789012345678901234567890123456789',
    market_id: 'btc-001',
    deployment_status: 'deployed',
    created_at: '2024-01-15T10:30:00Z',
    user_address: '0xCreator123456789012345678901234567890123456',
    settlement_period_days: 30
  },
  {
    id: 'eth-market-002',
    symbol: 'ETH',
    description: 'Ethereum price prediction market - smart contracts platform',
    category: ['Cryptocurrency', 'Major Assets', 'DeFi'],
    oracle_address: '0x2345678901234567890123456789012345678901',
    initial_price: 2650.75,
    price_decimals: 2,
    banner_image_url: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    deployment_fee: 100,
    is_active: true,
    vamm_address: '0xETH2345678901234567890123456789012345678901',
    vault_address: '0xVETH234567890123456789012345678901234567890',
    market_id: 'eth-002',
    deployment_status: 'deployed',
    created_at: '2024-01-16T14:20:00Z',
    user_address: '0xCreator123456789012345678901234567890123456',
    settlement_period_days: 30
  },
  {
    id: 'matic-market-003',
    symbol: 'MATIC',
    description: 'Polygon (MATIC) price prediction market - Ethereum scaling solution',
    category: ['Cryptocurrency', 'Layer 2', 'Scaling'],
    oracle_address: '0x3456789012345678901234567890123456789012',
    initial_price: 0.8945,
    price_decimals: 4,
    banner_image_url: 'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png',
    deployment_fee: 50,
    is_active: true,
    vamm_address: '0xMATIC456789012345678901234567890123456789',
    vault_address: '0xVMATIC45678901234567890123456789012345678',
    market_id: 'matic-003',
    deployment_status: 'deployed',
    created_at: '2024-01-17T09:15:00Z',
    user_address: '0xCreator234567890123456789012345678901234567',
    settlement_period_days: 14
  },
  {
    id: 'sol-market-004',
    symbol: 'SOL',
    description: 'Solana price prediction market - high-performance blockchain',
    category: ['Cryptocurrency', 'Layer 1', 'High Performance'],
    oracle_address: '0x4567890123456789012345678901234567890123',
    initial_price: 98.32,
    price_decimals: 2,
    banner_image_url: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
    deployment_fee: 75,
    is_active: true,
    vamm_address: '0xSOL4567890123456789012345678901234567890123',
    vault_address: '0xVSOL567890123456789012345678901234567890123',
    market_id: 'sol-004',
    deployment_status: 'deployed',
    created_at: '2024-01-18T16:45:00Z',
    user_address: '0xCreator345678901234567890123456789012345678',
    settlement_period_days: 21
  },
  {
    id: 'avax-market-005',
    symbol: 'AVAX',
    description: 'Avalanche price prediction market - subnet blockchain platform',
    category: ['Cryptocurrency', 'Layer 1', 'DeFi'],
    oracle_address: '0x5678901234567890123456789012345678901234',
    initial_price: 36.78,
    price_decimals: 2,
    banner_image_url: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
    deployment_fee: 60,
    is_active: true,
    vamm_address: '0xAVAX678901234567890123456789012345678901234',
    vault_address: '0xVAVAX78901234567890123456789012345678901234',
    market_id: 'avax-005',
    deployment_status: 'deployed',
    created_at: '2024-01-19T11:30:00Z',
    user_address: '0xCreator456789012345678901234567890123456789',
    settlement_period_days: 28
  },
  {
    id: 'link-market-006',
    symbol: 'LINK',
    description: 'Chainlink price prediction market - decentralized oracle network',
    category: ['Cryptocurrency', 'Oracle', 'Infrastructure'],
    oracle_address: '0x6789012345678901234567890123456789012345',
    initial_price: 14.67,
    price_decimals: 2,
    banner_image_url: 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
    icon_image_url: 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
    deployment_fee: 40,
    is_active: true,
    vamm_address: '0xLINK789012345678901234567890123456789012345',
    vault_address: '0xVLINK89012345678901234567890123456789012345',
    market_id: 'link-006',
    deployment_status: 'deployed',
    created_at: '2024-01-20T13:25:00Z',
    user_address: '0xCreator567890123456789012345678901234567890',
    settlement_period_days: 35
  }
];

// Mock Token Data for individual token pages
export const MOCK_TOKEN_DATA: Record<string, TokenData> = {
  'BTC': {
    name: 'Bitcoin',
    symbol: 'BTC',
    price: 43250.50,
    priceChange24h: 1247.32,
    volume24h: 28500000000,
    marketCap: 847000000000,
    marketCapChange24h: 2.97,
    circulating_supply: 19600000,
    total_supply: 19600000,
    max_supply: 21000000,
    chain: 'Bitcoin',
    description: 'Bitcoin is a decentralized digital currency, without a central bank or single administrator, that can be sent from user to user on the peer-to-peer bitcoin network without the need for intermediaries.',
    website: 'https://bitcoin.org',
    twitter: 'https://twitter.com/bitcoin'
  },
  'ETH': {
    name: 'Ethereum',
    symbol: 'ETH',
    price: 2650.75,
    priceChange24h: 89.45,
    volume24h: 15200000000,
    marketCap: 318000000000,
    marketCapChange24h: 3.49,
    circulating_supply: 120000000,
    total_supply: 120000000,
    max_supply: 0, // No max supply
    chain: 'Ethereum',
    description: 'Ethereum is a decentralized, open-source blockchain with smart contract functionality. Ether is the native cryptocurrency of the platform.',
    website: 'https://ethereum.org',
    twitter: 'https://twitter.com/ethereum'
  },
  'MATIC': {
    name: 'Polygon',
    symbol: 'MATIC',
    price: 0.8945,
    priceChange24h: 0.0234,
    volume24h: 450000000,
    marketCap: 8900000000,
    marketCapChange24h: 2.69,
    circulating_supply: 9950000000,
    total_supply: 10000000000,
    max_supply: 10000000000,
    chain: 'Polygon',
    description: 'Polygon is a decentralized platform that provides tools to create and connect Ethereum-compatible blockchain networks.',
    website: 'https://polygon.technology',
    twitter: 'https://twitter.com/0xPolygon'
  },
  'SOL': {
    name: 'Solana',
    symbol: 'SOL',
    price: 98.32,
    priceChange24h: 4.67,
    volume24h: 2100000000,
    marketCap: 42000000000,
    marketCapChange24h: 4.98,
    circulating_supply: 427000000,
    total_supply: 580000000,
    max_supply: 0, // Inflationary
    chain: 'Solana',
    description: 'Solana is a high-performance blockchain supporting builders around the world creating crypto apps that scale today.',
    website: 'https://solana.com',
    twitter: 'https://twitter.com/solana'
  },
  'AVAX': {
    name: 'Avalanche',
    symbol: 'AVAX',
    price: 36.78,
    priceChange24h: 1.89,
    volume24h: 680000000,
    marketCap: 14200000000,
    marketCapChange24h: 5.42,
    circulating_supply: 386000000,
    total_supply: 386000000,
    max_supply: 720000000,
    chain: 'Avalanche',
    description: 'Avalanche is an open, programmable smart contracts platform for decentralized applications.',
    website: 'https://avax.network',
    twitter: 'https://twitter.com/avalancheavax'
  },
  'LINK': {
    name: 'Chainlink',
    symbol: 'LINK',
    price: 14.67,
    priceChange24h: 0.78,
    volume24h: 890000000,
    marketCap: 8100000000,
    marketCapChange24h: 5.62,
    circulating_supply: 552000000,
    total_supply: 1000000000,
    max_supply: 1000000000,
    chain: 'Ethereum',
    description: 'Chainlink is a decentralized oracle network that enables smart contracts to securely access off-chain data feeds.',
    website: 'https://chain.link',
    twitter: 'https://twitter.com/chainlink'
  }
};

// Helper function to get mock market by symbol
export function getMockMarketBySymbol(symbol: string): VAMMMarket | null {
  return MOCK_VAMM_MARKETS.find(market => market.symbol.toLowerCase() === symbol.toLowerCase()) || null;
}

// Helper function to get mock token data by symbol
export function getMockTokenDataBySymbol(symbol: string): TokenData | null {
  return MOCK_TOKEN_DATA[symbol.toUpperCase()] || null;
}

// Helper function to get all mock markets
export function getAllMockMarkets(): VAMMMarket[] {
  return MOCK_VAMM_MARKETS;
}
