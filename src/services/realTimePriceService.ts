import { 
  createPublicClient, 
  http, 
  PublicClient, 
  getContract,
  formatEther
} from 'viem';
import { polygon } from 'viem/chains';
import { getPusherServer, PriceUpdateEvent, TokenTickerEvent } from '@/lib/pusher-server';
import { fetchTokenPrices } from '@/lib/tokenService';

interface VAMMMarket {
  id: number;
  symbol: string;
  vamm_address: string;
  vault_address: string;
  oracle_address: string;
  initial_price: number;
  collateral_token: string;
  network: string;
  deployment_status: string;
}

interface PriceData {
  markPrice: number;
  fundingRate: number;
  volume24h?: number;
  priceChange24h?: number;
}

/**
 * RealTimePriceService - Service for broadcasting real-time price updates
 * 
 * This service replaces polling mechanisms with Pusher-based real-time broadcasting.
 * It fetches prices from VAMM contracts and external APIs, then broadcasts updates
 * to subscribed clients.
 */
export class RealTimePriceService {
  private pusherServer = getPusherServer();
  private isRunning = false;
  private updateInterval?: NodeJS.Timeout;
  private tickerInterval?: NodeJS.Timeout;
  private publicClient?: PublicClient;
  private vammContracts: Map<string, any> = new Map();
  private lastPrices: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();

  // Configuration
  private readonly PRICE_UPDATE_INTERVAL = 10000; // 10 seconds for VAMM prices
  private readonly TICKER_UPDATE_INTERVAL = 60000; // 1 minute for external token prices
  private readonly MAX_ERROR_COUNT = 5;

  constructor() {
    this.initializeProvider();
  }

  private initializeProvider() {
    try {
      // Use the primary RPC URL from environment
      const rpcUrl = process.env.RPC_URL || 'https://polygon-rpc.com/';
      this.publicClient = createPublicClient({
        chain: polygon,
        transport: http(rpcUrl)
      });
      console.log('🔗 RPC Provider initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize RPC provider:', error);
    }
  }

