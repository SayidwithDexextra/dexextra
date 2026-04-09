import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Create Redis instance for rate limiting
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redis: Redis;

if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
  // Use Upstash Redis with proper configuration
  redis = new Redis({
    url: process.env.REDIS_URL,
    token: process.env.REDIS_TOKEN
  });
} else if (redisUrl.includes('@') && redisUrl.includes('upstash.io')) {
  // This is an Upstash URL with credentials embedded
  try {
    const url = new URL(redisUrl);
    const host = url.hostname;
    const port = url.port;
    const token = url.password;
    
    if (token) {
      redis = new Redis({
        url: `https://${host}${port ? `:${port}` : ''}`,
        token: token
      });
    } else {
      throw new Error('No token found in Upstash URL');
    }
  } catch (error) {
    console.error('Failed to parse Upstash URL:', error);
    // Fallback: Create mock Redis for local development
    redis = new Redis({
      url: 'https://localhost',
      token: 'mock-token'
    });
  }
} else {
  // For local development without Upstash
  console.warn('Using mock Redis configuration for local development');
  redis = new Redis({
    url: 'https://localhost', 
    token: 'mock-token'
  });
}

// Create different rate limiters for different endpoints
export const rateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
  analytics: true,
});

export const strictRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute for sensitive endpoints
  analytics: true,
});

export const orderRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, '1 m'), // 50 orders per minute
  analytics: true,
});

export const gaslessTradeRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'), // 30 gasless trades per minute per IP/session
  analytics: true,
});

export const gaslessTradeGlobalRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(500, '1 m'), // 500 total gasless trades per minute globally
  analytics: true,
});

const CIRCUIT_BREAKER_KEY = 'gasless:circuit_breaker';
const CIRCUIT_BREAKER_TTL = 60; // seconds to keep circuit open

export async function tripCircuitBreaker(reason: string): Promise<void> {
  try {
    await redis.set(CIRCUIT_BREAKER_KEY, JSON.stringify({ reason, trippedAt: Date.now() }), { ex: CIRCUIT_BREAKER_TTL });
  } catch (e) {
    console.error('[CircuitBreaker] Failed to trip:', e);
  }
}

export async function isCircuitBreakerOpen(): Promise<{ open: boolean; reason?: string; trippedAt?: number }> {
  try {
    const data = await redis.get(CIRCUIT_BREAKER_KEY);
    if (!data) return { open: false };
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return { open: true, reason: parsed.reason, trippedAt: parsed.trippedAt };
  } catch (e) {
    console.error('[CircuitBreaker] Failed to check:', e);
    return { open: false };
  }
}

export async function resetCircuitBreaker(): Promise<void> {
  try {
    await redis.del(CIRCUIT_BREAKER_KEY);
  } catch (e) {
    console.error('[CircuitBreaker] Failed to reset:', e);
  }
}

