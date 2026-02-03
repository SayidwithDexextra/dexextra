'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Performance tier for the device
 * - 'high': Powerful device, render all animations and effects
 * - 'medium': Moderate device, reduce some effects
 * - 'low': Weak device or user preference, use static images/minimal animations
 */
export type PerformanceTier = 'high' | 'medium' | 'low';

export interface DevicePerformanceInfo {
  /** Overall performance tier recommendation */
  tier: PerformanceTier;
  /** User prefers reduced motion (OS setting) */
  prefersReducedMotion: boolean;
  /** Device memory in GB (undefined if not available) */
  deviceMemory?: number;
  /** Number of logical CPU cores */
  hardwareConcurrency?: number;
  /** Network effective type: 'slow-2g' | '2g' | '3g' | '4g' */
  connectionType?: string;
  /** Network downlink speed in Mbps */
  downlink?: number;
  /** Data saver mode enabled */
  saveData?: boolean;
  /** Measured FPS (only available after measurement) */
  measuredFps?: number;
  /** Battery saver / low power mode */
  lowPowerMode?: boolean;
  /** Whether performance measurement is still running */
  isMeasuring: boolean;
  /** Force a specific tier (persists to localStorage) */
  setForcedTier: (tier: PerformanceTier | null) => void;
  /** Currently forced tier (null = auto-detect) */
  forcedTier: PerformanceTier | null;
}

const STORAGE_KEY = 'dexextra_performance_tier';

/**
 * Measure actual frame rate by running requestAnimationFrame for a duration
 */
function measureFrameRate(durationMs: number = 1000): Promise<number> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) {
      resolve(60); // Assume 60fps on SSR
      return;
    }

    let frameCount = 0;
    let startTime: number | null = null;
    let rafId: number;

    const countFrame = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      frameCount++;
      const elapsed = timestamp - startTime;

      if (elapsed < durationMs) {
        rafId = requestAnimationFrame(countFrame);
      } else {
        const fps = Math.round((frameCount / elapsed) * 1000);
        resolve(fps);
      }
    };

    rafId = requestAnimationFrame(countFrame);

    // Safety timeout
    setTimeout(() => {
      if (rafId) cancelAnimationFrame(rafId);
    }, durationMs + 500);
  });
}

/**
 * Calculate performance tier based on collected metrics
 */
function calculateTier(metrics: {
  prefersReducedMotion: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connectionType?: string;
  downlink?: number;
  saveData?: boolean;
  measuredFps?: number;
  lowPowerMode?: boolean;
  isInitialized?: boolean;
}): PerformanceTier {
  // Default to 'high' until metrics are collected (avoid flash of fallback)
  if (!metrics.isInitialized) {
    return 'high';
  }

  // User explicitly wants reduced motion - respect it
  if (metrics.prefersReducedMotion) {
    return 'low';
  }

  // Data saver mode or low power mode
  if (metrics.saveData || metrics.lowPowerMode) {
    return 'low';
  }

  // Very slow network
  if (metrics.connectionType === 'slow-2g' || metrics.connectionType === '2g') {
    return 'low';
  }
  if (metrics.downlink !== undefined && metrics.downlink < 1) {
    return 'low';
  }

  // Low device memory
  if (metrics.deviceMemory !== undefined && metrics.deviceMemory < 2) {
    return 'low';
  }
  if (metrics.deviceMemory !== undefined && metrics.deviceMemory < 4) {
    return 'medium';
  }

  // Low CPU cores
  if (metrics.hardwareConcurrency !== undefined && metrics.hardwareConcurrency < 2) {
    return 'low';
  }
  if (metrics.hardwareConcurrency !== undefined && metrics.hardwareConcurrency < 4) {
    return 'medium';
  }

  // Slow frame rate (if measured)
  if (metrics.measuredFps !== undefined) {
    if (metrics.measuredFps < 30) {
      return 'low';
    }
    if (metrics.measuredFps < 50) {
      return 'medium';
    }
  }

  // 3G network - medium tier
  if (metrics.connectionType === '3g') {
    return 'medium';
  }
  if (metrics.downlink !== undefined && metrics.downlink < 5) {
    return 'medium';
  }

  // Default to high performance
  return 'high';
}

