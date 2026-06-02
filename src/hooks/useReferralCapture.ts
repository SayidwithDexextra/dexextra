'use client';

import { useEffect } from 'react';
import { captureReferralFromUrl } from '@/lib/referralApi';

/**
 * Captures a `?ref=` code from the URL on mount and stores it locally so it
 * can be attributed to the user's wallet when they connect. Mount this once
 * near the app root.
 */
export function useReferralCapture(): void {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
}

export default useReferralCapture;
