/**
 * 🗂️ DexContractsV2 Metric Registry Hook
 * 
 * Provides dynamic access to registered metrics from the MetricRegistry contract.
 * Useful for discovering new metrics and mapping names to IDs.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPublicClient, custom } from 'viem';
import { readContract } from 'viem/actions';
import { polygon } from 'viem/chains';
import { getContractAddresses, METRIC_REGISTRY_ABI } from '@/lib/contracts';

interface MetricDefinition {
  metricId: string;
  name: string;
  description: string;
  dataSource: string;
  calculationMethod: string;
  creator: string;
  createdAt: bigint;
  settlementPeriodDays: bigint;
  minimumStake: bigint;
  isActive: boolean;
  umaIdentifier: string;
}

interface UseMetricRegistryResult {
  metrics: MetricDefinition[];
  isLoading: boolean;
  error: string | null;
  getMetricByName: (name: string) => MetricDefinition | null;
  getMetricIdByName: (name: string) => string | null;
  refreshMetrics: () => Promise<void>;
}

export function useMetricRegistry(): UseMetricRegistryResult {
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const publicClient = useRef<any>(null);
  const addresses = getContractAddresses('polygon');

  // Initialize public client
  const initializeClient = useCallback(async () => {
    if (!addresses.DEXV2_METRIC_REGISTRY) {
      throw new Error('Missing DEXV2_METRIC_REGISTRY address');
    }

    if (typeof globalThis !== 'undefined' && (globalThis as any).window?.ethereum) {
      publicClient.current = createPublicClient({
        chain: polygon,
        transport: custom((globalThis as any).window.ethereum)
      });
    } else {
      throw new Error('Ethereum provider not available');
    }
  }, [addresses.DEXV2_METRIC_REGISTRY]);

  // Fetch all active metrics from the registry
  const fetchMetrics = useCallback(async () => {
    if (!publicClient.current) {
      await initializeClient();
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('🔄 Fetching active metrics from registry...');

             // Get all active metric IDs
       const activeMetricIds = await readContract(publicClient.current, {
         address: addresses.DEXV2_METRIC_REGISTRY as `0x${string}`,
         abi: METRIC_REGISTRY_ABI,
         functionName: 'getActiveMetrics',
       }) as readonly string[];

       console.log(`📋 Found ${activeMetricIds.length} active metrics`);

       // Fetch details for each metric
       const metricPromises = activeMetricIds.map(async (metricId) => {
         const metricData = await readContract(publicClient.current, {
           address: addresses.DEXV2_METRIC_REGISTRY as `0x${string}`,
           abi: METRIC_REGISTRY_ABI,
           functionName: 'getMetric',
           args: [metricId as `0x${string}`],
         }) as readonly [string, string, string, string, string, string, bigint, bigint, bigint, boolean, string];

         return {
           metricId: metricData[0],
           name: metricData[1],
           description: metricData[2],
           dataSource: metricData[3],
           calculationMethod: metricData[4],
           creator: metricData[5],
           createdAt: metricData[6],
           settlementPeriodDays: metricData[7],
           minimumStake: metricData[8],
           isActive: metricData[9],
           umaIdentifier: metricData[10],
         } as MetricDefinition;
       });

      const fetchedMetrics = await Promise.all(metricPromises);
      setMetrics(fetchedMetrics);
      
      console.log('✅ Metrics loaded:', fetchedMetrics.map(m => m.name));

    } catch (err) {
      console.error('❌ Error fetching metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setIsLoading(false);
    }
  }, [addresses.DEXV2_METRIC_REGISTRY, initializeClient]);

  // Get metric by name
  const getMetricByName = useCallback((name: string): MetricDefinition | null => {
    return metrics.find(m => m.name.toLowerCase() === name.toLowerCase()) || null;
  }, [metrics]);

  // Get metric ID by name
  const getMetricIdByName = useCallback((name: string): string | null => {
    const metric = getMetricByName(name);
    return metric ? metric.metricId : null;
  }, [getMetricByName]);

  // Initialize and fetch metrics on mount
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return {
    metrics,
    isLoading,
    error,
    getMetricByName,
    getMetricIdByName,
    refreshMetrics: fetchMetrics,
  };
} 