  /**
   * Start the real-time price broadcasting service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Real-time price service is already running');
      return;
    }

    if (!this.publicClient) {
      console.error('❌ Cannot start price service: RPC provider not initialized');
      return;
    }

    try {
      // Load VAMM markets from database
      await this.loadVAMMMarkets();

      // Start price update intervals
      this.startVAMMPriceUpdates();
      this.startTokenTickerUpdates();

      this.isRunning = true;
      console.log('🚀 Real-time price service started successfully');
    } catch (error) {
      console.error('❌ Failed to start real-time price service:', error);
    }
  }

  /**
   * Stop the real-time price broadcasting service
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('⚠️ Real-time price service is not running');
      return;
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = undefined;
    }

    this.isRunning = false;
    console.log('🛑 Real-time price service stopped');
  }

  /**
   * Load VAMM markets from database and initialize contracts
   */
  private async loadVAMMMarkets(): Promise<void> {
    try {
      console.log('📊 Loading VAMM markets...');
      
      // Fetch markets from API (only deployed ones with valid addresses)
      const response = await fetch('/api/markets?status=deployed&limit=100');
      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.status}`);
      }
      
      const data: any = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch markets');
      }
      
      const markets: VAMMMarket[] = data.markets || [];
      
      // Filter markets that have valid VAMM addresses
      const validMarkets = markets.filter((market: VAMMMarket) => 
        market.vamm_address && 
        market.vault_address && 
        market.deployment_status === 'deployed'
      );

      for (const market of validMarkets) {
        await this.initializeVAMMContract(market);
      }

      console.log(`✅ Loaded ${validMarkets.length} VAMM markets`);
    } catch (error) {
      console.error('❌ Failed to load VAMM markets:', error);
    }
  }

  /**
   * Initialize a VAMM contract for price fetching
   */
  private async initializeVAMMContract(market: VAMMMarket): Promise<void> {
    try {
      if (!this.publicClient) return;

      // Simple VAMM ABI - only need getMarkPrice function
      const vammABI = [
        {
          name: 'getMarkPrice',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint256' }]
        },
        {
          name: 'getCollateralBalance',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ type: 'address', name: 'user' }],
          outputs: [{ type: 'uint256' }]
        },
        {
          name: 'isLong',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ type: 'address', name: 'user' }],
          outputs: [{ type: 'bool' }]
        }
      ] as const;

      const contract = getContract({
        address: market.vamm_address as `0x${string}`,
        abi: vammABI,
        client: this.publicClient
      });

      this.vammContracts.set(market.symbol, contract);
      this.lastPrices.set(market.symbol, market.initial_price);
      this.errorCounts.set(market.symbol, 0);

      console.log(`📝 Initialized contract for ${market.symbol}`);
    } catch (error) {
      console.error(`❌ Failed to initialize contract for ${market.symbol}:`, error);
    }
  }

  /**
   * Start VAMM price updates
   */
  private startVAMMPriceUpdates(): void {
    this.updateInterval = setInterval(async () => {
      await this.updateVAMMPrices();
    }, this.PRICE_UPDATE_INTERVAL);

    // Immediate first update
    this.updateVAMMPrices();
    
    console.log(`⏰ VAMM price updates started (${this.PRICE_UPDATE_INTERVAL}ms interval)`);
  }

  /**
   * Start token ticker updates
   */
  private startTokenTickerUpdates(): void {
    this.tickerInterval = setInterval(async () => {
      await this.updateTokenTicker();
    }, this.TICKER_UPDATE_INTERVAL);

    // Immediate first update
    this.updateTokenTicker();
    
    console.log(`⏰ Token ticker updates started (${this.TICKER_UPDATE_INTERVAL}ms interval)`);
  }

  /**
   * Update VAMM prices and broadcast via Pusher
   */
  private async updateVAMMPrices(): Promise<void> {
    if (!this.isRunning || this.vammContracts.size === 0) return;

    const updates: PriceUpdateEvent[] = [];
    const timestamp = Date.now();

    for (const [symbol, contract] of this.vammContracts) {
      try {
        const priceData = await this.fetchVAMMPrice(symbol, contract);
        
        if (priceData) {
          const lastPrice = this.lastPrices.get(symbol) || 0;
          const priceChange24h = lastPrice > 0 
            ? ((priceData.markPrice - lastPrice) / lastPrice) * 100 
            : 0;

          const update: PriceUpdateEvent = {
            symbol,
            markPrice: priceData.markPrice,
            fundingRate: priceData.fundingRate,
            timestamp,
            priceChange24h,
            volume24h: priceData.volume24h,
          };

          updates.push(update);
          this.lastPrices.set(symbol, priceData.markPrice);
          this.errorCounts.set(symbol, 0); // Reset error count on success

          console.log(`📈 ${symbol}: $${priceData.markPrice.toFixed(4)} (${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}%)`);
        }
      } catch (error) {
        this.handlePriceError(symbol, error);
      }
    }

    // Broadcast batch updates if we have any
    if (updates.length > 0) {
      try {
        await this.pusherServer.broadcastBatchPriceUpdates(updates);
        console.log(`🔥 Broadcasted ${updates.length} VAMM price updates`);
      } catch (error) {
        console.error('❌ Failed to broadcast VAMM price updates:', error);
      }
    }
  }

  /**
   * Fetch price data from a VAMM contract
   */
  private async fetchVAMMPrice(symbol: string, contract: any): Promise<PriceData | null> {
    try {
      // Fetch mark price from contract
      const markPriceBigInt = await contract.read.getMarkPrice();
      const markPrice = parseFloat(formatEther(markPriceBigInt));

      // SimpleVAMM doesn't have funding rates - always 0
      const fundingRate = 0;

      // Estimate 24h volume based on price movement (placeholder)
      const lastPrice = this.lastPrices.get(symbol) || markPrice;
      const priceMovement = Math.abs(markPrice - lastPrice) / lastPrice;
      const estimatedVolume = markPrice * 1000000 * Math.min(priceMovement * 10, 1); // Rough estimate

      return {
        markPrice,
        fundingRate,
        volume24h: estimatedVolume,
      };
    } catch (error) {
      console.error(`❌ Failed to fetch price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Update external token ticker prices
   */
  private async updateTokenTicker(): Promise<void> {
    try {
      console.log('🎯 Updating token ticker prices...');
      
      // Fetch prices from external API
      const tokens = ['BTC', 'ETH', 'USDC', 'MATIC', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE'];
      const prices = await fetchTokenPrices(tokens);

      if (Object.keys(prices).length === 0) {
        console.warn('⚠️ No token prices received from external API');
        return;
      }

      // Convert to ticker events
      const tickerUpdates: TokenTickerEvent[] = Object.values(prices).map(token => ({
        symbol: token.symbol,
        price: token.price,
        priceChange24h: token.price_change_percentage_24h,
        timestamp: Date.now(),
      }));

      // Broadcast ticker updates
      await this.pusherServer.broadcastTokenTicker(tickerUpdates);
      
      console.log(`🎯 Broadcasted ${tickerUpdates.length} token ticker updates`);
    } catch (error) {
      console.error('❌ Failed to update token ticker:', error);
    }
  }

  /**
   * Handle price fetching errors
   */
  private handlePriceError(symbol: string, error: any): void {
    const errorCount = (this.errorCounts.get(symbol) || 0) + 1;
    this.errorCounts.set(symbol, errorCount);

    console.error(`❌ Price error for ${symbol} (${errorCount}/${this.MAX_ERROR_COUNT}):`, error);

    // If we have too many errors, temporarily disable this market
    if (errorCount >= this.MAX_ERROR_COUNT) {
      console.warn(`⚠️ Temporarily disabling price updates for ${symbol} due to repeated errors`);
      this.vammContracts.delete(symbol);
      
      // Re-enable after 5 minutes
      setTimeout(() => {
        console.log(`🔄 Re-enabling price updates for ${symbol}`);
        this.errorCounts.set(symbol, 0);
        this.loadVAMMMarkets(); // Reload to re-initialize contract
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Manually trigger a price update for a specific market
   */
  async triggerPriceUpdate(symbol: string): Promise<void> {
    const contract = this.vammContracts.get(symbol);
    if (!contract) {
      console.error(`❌ No contract found for symbol: ${symbol}`);
      return;
    }

    try {
      const priceData = await this.fetchVAMMPrice(symbol, contract);
      
      if (priceData) {
        const update: PriceUpdateEvent = {
          symbol,
          markPrice: priceData.markPrice,
          fundingRate: priceData.fundingRate,
          timestamp: Date.now(),
          priceChange24h: 0, // No historical data for manual trigger
          volume24h: priceData.volume24h,
        };

        await this.pusherServer.broadcastPriceUpdate(update);
        console.log(`📈 Manual price update triggered for ${symbol}: $${priceData.markPrice}`);
      }
    } catch (error) {
      console.error(`❌ Failed to trigger price update for ${symbol}:`, error);
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      connectedMarkets: this.vammContracts.size,
      markets: Array.from(this.vammContracts.keys()),
      hasProvider: !!this.publicClient,
      errorCounts: Object.fromEntries(this.errorCounts),
      lastPrices: Object.fromEntries(this.lastPrices),
    };
  }
}

// Singleton instance
let priceServiceInstance: RealTimePriceService | null = null;

/**
 * Get the singleton RealTimePriceService instance
 */
export function getRealTimePriceService(): RealTimePriceService {
  if (!priceServiceInstance) {
    priceServiceInstance = new RealTimePriceService();
  }
  return priceServiceInstance;
}

/**
 * Start the real-time price service
 */
export async function startRealTimePriceService(): Promise<void> {
  const service = getRealTimePriceService();
  await service.start();
}

/**
 * Stop the real-time price service
 */
export function stopRealTimePriceService(): void {
  const service = getRealTimePriceService();
  service.stop();
} 