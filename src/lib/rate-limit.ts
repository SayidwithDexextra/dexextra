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

