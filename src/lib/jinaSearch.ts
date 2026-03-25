/**
 * Jina Search API client for web search integration.
 *
 * Replaces SerpApi — uses Jina's s.jina.ai endpoint to perform SERP-style
 * web searches and return structured results optimised for the Metric
 * Discovery Agent and market creation flow.
 *
 * Env vars:
 *   JINA_API_KEY — Bearer token (required)
 */

import { SearchResult } from '@/types/metricDiscovery';

export interface SearchOptions {
  maxResults?: number;
  variation?: number;
  excludeUrls?: string[];
}

interface JinaSearchResponse {
  code?: number;
  data?: Array<{
    title?: string;
    url?: string;
    description?: string;
    content?: string;
    favicon?: string;
  }>;
}

/**
 * Search for data sources related to a metric description using Jina Search.
 */
export async function searchMetricSources(
  metricDescription: string,
  options: SearchOptions | number = {},
): Promise<SearchResult[]> {
  const opts: SearchOptions =
    typeof options === 'number' ? { maxResults: options } : options;

  const maxResults = opts.maxResults ?? 10;
  const variation = opts.variation ?? 0;
  const excludeUrls = opts.excludeUrls ?? [];

  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error('JINA_API_KEY environment variable not set');
  }

  const primaryQuery = buildSearchQuery(metricDescription, variation, excludeUrls);

  const fetchJina = async (q: string): Promise<JinaSearchResponse> => {
    console.log('[JinaSearch] Request:', {
      q_preview: q.slice(0, 220),
      num: maxResults,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch('https://s.jina.ai/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Respond-With': 'no-content',
          'X-With-Favicons': 'true',
        },
        body: JSON.stringify({ q, num: maxResults, hl: 'en' }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(
          `Jina Search request failed: ${res.status} — ${errorText}`,
        );
      }

      return (await res.json()) as JinaSearchResponse;
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new Error('Jina Search timed out after 30 s');
      }
      throw err;
    }
  };

  const parse = (data: JinaSearchResponse): SearchResult[] =>
    (data.data || [])
      .slice(0, maxResults)
      .map((r) => {
        const url = r.url || '';
        return {
          title: r.title || '',
          url,
          snippet: r.description || '',
          domain: extractDomain(url),
          favicon: r.favicon || undefined,
        };
      })
      .filter((r) => r.url && r.title);

  try {
    const candidates: Array<{ label: string; query: string }> = [
      { label: 'primary', query: primaryQuery },
      {
        label: 'no_modifiers',
        query: buildBaseSearchQuery(metricDescription, excludeUrls),
      },
      {
        label: 'alt_variation',
        query: buildSearchQuery(metricDescription, variation + 1, excludeUrls),
      },
      {
        label: 'generic_hint',
        query: buildBaseSearchQuery(
          `${metricDescription} data source`,
          excludeUrls,
        ),
      },
    ];

    const seen = new Set<string>();
    const attempts = candidates.filter((c) => {
      const q = c.query.trim();
      if (!q || seen.has(q)) return false;
      seen.add(q);
      return true;
    });

    let results: SearchResult[] = [];
    for (const attempt of attempts) {
      const data = await fetchJina(attempt.query);
      results = parse(data);
      console.log('[JinaSearch] Attempt complete:', {
        label: attempt.label,
        result_count: results.length,
      });
      if (results.length > 0) break;
    }

    console.log('[JinaSearch] Response received:', {
      result_count: results.length,
      sample: results.slice(0, 3).map((r) => ({
        title: r.title.slice(0, 120),
        url: r.url,
        domain: r.domain,
      })),
    });

    return results;
  } catch (error) {
    console.error('[JinaSearch] Search failed:', error);
    throw new Error(
      error instanceof Error
        ? `Jina Search failed: ${error.message}`
        : 'Jina Search failed with unknown error',
    );
  }
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

const SEARCH_VARIATIONS: Array<string[]> = [
  ['official data', 'statistics', 'API', 'source'],
  ['live data', 'real-time', 'current', 'tracker'],
  ['government', 'institution', 'official report', 'database'],
  ['API endpoint', 'developer', 'data feed', 'JSON'],
  ['market data', 'price feed', 'exchange', 'trading'],
  ['data source', 'metrics', 'dashboard', 'monitor'],
];

function buildSearchQuery(
  metricDescription: string,
  variation: number = 0,
  excludeUrls: string[] = [],
): string {
  const baseQuery = metricDescription.trim();
  const variationIndex = Math.abs(variation) % SEARCH_VARIATIONS.length;
  const modifiers = SEARCH_VARIATIONS[variationIndex];
  const modifierQuery = modifiers.map((m) => `"${m}"`).join(' OR ');
  const exclusionQuery = buildExclusionClause(excludeUrls);

  return `${baseQuery} (${modifierQuery})${exclusionQuery}`;
}

function buildBaseSearchQuery(
  metricDescription: string,
  excludeUrls: string[] = [],
): string {
  const baseQuery = String(metricDescription || '').trim();
  const exclusionQuery = buildExclusionClause(excludeUrls);
  return `${baseQuery}${exclusionQuery}`.trim();
}

function buildExclusionClause(excludeUrls: string[]): string {
  if (excludeUrls.length === 0) return '';

  const domains = excludeUrls
    .map((url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })
    .filter((d): d is string => d !== null);

  const uniqueDomains = [...new Set(domains)];
  if (uniqueDomains.length === 0) return '';

  return ' ' + uniqueDomains.map((d) => `-site:${d}`).join(' ');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const searchCache = new Map<
  string,
  { results: SearchResult[]; timestamp: number }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cached wrapper around searchMetricSources.
 */
export async function searchMetricSourcesCached(
  metricDescription: string,
  options: SearchOptions | number = {},
): Promise<SearchResult[]> {
  const opts: SearchOptions =
    typeof options === 'number' ? { maxResults: options } : options;

  const maxResults = opts.maxResults ?? 10;
  const variation = opts.variation ?? 0;
  const excludeUrls = opts.excludeUrls ?? [];

  const cacheKeyData = JSON.stringify({
    desc: metricDescription.toLowerCase().trim(),
    var: variation,
    excl: excludeUrls.sort(),
  });
  const cacheKey = Buffer.from(cacheKeyData).toString('base64').slice(0, 128);

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[JinaSearch] Cache hit:', {
      description_preview: metricDescription.slice(0, 120),
      variation,
      excludeUrls_count: excludeUrls.length,
      result_count: cached.results.length,
    });
    return cached.results;
  }

  const results = await searchMetricSources(metricDescription, opts);

  if (results.length > 0) {
    searchCache.set(cacheKey, { results, timestamp: Date.now() });
  }

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
