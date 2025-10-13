/**
 * Utilities for handling market types and determining orderbook market availability
 * Now uses dynamic Supabase lookup instead of hardcoded mappings for scalability
 */

// Common token symbols that should NOT be treated as orderbook markets
const STANDARD_TOKENS = [
  'BTC', 'ETH', 'USDC', 'USDT', 'DAI', 'LINK', 'UNI', 'AAVE', 'COMP', 'MKR',
  'SNX', 'CRV', 'SUSHI', 'MATIC', 'POL', 'LTC', 'BCH', 'XRP', 'ADA', 'DOT',
  'SOL', 'AVAX', 'NEAR', 'ATOM', 'FTM', 'ALGO', 'XLM', 'VET', 'ICP', 'FLOW',
  'SAND', 'MANA', 'ENJ', 'CHZ', 'THETA', 'FIL', 'GRT', 'LRC', 'BAT', 'ZRX',
  'YFI', 'SHIB', 'DOGE', 'APE', '1INCH', 'BNB', 'TRX', 'WETH'
];

// Cache for resolved metric IDs to avoid repeated API calls
const metricIdCache = new Map<string, string | null>();
const cacheExpiry = new Map<string, number>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Dynamically resolve a symbol to its corresponding metric ID by querying Supabase
 * @param symbol - The symbol to resolve (e.g., "aluminum_v2", "ALUMINUM_V2")
 * @returns Promise<string> - the resolved metric ID or the original symbol if no mapping exists
 */
export async function resolveSymbolToMetricId(symbol: string): Promise<string> {
  if (!symbol || typeof symbol !== 'string') {
    return symbol;
  }

  // Check if it's a standard token (these are NOT orderbook markets)
  if (STANDARD_TOKENS.includes(symbol.toUpperCase())) {
    return symbol;
  }

  // Check cache first
  const cached = metricIdCache.get(symbol);
  const cacheTime = cacheExpiry.get(symbol);
  if (cached && cacheTime && Date.now() < cacheTime) {
    return cached;
  }

  try {
    console.log(`🔍 Dynamically resolving symbol: "${symbol}"`);
    
    const response = await fetch(`/api/resolve-market?symbol=${encodeURIComponent(symbol)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'default'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.metric_id) {
        console.log(`✅ Resolved "${symbol}" to "${data.metric_id}"`);
        
        // Cache the result
        metricIdCache.set(symbol, data.metric_id);
        cacheExpiry.set(symbol, Date.now() + CACHE_DURATION);
        
        return data.metric_id;
      }
    } else if (response.status === 404) {
      console.log(`ℹ️ No market found for symbol: ${symbol}`);
      
      // Cache the negative result to avoid repeated lookups
      metricIdCache.set(symbol, null);
      cacheExpiry.set(symbol, Date.now() + CACHE_DURATION);
    } else {
      console.warn(`⚠️ Error resolving symbol "${symbol}":`, response.status, response.statusText);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to resolve symbol "${symbol}":`, error);
  }

  // Return original symbol if no mapping found
  return symbol;
}

/**
 * Synchronous version that returns cached result or original symbol
 * Use this when you need immediate result and async is not possible
 * @param symbol - The symbol to resolve
 * @returns string - cached metric ID or original symbol
 */
export function resolveSymbolToMetricIdSync(symbol: string): string {
  if (!symbol || typeof symbol !== 'string') {
    return symbol;
  }

  // Check if it's a standard token
  if (STANDARD_TOKENS.includes(symbol.toUpperCase())) {
    return symbol;
  }

  // Check cache
  const cached = metricIdCache.get(symbol);
  const cacheTime = cacheExpiry.get(symbol);
  if (cached && cacheTime && Date.now() < cacheTime) {
    return cached;
  }

  // Return original symbol if not in cache
  return symbol;
}

/**
 * Check if a metric ID likely corresponds to an orderbook market
 * @param metricId - The metric ID to check
 * @returns boolean indicating if this should be treated as an orderbook market
 */
export function isLikelyOrderbookMarket(metricId: string): boolean {
  if (!metricId || typeof metricId !== 'string') {
    return false;
  }

  // Check if it's a standard token (these are NOT orderbook markets)
  if (STANDARD_TOKENS.includes(metricId.toUpperCase())) {
    return false;
  }

  // For unknown tokens, use heuristics:
  // Orderbook markets tend to have descriptive names or version suffixes
  const hasVersionSuffix = /_V\d+$/.test(metricId);
  const hasDescriptiveFormat = metricId.includes('_') && metricId.length > 6;
  const isAllCapsWithUnderscores = /^[A-Z0-9_]+$/.test(metricId);
  const hasDashFormat = metricId.includes('-v') && metricId.includes('-'); // e.g., aluminum-v1-001
  const hasUppercaseFormat = /^[A-Z0-9_]+$/.test(metricId) && metricId.length > 3;
  
  return hasVersionSuffix || 
         (hasDescriptiveFormat && isAllCapsWithUnderscores) || 
         hasDashFormat ||
         hasUppercaseFormat;
}

/**
 * Get market type for display purposes
 * @param metricId - The metric ID to check
 * @returns string describing the market type
 */
export function getMarketType(metricId: string): 'orderbook' | 'standard' | 'unknown' {
  if (isLikelyOrderbookMarket(metricId)) {
    return 'orderbook';
  }
  
  if (STANDARD_TOKENS.includes(metricId.toUpperCase())) {
    return 'standard';
  }
  
  return 'unknown';
}

/**
 * Check if we should attempt to fetch orderbook data for this metric ID
 * @param metricId - The metric ID to check
 * @returns boolean indicating if we should fetch orderbook data
 */
export function shouldFetchOrderbookData(metricId: string): boolean {
  // Only fetch orderbook data if we think this is likely an orderbook market
  return isLikelyOrderbookMarket(metricId);
}

/**
 * Clear the metric ID cache (useful for testing or forcing refresh)
 */
export function clearMetricIdCache(): void {
  metricIdCache.clear();
  cacheExpiry.clear();
}

/**
 * Preload metric ID for a symbol (useful for optimization)
 * @param symbol - The symbol to preload
 */
export async function preloadMetricId(symbol: string): Promise<void> {
  await resolveSymbolToMetricId(symbol);
}

/**
 * Get cache statistics (useful for debugging)
 */
export function getCacheStats(): { size: number; entries: Array<{ symbol: string; metricId: string | null; expiresAt: number }> } {
  const entries: Array<{ symbol: string; metricId: string | null; expiresAt: number }> = [];
  
  for (const [symbol, metricId] of metricIdCache.entries()) {
    const expiresAt = cacheExpiry.get(symbol) || 0;
    entries.push({ symbol, metricId, expiresAt });
  }
  
  return {
    size: metricIdCache.size,
    entries
  };
}