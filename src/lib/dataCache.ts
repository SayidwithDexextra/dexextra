/**
 * Simple in-memory cache with stale-while-revalidate pattern.
 * Data persists across page navigations within the same session.
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

// In-memory cache store (persists across navigations but not page refreshes)
const memoryCache = new Map<string, CacheEntry<unknown>>();

// Default stale time: 30 seconds
const DEFAULT_STALE_TIME = 30 * 1000;

// Default max age: 5 minutes (after this, cache is considered expired)
const DEFAULT_MAX_AGE = 5 * 60 * 1000;

export type CacheOptions = {
  /** Time in ms before data is considered stale (default: 30s) */
  staleTime?: number;
  /** Time in ms before data is expired and must be refetched (default: 5min) */
  maxAge?: number;
  /** Storage key prefix */
  keyPrefix?: string;
};

/**
 * Get cached data if available
 */
export function getCached<T>(key: string): T | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return entry.data;
}

/**
 * Check if cached data is stale (but still usable)
 */
export function isStale(key: string, staleTime: number = DEFAULT_STALE_TIME): boolean {
  const entry = memoryCache.get(key);
  if (!entry) return true;
  return Date.now() - entry.timestamp > staleTime;
}

/**
 * Check if cached data is expired (must refetch)
 */
export function isExpired(key: string, maxAge: number = DEFAULT_MAX_AGE): boolean {
  const entry = memoryCache.get(key);
  if (!entry) return true;
  return Date.now() - entry.timestamp > maxAge;
}

/**
 * Set cached data
 */
export function setCache<T>(key: string, data: T): void {
  memoryCache.set(key, {
    data,
    timestamp: Date.now(),
  });

  // Also persist to sessionStorage for page refresh persistence
  try {
    sessionStorage.setItem(
      `cache:${key}`,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // Ignore storage errors (quota, private browsing, etc.)
  }
}

/**
 * Get cached data, checking sessionStorage if not in memory
 */
export function getFromCacheOrStorage<T>(key: string): T | null {
  // First check memory cache
  const memEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memEntry) return memEntry.data;

  // Fall back to sessionStorage
  try {
    const stored = sessionStorage.getItem(`cache:${key}`);
    if (stored) {
      const parsed = JSON.parse(stored) as CacheEntry<T>;
      // Restore to memory cache
      memoryCache.set(key, parsed);
      return parsed.data;
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Check staleness considering both memory and sessionStorage
 */
export function isDataStale(key: string, staleTime: number = DEFAULT_STALE_TIME): boolean {
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    return Date.now() - memEntry.timestamp > staleTime;
  }

  try {
    const stored = sessionStorage.getItem(`cache:${key}`);
    if (stored) {
      const parsed = JSON.parse(stored) as CacheEntry<unknown>;
      return Date.now() - parsed.timestamp > staleTime;
    }
  } catch {
    // Ignore
  }

  return true;
}

/**
 * Clear specific cache entry
 */
export function clearCache(key: string): void {
  memoryCache.delete(key);
  try {
    sessionStorage.removeItem(`cache:${key}`);
  } catch {
    // Ignore
  }
}

/**
 * Clear all cache entries with a given prefix
 */
export function clearCacheByPrefix(prefix: string): void {
  // Clear memory cache
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  // Clear sessionStorage
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`cache:${prefix}`)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore
  }
}

// Cache keys for watchlist data
export const CACHE_KEYS = {
  WATCHLIST: (wallet: string) => `watchlist:${wallet}`,
  MARKET_RANKINGS: (kind: string) => `rankings:${kind}`,
  MARKET_OVERVIEW: 'market-overview',
} as const;
