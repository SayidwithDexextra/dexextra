/**
 * SerpApi client for web search integration
 * Used by Metric Discovery Agent to find authoritative data sources
 */

import { SearchResult } from '@/types/metricDiscovery';

interface SerpApiResult {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    displayed_link?: string;
    source?: string;
    favicon?: string;
  }>;
}

export interface SearchOptions {
  maxResults?: number;
  variation?: number;
  excludeUrls?: string[];
}

/**
 * Search for data sources related to a metric description
 * @param metricDescription User's metric description
 * @param options Search options including maxResults, variation, and excludeUrls
 * @returns Array of search results
 */
export async function searchMetricSources(
  metricDescription: string,
  options: SearchOptions | number = {}
): Promise<SearchResult[]> {
  // Support legacy call signature with just maxResults as number
  const opts: SearchOptions = typeof options === 'number' 
    ? { maxResults: options } 
    : options;
  
  const maxResults = opts.maxResults ?? 10;
  const variation = opts.variation ?? 0;
  const excludeUrls = opts.excludeUrls ?? [];
  
  const apiKey = process.env.SERPAPI_KEY;
  
  if (!apiKey) {
    throw new Error('SERPAPI_KEY environment variable not set');
  }

  // Build search query optimized for finding authoritative data sources
  const searchQuery = buildSearchQuery(metricDescription, variation, excludeUrls);

  try {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(maxResults));
    url.searchParams.set('hl', 'en');

    // Backend log: request created (never log the api_key).
    const sanitizedUrl = new URL(url.toString());
    sanitizedUrl.searchParams.delete('api_key');
    console.log('[SerpApi] Request created:', {
      url: sanitizedUrl.toString(),
      q_preview: searchQuery.slice(0, 220),
      num: maxResults,
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`SerpApi request failed: ${response.status} - ${errorText}`);
    }

    const data: SerpApiResult = await response.json();

    // Parse and normalize results
    const results: SearchResult[] = (data.organic_results || [])
      .slice(0, maxResults)
      .map((result) => {
        const url = result.link || '';
        const domain = extractDomain(url);
        
        return {
          title: result.title || '',
          url,
          snippet: result.snippet || '',
          domain,
          favicon: result.favicon || undefined,
          source: result.source || undefined,
          displayed_link: result.displayed_link || undefined,
        };
      })
      .filter((result) => result.url && result.title); // Filter out invalid results

    // Backend log: return data (summary + small sample).
    console.log('[SerpApi] Response received:', {
      result_count: results.length,
      sample: results.slice(0, 3).map((r) => ({
        title: r.title.slice(0, 120),
        url: r.url,
        domain: r.domain,
        source: r.source,
      })),
    });

    return results;
  } catch (error) {
    console.error('[SerpApi] Search failed:', error);
    throw new Error(
      error instanceof Error 
        ? `SerpApi search failed: ${error.message}` 
        : 'SerpApi search failed with unknown error'
    );
  }
}

/**
 * Search variation strategies for finding alternative sources
 * Each variation uses different modifiers to get different search results
 */
const SEARCH_VARIATIONS: Array<string[]> = [
  // Variation 0: Default - official/authoritative sources
  ['official data', 'statistics', 'API', 'source'],
  // Variation 1: Focus on live/real-time data
  ['live data', 'real-time', 'current', 'tracker'],
  // Variation 2: Focus on government/institutional sources
  ['government', 'institution', 'official report', 'database'],
  // Variation 3: Focus on APIs and developer resources
  ['API endpoint', 'developer', 'data feed', 'JSON'],
  // Variation 4: Focus on financial/market data
  ['market data', 'price feed', 'exchange', 'trading'],
  // Variation 5: Generic alternative
  ['data source', 'metrics', 'dashboard', 'monitor'],
];

/**
 * Build optimized search query from metric description
 * Adds keywords to find official data sources
 * @param metricDescription User's metric description
 * @param variation Index of search variation to use (0-5)
 * @param excludeUrls Optional list of URLs to exclude from search
 */
function buildSearchQuery(
  metricDescription: string, 
  variation: number = 0,
  excludeUrls: string[] = []
): string {
  // Extract key terms and add search modifiers for finding data sources
  const baseQuery = metricDescription.trim();
  
  // Get modifiers for this variation (cycle through if out of range)
  const variationIndex = Math.abs(variation) % SEARCH_VARIATIONS.length;
  const modifiers = SEARCH_VARIATIONS[variationIndex];

  // Use OR logic to find any of these authoritative indicators
  const modifierQuery = modifiers.map(m => `"${m}"`).join(' OR ');
  
  // Build exclusion query for denied URLs (exclude their domains)
  let exclusionQuery = '';
  if (excludeUrls.length > 0) {
    const domains = excludeUrls
      .map(url => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })
      .filter((d): d is string => d !== null);
    
    // Dedupe domains
    const uniqueDomains = [...new Set(domains)];
    if (uniqueDomains.length > 0) {
      exclusionQuery = ' ' + uniqueDomains.map(d => `-site:${d}`).join(' ');
    }
  }
  
  return `${baseQuery} (${modifierQuery})${exclusionQuery}`;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

/**
 * Cache for search results (optional, in-memory)
 * Key: hash of metric description, Value: { results, timestamp }
 */
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Search with caching to reduce API calls
 * @param metricDescription User's metric description
 * @param options Search options or legacy maxResults number
 */
export async function searchMetricSourcesCached(
  metricDescription: string,
  options: SearchOptions | number = {}
): Promise<SearchResult[]> {
  // Support legacy call signature with just maxResults as number
  const opts: SearchOptions = typeof options === 'number' 
    ? { maxResults: options } 
    : options;
  
  const maxResults = opts.maxResults ?? 10;
  const variation = opts.variation ?? 0;
  const excludeUrls = opts.excludeUrls ?? [];
  
  // Build cache key including variation and excluded URLs for uniqueness
  const cacheKeyData = JSON.stringify({
    desc: metricDescription.toLowerCase().trim(),
    var: variation,
    excl: excludeUrls.sort(),
  });
  const cacheKey = Buffer.from(cacheKeyData)
    .toString('base64')
    .slice(0, 128);

  // Check cache
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[SerpApi] Cache hit:', {
      description_preview: metricDescription.slice(0, 120),
      variation,
      excludeUrls_count: excludeUrls.length,
      result_count: cached.results.length,
    });
    return cached.results;
  }

  // Fetch fresh results
  const results = await searchMetricSources(metricDescription, opts);

  // Update cache
  searchCache.set(cacheKey, {
    results,
    timestamp: Date.now(),
  });

  // Clean old cache entries (simple cleanup)
  if (searchCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of searchCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        searchCache.delete(key);
      }
    }
  }

  return results;
}
