# Rate Limiting Improvements

## Overview
This document describes the rate limiting improvements made to prevent RPC timeout errors and "Too many requests" errors from blockchain providers.

## Problem
The application was experiencing rate limit errors like:
```
Error: could not coalesce error (error={ "code": -32090, "data": { "trace_id": "..." }, "message": "Too many requests, reason: call rate limit exhausted, retry in 10m0s" })
```

## Solutions Implemented

### 1. Rate Limiting Utility (`src/lib/rateLimiter.ts`)
- Added a comprehensive rate limiter with configurable limits per second, minute, and hour
- Default limits: 5 requests/second, 60 requests/minute, 800 requests/hour
- Provides automatic request queuing and timing

### 2. Blockchain Event Querier Updates (`src/lib/blockchainEventQuerier.ts`)
- Applied rate limiting to all RPC calls:
  - `getBlockNumber()`
  - `getLogs()`
  - `getBlock()`
  - `getNetwork()`
- Increased delay between batch requests from 100ms to 500ms
- Fixed ethers v6 compatibility issue with `log.index` vs `log.logIndex`

### 3. Hook Optimizations

#### useVAMMTrading Hook (`src/hooks/useVAMMTrading.tsx`)
- Reduced refresh interval from 10 seconds to 30 seconds
- Added 100ms delay before data fetching to prevent burst requests
- Improved transaction timeout handling with 2-minute timeout and retry logic

#### useETHPrice Hook (`src/hooks/useETHPrice.tsx`)
- Increased refresh interval from 60 seconds to 120 seconds (2 minutes)

#### useBlockchainEvents Hook (`src/hooks/useBlockchainEvents.tsx`)
- Enforced minimum refetch interval of 15 seconds
- Added warning when intervals are adjusted for rate limiting

### 4. Transaction Handling Improvements
- Extended transaction wait timeout to 2 minutes
- Added fallback receipt checking for timed-out transactions
- Improved error messages for timeout scenarios

## Usage Guidelines

### For Developers
1. Use the `withRateLimit()` function for any new RPC calls
2. Avoid polling intervals shorter than 15 seconds
3. Consider caching strategies for frequently accessed data

### For Users
- If you see timeout errors, they should now be handled gracefully
- Transactions may take longer to confirm but will be more reliable
- Rate limit warnings in console are normal and help prevent errors

## Configuration

### Rate Limiter Settings
```typescript
const rateLimiter = new RateLimiter(
  5,   // requests per second
  60,  // requests per minute
  800  // requests per hour
);
```

### Recommended Intervals
- Data refresh: 30+ seconds
- Price updates: 120+ seconds
- Event polling: 15+ seconds

## Monitoring

The rate limiter provides status information:
```typescript
const status = blockchainRateLimiter.getStatus();
console.log('Current usage:', status);
```

## Future Improvements

1. **Dynamic Rate Limiting**: Adjust limits based on provider responses
2. **Provider Fallbacks**: Switch to backup RPC providers when limits are hit
3. **Smarter Caching**: Cache more data to reduce RPC calls
4. **User Notifications**: Better UI feedback for rate limit scenarios 