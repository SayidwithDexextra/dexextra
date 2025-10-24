/**
 * Contract configuration for Dexeterav5
 * Contains addresses and market information
 * Uses the new markets table for dynamic loading of market data
 */

import { env } from './env'
import marketService from './marketService'
import { createClient } from '@supabase/supabase-js'

// Contract addresses are sourced exclusively from environment variables
// This ensures consistent deployment across environments and prevents hardcoded values

// Core contract addresses - these are shared across markets
// All addresses are sourced from environment variables with fallbacks for development
export const CONTRACT_ADDRESSES = {
  // Core contract addresses with fallbacks for development
  MOCK_USDC: env.MOCK_USDC_ADDRESS || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  CORE_VAULT: env.CORE_VAULT_ADDRESS || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  LIQUIDATION_MANAGER: env.LIQUIDATION_MANAGER_ADDRESS || "0x93bF290F0a2039E502b87c8767c71e77A50C79C2",
  FUTURES_MARKET_FACTORY: env.FUTURES_MARKET_FACTORY_ADDRESS || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",

  // CamelCase aliases used by hooks like useContract
  mockUSDC: env.MOCK_USDC_ADDRESS || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  coreVault: env.CORE_VAULT_ADDRESS || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  liquidationManager: env.LIQUIDATION_MANAGER_ADDRESS || "0x93bF290F0a2039E502b87c8767c71e77A50C79C2",
  futuresMarketFactory: env.FUTURES_MARKET_FACTORY_ADDRESS || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",

  // No hardcoded orderBook addresses - all OrderBook contracts are loaded dynamically from Supabase

  // Market information will be populated at runtime from the database
  MARKET_INFO: {}
};

console.log('[CONTRACT_ADDRESSES]', CONTRACT_ADDRESSES);

// Network/chain configuration sourced exclusively from environment variables
export const CHAIN_CONFIG = {
  rpcUrl: env.RPC_URL,
  wsRpcUrl: env.WS_RPC_URL,
  chainId: env.CHAIN_ID, // Already validated in env.ts
} as const

// Function to populate market information from database
export async function populateMarketInfo() {
  try {
    const markets = await marketService.getAllMarkets();
    
    for (const market of markets) {
      // Skip markets that aren't fully deployed
      if (!market.market_address || !market.market_id_bytes32) continue;
      
      // Use the symbol prefix (e.g. "BTC" from "BTC-USD") as the key
      const key = (market.symbol.split('-')[0] || market.symbol).toUpperCase();
      
      (CONTRACT_ADDRESSES as any).MARKET_INFO[key] = {
        id: market.id,
        name: market.name,
        symbol: market.symbol,
        marketId: market.market_id_bytes32,
        marketIdentifier: market.market_identifier,
        orderBook: market.market_address,
        chainId: market.chain_id,
        network: market.network,
        active: market.is_active && market.market_status === 'ACTIVE',
        status: market.market_status
      };
      
      // No default orderBook - each market uses its own OrderBook contract
    }
    
    console.log('Market info populated from database:', Object.keys(CONTRACT_ADDRESSES.MARKET_INFO).length, 'markets');
  } catch (error) {
    console.error('Error populating market info:', error);
    
    // No fallbacks - all markets must be loaded from Supabase
    if (!Object.keys(CONTRACT_ADDRESSES.MARKET_INFO).length) {
      console.warn('No markets loaded from database - market-specific features will be unavailable');
    }
  }
}

// Client-side helper to populate MARKET_INFO for current runtime (limited fields)
export async function populateMarketInfoClient(symbolFilter?: string) {
  try {
    const supabase = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    let query = supabase
      .from('markets')
      .select(
        `id, market_identifier, symbol, name, market_id_bytes32, market_address, chain_id, network, is_active, market_status`
      )
      .order('created_at', { ascending: false })

    if (symbolFilter) {
      const sf = String(symbolFilter);
      // Case-insensitive pattern matches across symbol, market_identifier, and name (prefix or contains)
      // Use % for wildcards so partial inputs like "ALU" match "ALU-USD"
      query = query.or(
        `symbol.ilike.%${sf}%,market_identifier.ilike.%${sf}%,name.ilike.%${sf}%`
      )
    }

    const { data, error } = await query

    if (error) {
      console.warn('populateMarketInfoClient: query error', error)
      return 0
    }

    const rows = data || []
    for (const market of rows) {
      if (!market.market_address || !market.market_id_bytes32) continue
      const key = (market.symbol.split('-')[0] || market.symbol).toUpperCase()
      ;(CONTRACT_ADDRESSES as any).MARKET_INFO[key] = {
        id: market.id,
        name: market.name,
        symbol: market.symbol,
        marketId: market.market_id_bytes32,
        marketIdentifier: market.market_identifier,
        orderBook: market.market_address,
        chainId: market.chain_id,
        network: market.network,
        active: market.is_active && market.market_status === 'ACTIVE',
        status: market.market_status,
      }
    }

    return rows.length
  } catch (e) {
    console.warn('populateMarketInfoClient failed', e)
    return 0
  }
}

// Helper function to get contract addresses for a specific market
export async function getMarketAddresses(marketIdentifier: string) {
  return marketService.getContractAddresses(marketIdentifier);
}

// Initialize contract addresses on server only
const isClient = typeof window !== 'undefined'
if (!isClient) {
  // Best-effort pre-population on server
  populateMarketInfo().catch(() => {})
}

export default CONTRACT_ADDRESSES;