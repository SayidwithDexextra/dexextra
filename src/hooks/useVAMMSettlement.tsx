'use client';

import { useMemo } from 'react';
import { VAMMMarket } from './useVAMMMarkets';

export interface SettlementData {
  settlementDate: Date;
  isNearSettlement: boolean;
  daysUntilSettlement: number;
  settlementPhase: 'trading' | 'near_settlement' | 'settling' | 'settled';
}

export interface UseVAMMSettlementOptions {
  nearSettlementThresholdDays?: number; // Default 3 days
}

export function useVAMMSettlement(
  vammMarket: VAMMMarket | null,
  options: UseVAMMSettlementOptions = {}
): SettlementData | null {
  const { nearSettlementThresholdDays = 3 } = options;

  return useMemo(() => {
    if (!vammMarket || !vammMarket.created_at) {
      return null;
    }

    // Calculate settlement date from creation date + settlement period
    const createdAt = new Date(vammMarket.created_at);
    const settlementPeriodDays = vammMarket.settlement_period_days || 7; // Default 7 days
    
    // Add settlement period to creation date
    const settlementDate = new Date(createdAt);
    settlementDate.setDate(settlementDate.getDate() + settlementPeriodDays);

    // Calculate days until settlement
    const now = new Date();
    const timeDiff = settlementDate.getTime() - now.getTime();
    const daysUntilSettlement = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    // Determine settlement phase
    let settlementPhase: 'trading' | 'near_settlement' | 'settling' | 'settled';
    
    if (daysUntilSettlement <= 0) {
      settlementPhase = 'settled';
    } else if (daysUntilSettlement <= 1) {
      settlementPhase = 'settling';
    } else if (daysUntilSettlement <= nearSettlementThresholdDays) {
      settlementPhase = 'near_settlement';
    } else {
      settlementPhase = 'trading';
    }

    const isNearSettlement = daysUntilSettlement <= nearSettlementThresholdDays && daysUntilSettlement > 0;

    return {
      settlementDate,
      isNearSettlement,
      daysUntilSettlement,
      settlementPhase
    };
  }, [vammMarket, nearSettlementThresholdDays]);
} 