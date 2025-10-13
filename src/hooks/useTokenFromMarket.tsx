'use client';

import { useMemo } from 'react';
import { OrderbookMarket } from './useOrderbookMarkets';
import { TokenData } from '@/types/token';

/**
 * Hook to transform orderbook market data into token data format
 */
export function useTokenFromMarket(market: OrderbookMarket | null): TokenData | null {
  return useMemo(() => {
    if (!market) return null;

    // Convert orderbook market to token data format
    return {
      name: market.description || market.metric_id,
      symbol: market.metric_id,
      price: market.tick_size || 0, // Use tick_size as the base price for new markets, not historical trade data
      priceChange24h: 0, // TODO: Calculate from actual trade history
      volume24h: market.total_volume || 0,
      marketCap: (market.last_trade_price || market.tick_size || 0) * 1000000, // Estimated
      marketCapChange24h: 0, // TODO: Calculate from actual data
      circulating_supply: 1000000, // Default for prediction markets
      total_supply: 1000000,
      max_supply: 1000000,
      chain: market.chain_id === 137 ? 'Polygon' : 'Ethereum',
      description: market.description,
      website: undefined,
      twitter: undefined,
      telegram: undefined,
      discord: undefined
    };
  }, [market]);
}

/**
 * Interface for VAMM market data compatible with existing components
 */
export interface VAMMMarketFromOrderbook {
  id: string;
  symbol: string;
  description: string;
  category: string[];
  oracle_address: string;
  initial_price: number;
  price_decimals: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  deployment_fee: number;
  is_active: boolean;
  vamm_address?: string;
  vault_address?: string;
  market_id?: string;
  deployment_status: string;
  created_at: string;
  user_address?: string;
  settlement_period_days?: number;
}

/**
 * Hook to transform orderbook market data into VAMM market format for compatibility
 */
export function useVAMMFromMarket(market: OrderbookMarket | null): VAMMMarketFromOrderbook | null {
  return useMemo(() => {
    if (!market) return null;

    // Calculate settlement period from settlement_date and created_at
    const createdAt = new Date(market.created_at);
    const settlementDate = new Date(market.settlement_date);
    const settlementPeriodDays = Math.ceil(
      (settlementDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      id: market.id,
      symbol: market.metric_id,
      description: market.description,
      category: [market.category], // Convert string to array
      oracle_address: '0x0000000000000000000000000000000000000000', // Placeholder
      initial_price: market.tick_size || 0, // Use tick_size as base price, not last_trade_price to avoid stale trading data
      price_decimals: market.decimals,
      banner_image_url: market.banner_image_url,
      icon_image_url: market.icon_image_url,
      supporting_photo_urls: [],
      deployment_fee: 0, // Not applicable for orderbook markets
      is_active: market.market_status === 'ACTIVE',
      vamm_address: market.market_address,
      vault_address: market.factory_address, // Using factory as vault for compatibility
      market_id: market.metric_id,
      deployment_status: market.market_status === 'ACTIVE' ? 'deployed' : 'pending',
      created_at: market.created_at,
      user_address: market.creator_wallet_address,
      settlement_period_days: settlementPeriodDays > 0 ? settlementPeriodDays : 30
    };
  }, [market]);
}

