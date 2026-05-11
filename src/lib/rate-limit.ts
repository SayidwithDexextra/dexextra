import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate limiting + gasless trade circuit breaker, backed by Upstash Redis.
 *
 * Failure-mode contract:
 *   - If REDIS_URL / REDIS_TOKEN are missing, malformed, or the Upstash
 *     database is unreachable (e.g. DB deleted or renamed → DNS NOTFOUND),
 *     ALL limiters silently allow every request and the circuit breaker
 *     stays closed. We log ONCE at startup and ONCE on first runtime
 *     failure — never per-request — so a missing/dead Redis can't spam
 *     the production logs.
 *   - The trade-off is intentional: rate-limiting + the relayer kill switch
 *     are best-effort safety features, not auth. If they're down we'd
 *     rather keep the app serving than 500 every request. Operators are
 *     expected to monitor /api/admin/rate-limit-status (or equivalent)
 *     and re-provision Redis when this happens.
 */

type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending: Promise<unknown>;
};

type LimiterLike = {
  limit(identifier: string): Promise<LimitResult>;
};

// ── Configure Redis (or null when not configured) ─────────────────────────
const REDIS_URL = process.env.REDIS_URL;
const REDIS_TOKEN = process.env.REDIS_TOKEN;

function buildRedis(): { client: Redis | null; configReason: string } {
  // Format A: Upstash REST URL (https://...) + separate token. Preferred.
  if (
    REDIS_URL &&
    REDIS_TOKEN &&
    (REDIS_URL.startsWith('https://') || REDIS_URL.startsWith('http://'))
  ) {
    return {
      client: new Redis({ url: REDIS_URL, token: REDIS_TOKEN }),
      configReason: 'rest+token',
    };
  }

  // Format B: legacy redis:// URL with embedded creds (rediss://default:TOKEN@HOST:PORT).
  if (REDIS_URL && REDIS_URL.includes('@') && REDIS_URL.includes('upstash.io')) {
    try {
      const u = new URL(REDIS_URL);
      const token = u.password;
      const host = u.hostname;
      const port = u.port;
      if (token && host) {
        return {
          client: new Redis({
            url: `https://${host}${port ? `:${port}` : ''}`,
            token,
          }),
          configReason: 'embedded-creds',
        };
      }
      return { client: null, configReason: 'embedded URL missing token/host' };
    } catch (e: any) {
      return { client: null, configReason: `unparseable REDIS_URL: ${e?.message || e}` };
    }
  }

  if (!REDIS_URL && !REDIS_TOKEN) {
    return { client: null, configReason: 'REDIS_URL and REDIS_TOKEN not set' };
  }
  if (!REDIS_URL) return { client: null, configReason: 'REDIS_URL not set' };
  if (!REDIS_TOKEN && !REDIS_URL.includes('@')) {
    return { client: null, configReason: 'REDIS_TOKEN not set (and REDIS_URL has no embedded creds)' };
  }
  return { client: null, configReason: 'REDIS_URL is not a recognized Upstash format' };
}

const built = buildRedis();
const redis: Redis | null = built.client;

let degraded = redis === null;
let degradeReason: string | null = redis === null ? built.configReason : null;

if (!redis) {
  console.warn(
    `[rate-limit] DISABLED at startup — ${built.configReason}. ` +
      `Rate limiters allow all requests, circuit breaker is always closed. ` +
      `Set REDIS_URL + REDIS_TOKEN (Upstash REST format: https://*.upstash.io) to enable.`,
  );
}

/**
 * Mark the limiter as degraded after a runtime failure (DNS NOTFOUND,
 * timeout, etc). Subsequent calls short-circuit to NOOP without logging,
 * preventing per-request error spam.
 */
function degrade(reason: string) {
  if (!degraded) {
    degraded = true;
    degradeReason = reason;
    console.warn(
      `[rate-limit] DEGRADED at runtime — ${reason}. ` +
        `Switching to NOOP (no rate limiting, circuit breaker stays closed). ` +
        `Re-provision Upstash and update REDIS_URL/REDIS_TOKEN to restore protection.`,
    );
  }
}

function extractFailureReason(e: any): string {
  const cause = e?.cause;
  const code = cause?.code || e?.code;
  const host = cause?.hostname;
  const msg = e?.message || String(e);
  if (code === 'ENOTFOUND') return `Redis host ${host || '(unknown)'} did not resolve (ENOTFOUND)`;
  if (code === 'ECONNREFUSED') return `Redis host refused connection (ECONNREFUSED)`;
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) return `Redis connection timed out`;
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

const NOOP_RESULT_BASE = {
  success: true,
  reset: 0,
  pending: Promise.resolve(),
};

function noopResult(perMinute: number): LimitResult {
  return { ...NOOP_RESULT_BASE, limit: perMinute, remaining: perMinute };
}

function wrapLimiter(perMinute: number): LimiterLike {
  if (!redis) {
    return { limit: async () => noopResult(perMinute) };
  }
  const real = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(perMinute, '1 m'),
    analytics: true,
  });
  return {
    async limit(identifier: string) {
      if (degraded) return noopResult(perMinute);
      try {
        return await real.limit(identifier);
      } catch (e: any) {
        degrade(extractFailureReason(e));
        return noopResult(perMinute);
      }
    },
  };
}

// Same exports as before, same shapes — callers don't need to change.
export const rateLimit = wrapLimiter(100);
export const strictRateLimit = wrapLimiter(10);
export const orderRateLimit = wrapLimiter(50);
export const gaslessTradeRateLimit = wrapLimiter(30);
export const gaslessTradeGlobalRateLimit = wrapLimiter(500);

// ── Circuit breaker (NOOP when degraded) ──────────────────────────────────
const CIRCUIT_BREAKER_KEY = 'gasless:circuit_breaker';
const CIRCUIT_BREAKER_TTL = 60; // seconds to keep circuit open

export async function tripCircuitBreaker(reason: string): Promise<void> {
  if (!redis || degraded) return;
  try {
    await redis.set(
      CIRCUIT_BREAKER_KEY,
      JSON.stringify({ reason, trippedAt: Date.now() }),
      { ex: CIRCUIT_BREAKER_TTL },
    );
  } catch (e: any) {
    degrade(extractFailureReason(e));
  }
}

export async function isCircuitBreakerOpen(): Promise<{
  open: boolean;
  reason?: string;
  trippedAt?: number;
}> {
  if (!redis || degraded) return { open: false };
  try {
    const data = await redis.get(CIRCUIT_BREAKER_KEY);
    if (!data) return { open: false };
    const parsed = typeof data === 'string' ? JSON.parse(data) : (data as any);
    return { open: true, reason: parsed?.reason, trippedAt: parsed?.trippedAt };
  } catch (e: any) {
    degrade(extractFailureReason(e));
    return { open: false };
  }
}

export async function resetCircuitBreaker(): Promise<void> {
  if (!redis || degraded) return;
  try {
    await redis.del(CIRCUIT_BREAKER_KEY);
  } catch (e: any) {
    degrade(extractFailureReason(e));
  }
}

/**
 * Diagnostic helper — wire into an admin route to monitor whether the
 * limiters are actually doing anything.
 */
export function getRateLimitStatus() {
  return {
    enabled: !!redis && !degraded,
    degraded,
    degradeReason,
    hasRedisUrl: !!REDIS_URL,
    hasRedisToken: !!REDIS_TOKEN,
  };
}
