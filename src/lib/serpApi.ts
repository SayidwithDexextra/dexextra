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
  }>;
}

/**
 * Search for data sources related to a metric description
 * @param metricDescription User's metric description
 * @param maxResults Maximum number of results to return (default: 10)
 * @returns Array of search results
 */
export async function searchMetricSources(
  metricDescription: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  
  if (!apiKey) {
    throw new Error('SERPAPI_KEY environment variable not set');
  }

  // Build search query optimized for finding authoritative data sources
  const searchQuery = buildSearchQuery(metricDescription);

  try {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(maxResults));
    url.searchParams.set('hl', 'en');

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
        };
      })
      .filter((result) => result.url && result.title); // Filter out invalid results

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
 * Build optimized search query from metric description
 * Adds keywords to find official data sources
 */
function buildSearchQuery(metricDescription: string): string {
  // Extract key terms and add search modifiers for finding data sources
  const baseQuery = metricDescription.trim();
  
  // Add terms to prioritize official/authoritative sources
  const modifiers = [
    'official data',
    'statistics',
    'API',
    'source',
  ];

  // Use OR logic to find any of these authoritative indicators
  const modifierQuery = modifiers.map(m => `"${m}"`).join(' OR ');
  
  return `${baseQuery} (${modifierQuery})`;
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
 */
export async function searchMetricSourcesCached(
  metricDescription: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  // Simple hash of description for cache key
  const cacheKey = Buffer.from(metricDescription.toLowerCase().trim())
    .toString('base64')
    .slice(0, 64);

  // Check cache
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[SerpApi] Cache hit for:', metricDescription.slice(0, 50));
    return cached.results;
  }

  // Fetch fresh results
  const results = await searchMetricSources(metricDescription, maxResults);

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
