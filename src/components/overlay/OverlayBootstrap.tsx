'use client';

/**
 * OverlayBootstrap — mounts once at the app root.
 *
 * Ensures the overlay client cache singleton is loaded (so `window.__overlayCache`
 * and the batch poller exist) and logs the enabled state once for visibility.
 * Renders nothing. Safe no-op when the overlay flag is off.
 */

import { useEffect } from 'react';
import { isOverlayEnabledClient } from '@/lib/overlay/config';
import { overlayCache } from '@/lib/overlay/clientCache';

export default function OverlayBootstrap() {
  useEffect(() => {
    // Touch the singleton so it's initialised even before any consumer mounts.
    void overlayCache;
    if (isOverlayEnabledClient()) {
      // eslint-disable-next-line no-console
      console.log('[LiquidityOverlay] enabled — synthetic mark price + liquidity active');
    }
  }, []);

  return null;
}
