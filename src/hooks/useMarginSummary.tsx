import { useMemo } from 'react';
import { useCoreVault } from '@/hooks/useCoreVault';

export interface MarginSummary {
  totalCollateral: number;
  lockedCollateral: number;
  availableCollateral: number;
  totalMarginUsed: number;
  unrealizedPnL: number;
  realizedPnL: number;
  marginUtilization: number;
  isHealthy: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useMarginSummary(): MarginSummary {
  const core = useCoreVault();

  return useMemo(() => {
    const totalCollateral = parseFloat(core.totalCollateral || '0');
    const lockedCollateral = parseFloat(core.marginReserved || '0');
    const availableCollateral = parseFloat(core.availableBalance || '0');
    const totalMarginUsed = parseFloat(core.marginUsed || '0');
    const unrealizedPnL = parseFloat(core.unrealizedPnL || '0');
    const realizedPnL = parseFloat(core.realizedPnL || '0');
    const marginBase = totalCollateral > 0 ? totalCollateral : 0;
    const marginUtilization = marginBase > 0 ? ((totalCollateral - availableCollateral) / marginBase) : 0;

    return {
      totalCollateral,
      lockedCollateral,
      availableCollateral,
      totalMarginUsed,
      unrealizedPnL,
      realizedPnL,
      marginUtilization,
      isHealthy: !!core.isHealthy,
      isLoading: !!core.isLoading,
      error: core.error ? String(core.error) : null,
    } as MarginSummary;
  }, [
    core.totalCollateral,
    core.marginReserved,
    core.availableBalance,
    core.marginUsed,
    core.unrealizedPnL,
    core.realizedPnL,
    core.isHealthy,
    core.isLoading,
    core.error,
  ]);
}
