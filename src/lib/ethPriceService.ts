interface ETHPriceResponse {
  price: number;
  changePercent24h: number;
  source: string;
  timestamp: number;
}

interface APIEndpoint {
  name: string;
  url: string;
  parser: (data: any) => ETHPriceResponse;
  timeout: number;
  isDown?: boolean;
  lastFailureTime?: number;
  consecutiveFailures?: number;
}

class CircuitBreaker {
  private failureThreshold = 3;
  private recoveryTimeout = 300000; // 5 minutes

  isEndpointAvailable(endpoint: APIEndpoint): boolean {
    if (!endpoint.isDown) return true;
    
    const now = Date.now();
    const timeSinceLastFailure = now - (endpoint.lastFailureTime || 0);
    
    if (timeSinceLastFailure > this.recoveryTimeout) {
      endpoint.isDown = false;
      endpoint.consecutiveFailures = 0;
      return true;
    }
    
    return false;
  }

  recordFailure(endpoint: APIEndpoint): void {
    endpoint.consecutiveFailures = (endpoint.consecutiveFailures || 0) + 1;
    endpoint.lastFailureTime = Date.now();
    
    if (endpoint.consecutiveFailures >= this.failureThreshold) {
      endpoint.isDown = true;
    }
  }

  recordSuccess(endpoint: APIEndpoint): void {
    endpoint.isDown = false;
    endpoint.consecutiveFailures = 0;
    endpoint.lastFailureTime = undefined;
  }
}

export class ETHPriceService {
  private circuitBreaker = new CircuitBreaker();
  private lastSuccessfulPrice: ETHPriceResponse | null = null;
  private cacheTimeout = 60000; // 1 minute cache

  private endpoints: APIEndpoint[] = [
    {
      name: 'CoinGecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true',
      timeout: 8000,
      parser: (data: any) => ({
        price: data.ethereum.usd,
        changePercent24h: data.ethereum.usd_24h_change || 0,
        source: 'CoinGecko',
        timestamp: Date.now()
      })
    },
    {
      name: 'CoinMarketCap',
      url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=ETH&convert=USD',
      timeout: 8000,
      parser: (data: any) => ({
        price: data.data.ETH.quote.USD.price,
        changePercent24h: data.data.ETH.quote.USD.percent_change_24h || 0,
        source: 'CoinMarketCap',
        timestamp: Date.now()
      })
    },
    {
      name: 'Binance',
      url: 'https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT',
      timeout: 6000,
      parser: (data: any) => ({
        price: parseFloat(data.lastPrice),
        changePercent24h: parseFloat(data.priceChangePercent) || 0,
        source: 'Binance',
        timestamp: Date.now()
      })
    },
    {
      name: 'Kraken',
      url: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD',
      timeout: 8000,
      parser: (data: any) => {
        const ethData = data.result.XETHZUSD || data.result.ETHUSD;
        const currentPrice = parseFloat(ethData.c[0]);
        const openPrice = parseFloat(ethData.o);
        const changePercent24h = ((currentPrice - openPrice) / openPrice) * 100;
        
        return {
          price: currentPrice,
          changePercent24h,
          source: 'Kraken',
          timestamp: Date.now()
        };
      }
    },
    {
      name: 'CryptoCompare',
      url: 'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=ETH&tsyms=USD',
      timeout: 8000,
      parser: (data: any) => ({
        price: data.RAW.ETH.USD.PRICE,
        changePercent24h: data.RAW.ETH.USD.CHANGEPCT24HOUR || 0,
        source: 'CryptoCompare',
        timestamp: Date.now()
      })
    }
  ];

  private async fetchFromEndpoint(endpoint: APIEndpoint): Promise<ETHPriceResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; DexExtra/1.0)',
      };

      // Add API key for CoinMarketCap if available
      if (endpoint.name === 'CoinMarketCap' && process.env.COINMARKETCAP_API_KEY) {
        headers['X-CMC_PRO_API_KEY'] = process.env.COINMARKETCAP_API_KEY;
      }

      const response = await fetch(endpoint.url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`${endpoint.name} API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const result = endpoint.parser(data);
      
      // Validate the result
      if (!result.price || isNaN(result.price) || result.price <= 0) {
        throw new Error(`Invalid price data from ${endpoint.name}: ${result.price}`);
      }

      this.circuitBreaker.recordSuccess(endpoint);
      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      this.circuitBreaker.recordFailure(endpoint);
      throw new Error(`${endpoint.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getETHPrice(): Promise<ETHPriceResponse> {
    // Return cached data if still valid
    if (this.lastSuccessfulPrice && 
        Date.now() - this.lastSuccessfulPrice.timestamp < this.cacheTimeout) {
      return this.lastSuccessfulPrice;
    }

    const errors: string[] = [];
    const availableEndpoints = this.endpoints.filter(endpoint => 
      this.circuitBreaker.isEndpointAvailable(endpoint)
    );

    // If no endpoints are available, try all anyway (circuit breaker recovery)
    const endpointsToTry = availableEndpoints.length > 0 ? availableEndpoints : this.endpoints;

    // Try each endpoint in order
    for (const endpoint of endpointsToTry) {
      try {
        const result = await this.fetchFromEndpoint(endpoint);
        this.lastSuccessfulPrice = result;
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(errorMessage);
        console.warn(`Failed to fetch from ${endpoint.name}:`, errorMessage);
      }
    }

    // If we have a cached price, return it even if stale
    if (this.lastSuccessfulPrice) {
      console.warn('All endpoints failed, returning stale cached data');
      return {
        ...this.lastSuccessfulPrice,
        timestamp: Date.now() // Update timestamp to avoid immediate retry
      };
    }

    // All endpoints failed and no cache available
    throw new Error(`All price sources failed: ${errors.join('; ')}`);
  }

  // Get fallback data when all else fails
  getFallbackData(): ETHPriceResponse {
    return {
      price: 2965, // Reasonable fallback price
      changePercent24h: 0,
      source: 'Fallback',
      timestamp: Date.now()
    };
  }

  // For debugging: get status of all endpoints
  getEndpointStatus() {
    return this.endpoints.map(endpoint => ({
      name: endpoint.name,
      isDown: endpoint.isDown || false,
      consecutiveFailures: endpoint.consecutiveFailures || 0,
      lastFailureTime: endpoint.lastFailureTime,
    }));
  }
}

export const ethPriceService = new ETHPriceService(); 