export class RateLimiter {
  private requestTimes: number[] = [];
  private maxRequestsPerSecond: number;
  private maxRequestsPerMinute: number;
  private maxRequestsPerHour: number;

  constructor(
    maxRequestsPerSecond: number = 10,
    maxRequestsPerMinute: number = 100,
    maxRequestsPerHour: number = 1000
  ) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.maxRequestsPerHour = maxRequestsPerHour;
  }

  /**
   * Check if a request can be made now
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Clean up old requests
    this.cleanup(now);
    
    // Check limits
    const secondCount = this.countRequestsInWindow(now, 1000);
    const minuteCount = this.countRequestsInWindow(now, 60000);
    const hourCount = this.countRequestsInWindow(now, 3600000);
    
    return (
      secondCount < this.maxRequestsPerSecond &&
      minuteCount < this.maxRequestsPerMinute &&
      hourCount < this.maxRequestsPerHour
    );
  }

  /**
   * Wait until a request can be made
   */
  async waitForRequest(): Promise<void> {
    while (!this.canMakeRequest()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Record the request
    this.requestTimes.push(Date.now());
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForRequest();
    return await fn();
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    secondCount: number;
    minuteCount: number;
    hourCount: number;
    maxSecond: number;
    maxMinute: number;
    maxHour: number;
  } {
    const now = Date.now();
    this.cleanup(now);
    
    return {
      secondCount: this.countRequestsInWindow(now, 1000),
      minuteCount: this.countRequestsInWindow(now, 60000),
      hourCount: this.countRequestsInWindow(now, 3600000),
      maxSecond: this.maxRequestsPerSecond,
      maxMinute: this.maxRequestsPerMinute,
      maxHour: this.maxRequestsPerHour
    };
  }

  /**
   * Count requests in a time window
   */
  private countRequestsInWindow(now: number, windowMs: number): number {
    const cutoff = now - windowMs;
    return this.requestTimes.filter(time => time > cutoff).length;
  }

  /**
   * Clean up old request records
   */
  private cleanup(now: number): void {
    const cutoff = now - 3600000; // Keep 1 hour of history
    this.requestTimes = this.requestTimes.filter(time => time > cutoff);
  }
}

// Global rate limiter instance for blockchain RPC calls
export const blockchainRateLimiter = new RateLimiter(
  5,   // 5 requests per second
  60,  // 60 requests per minute
  800  // 800 requests per hour
);

// Utility function to wrap async functions with rate limiting
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  return await blockchainRateLimiter.execute(fn);
}

// Utility function to add delay between requests
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
} 