/**
 * Hook to detect device performance capabilities and recommend a tier.
 * 
 * @param options.measureFps - Whether to measure actual FPS (adds ~1s delay)
 * @param options.measureDuration - Duration in ms to measure FPS
 * 
 * @example
 * ```tsx
 * const { tier, prefersReducedMotion } = useDevicePerformance();
 * 
 * return tier === 'high' ? <AnimatedBackground /> : <StaticBackground />;
 * ```
 */
export function useDevicePerformance(options?: {
  measureFps?: boolean;
  measureDuration?: number;
}): DevicePerformanceInfo {
  const { measureFps = false, measureDuration = 1000 } = options ?? {};

  const [forcedTier, setForcedTierState] = useState<PerformanceTier | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(measureFps);
  const [metrics, setMetrics] = useState<{
    prefersReducedMotion: boolean;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    connectionType?: string;
    downlink?: number;
    saveData?: boolean;
    measuredFps?: number;
    lowPowerMode?: boolean;
    isInitialized?: boolean;
  }>({
    prefersReducedMotion: false,
    isInitialized: false,
  });

  const hasInitialized = useRef(false);

  // Load forced tier from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'high' || stored === 'medium' || stored === 'low') {
      setForcedTierState(stored);
    }
  }, []);

  // Set forced tier with persistence
  const setForcedTier = useCallback((tier: PerformanceTier | null) => {
    setForcedTierState(tier);
    if (typeof window === 'undefined') return;
    
    if (tier) {
      localStorage.setItem(STORAGE_KEY, tier);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Collect device metrics
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const collectMetrics = async () => {
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        connection?: {
          effectiveType?: string;
          downlink?: number;
          saveData?: boolean;
        };
        getBattery?: () => Promise<{ charging: boolean; level: number }>;
      };

      // Prefers reduced motion
      const prefersReducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

      // Device memory (Chrome/Edge/Opera)
      const deviceMemory = nav.deviceMemory;

      // Hardware concurrency (all modern browsers)
      const hardwareConcurrency = nav.hardwareConcurrency;

      // Network Information API (Chrome/Edge/Opera)
      const connection = nav.connection;
      const connectionType = connection?.effectiveType;
      const downlink = connection?.downlink;
      const saveData = connection?.saveData;

      // Battery API for low power mode detection
      let lowPowerMode = false;
      try {
        if (nav.getBattery) {
          const battery = await nav.getBattery();
          // Consider low power if not charging and below 20%
          lowPowerMode = !battery.charging && battery.level < 0.2;
        }
      } catch {
        // Battery API not available or denied
      }

      const newMetrics = {
        prefersReducedMotion,
        deviceMemory,
        hardwareConcurrency,
        connectionType,
        downlink,
        saveData,
        lowPowerMode,
        measuredFps: undefined as number | undefined,
        isInitialized: true,
      };

      // Measure FPS if requested
      if (measureFps) {
        setIsMeasuring(true);
        const fps = await measureFrameRate(measureDuration);
        newMetrics.measuredFps = fps;
        setIsMeasuring(false);
      }

      setMetrics(newMetrics);
    };

    collectMetrics();

    // Listen for reduced motion preference changes
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e: MediaQueryListEvent) => {
      setMetrics((prev) => ({ ...prev, prefersReducedMotion: e.matches }));
    };

    mediaQuery.addEventListener?.('change', handleChange);

    return () => {
      mediaQuery.removeEventListener?.('change', handleChange);
    };
  }, [measureFps, measureDuration]);

  // Calculate tier
  const tier = forcedTier ?? calculateTier(metrics);

  return {
    tier,
    prefersReducedMotion: metrics.prefersReducedMotion,
    deviceMemory: metrics.deviceMemory,
    hardwareConcurrency: metrics.hardwareConcurrency,
    connectionType: metrics.connectionType,
    downlink: metrics.downlink,
    saveData: metrics.saveData,
    measuredFps: metrics.measuredFps,
    lowPowerMode: metrics.lowPowerMode,
    isMeasuring,
    setForcedTier,
    forcedTier,
  };
}

/**
 * Simple hook that just returns the tier without detailed info.
 * Useful for quick checks.
 */
export function usePerformanceTier(options?: {
  measureFps?: boolean;
}): PerformanceTier {
  const { tier } = useDevicePerformance(options);
  return tier;
}

export default useDevicePerformance;
