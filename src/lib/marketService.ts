/**
 * Market Service
 * Provides functions to interact with the markets table
 */

import { supabaseAdmin } from './supabase-admin';
import { env } from './env';

// Database client
const supabase = supabaseAdmin;

// Types for market data
export interface Market {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description: string;
  category: string;
  
  // Contract addresses
  market_id_bytes32: string;
  market_address: string;
  factory_address: string;
  central_vault_address: string;
  order_router_address: string;
  position_manager_address: string;
  liquidation_manager_address: string;
  vault_analytics_address: string;
  usdc_token_address: string;
  
  // Blockchain data
  chain_id: number;
  network: string;
  deployment_status: string;
  
  // Market status
  market_status: string;
  is_active: boolean;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  deployed_at: string | null;
}

// Cache for market data to reduce database queries
const marketCache = new Map<string, Market>();
const marketByAddressCache = new Map<string, Market>();
const marketByIdentifierCache = new Map<string, Market>();

/**
 * Get all active markets
 */
export async function getAllMarkets(includeInactive = false): Promise<Market[]> {
  const query = supabase
    .from('markets')
    .select('*');
  
  if (!includeInactive) {
    query.eq('is_active', true);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching markets:', error);
    return [];
  }
  
  // Update cache
  data?.forEach(market => {
    if (market.id) marketCache.set(market.id, market);
    if (market.market_address) marketByAddressCache.set(market.market_address.toLowerCase(), market);
    if (market.market_identifier) marketByIdentifierCache.set(market.market_identifier, market);
  });
  
  return data || [];
}

/**
 * Get market by ID
 */
export async function getMarketById(id: string): Promise<Market | null> {
  // Check cache first
  if (marketCache.has(id)) {
    return marketCache.get(id) || null;
  }
  
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error || !data) {
    console.error(`Error fetching market with ID ${id}:`, error);
    return null;
  }
  
  // Update cache
  marketCache.set(data.id, data);
  if (data.market_address) marketByAddressCache.set(data.market_address.toLowerCase(), data);
  if (data.market_identifier) marketByIdentifierCache.set(data.market_identifier, data);
  
  return data;
}

/**
 * Get market by contract address
 */
export async function getMarketByAddress(address: string): Promise<Market | null> {
  // Normalize address
  const normalizedAddress = address.toLowerCase();
  
  // Check cache first
  if (marketByAddressCache.has(normalizedAddress)) {
    return marketByAddressCache.get(normalizedAddress) || null;
  }
  
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('market_address', address)
    .single();
  
  if (error || !data) {
    console.error(`Error fetching market with address ${address}:`, error);
    return null;
  }
  
  // Update caches
  marketCache.set(data.id, data);
  marketByAddressCache.set(normalizedAddress, data);
  if (data.market_identifier) marketByIdentifierCache.set(data.market_identifier, data);
  
  return data;
}

/**
 * Get market by identifier (former metric_id)
 */
export async function getMarketByIdentifier(identifier: string): Promise<Market | null> {
  // Check cache first
  if (marketByIdentifierCache.has(identifier)) {
    return marketByIdentifierCache.get(identifier) || null;
  }
  
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('market_identifier', identifier)
    .single();
  
  if (error || !data) {
    console.error(`Error fetching market with identifier ${identifier}:`, error);
    return null;
  }
  
  // Update caches
  marketCache.set(data.id, data);
  if (data.market_address) marketByAddressCache.set(data.market_address.toLowerCase(), data);
  marketByIdentifierCache.set(identifier, data);
  
  return data;
}

/**
 * Clear the market cache
 */
export function clearMarketCache(): void {
  marketCache.clear();
  marketByAddressCache.clear();
  marketByIdentifierCache.clear();
}

/**
 * Search markets by text
 */
export async function searchMarkets(searchTerm: string, category?: string, status?: string, limit = 50): Promise<Market[]> {
  // Use the stored procedure if available, otherwise fall back to direct query
  try {
    const { data, error } = await supabase.rpc(
      'search_markets',
      { search_term: searchTerm, p_category: category, p_status: status, p_limit: limit }
    );
    
    if (error) {
      throw error;
    }
    
    return data || [];
  } catch (e) {
    // Fall back to direct query if RPC fails
    console.warn('Search markets RPC failed, falling back to direct query', e);
    
    const query = supabase
      .from('markets')
      .select('*')
      .eq('is_active', true)
      .limit(limit);
    
    if (category) {
      query.eq('category', category);
    }
    
    if (status) {
      query.eq('market_status', status);
    }
    
    if (searchTerm) {
      query.or(`market_identifier.ilike.%${searchTerm}%,symbol.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error searching markets:', error);
      return [];
    }
    
    return data || [];
  }
}

/**
 * Get contract addresses for a market by identifier
 */
export async function getContractAddresses(identifier: string): Promise<Record<string, string> | null> {
  const market = await getMarketByIdentifier(identifier);
  
  if (!market) {
    return null;
  }
  
  return {
    MARKET_ADDRESS: market.market_address,
    FACTORY_ADDRESS: market.factory_address,
    CENTRAL_VAULT_ADDRESS: market.central_vault_address,
    ORDER_ROUTER_ADDRESS: market.order_router_address,
    POSITION_MANAGER_ADDRESS: market.position_manager_address || "",
    LIQUIDATION_MANAGER_ADDRESS: market.liquidation_manager_address || "",
    VAULT_ANALYTICS_ADDRESS: market.vault_analytics_address || "",
    USDC_TOKEN_ADDRESS: market.usdc_token_address || "",
    
    // CamelCase aliases for hooks
    marketAddress: market.market_address,
    factoryAddress: market.factory_address,
    centralVaultAddress: market.central_vault_address,
    orderRouterAddress: market.order_router_address,
    positionManagerAddress: market.position_manager_address || "",
    liquidationManagerAddress: market.liquidation_manager_address || "",
    vaultAnalyticsAddress: market.vault_analytics_address || "",
    usdcTokenAddress: market.usdc_token_address || "",
  };
}

/**
 * Get the most active market
 * For use as the default market when none is specified
 */
export async function getMostActiveMarket(): Promise<Market | null> {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('is_active', true)
    .eq('market_status', 'ACTIVE')
    .order('total_volume', { ascending: false })
    .limit(1)
    .single();
  
  if (error || !data) {
    // Fallback to any active market
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('markets')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();
      
    if (fallbackError || !fallbackData) {
      console.error('No active markets found');
      return null;
    }
    
    return fallbackData;
  }
  
  return data;
}

export default {
  getAllMarkets,
  getMarketById,
  getMarketByAddress,
  getMarketByIdentifier,
  getContractAddresses,
  getMostActiveMarket,
  clearMarketCache,
  searchMarkets,
};