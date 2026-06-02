// Client-side helpers for the referral system (Phase 2 of the growth system).

const REFERRAL_STORAGE_KEY = 'dexetera_ref';
const REFERRAL_CODE_PATTERN = /^[a-fA-F0-9]{8}$/;

export interface ReferralStats {
  referral_code: string | null;
  referral_count: number;
  referral_volume_usd: number;
  total_points: number;
  rank: number | null;
  referral_link: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Reads a `?ref=` code from the current URL and persists it to localStorage
 * so it survives until the user connects a wallet. No-op on the server.
 */
export function captureReferralFromUrl(): void {
  if (typeof window === 'undefined') return;

  try {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');

    if (refCode && REFERRAL_CODE_PATTERN.test(refCode)) {
      window.localStorage.setItem(REFERRAL_STORAGE_KEY, refCode.toLowerCase());
    }
  } catch {
    // Ignore storage/URL access errors (private mode, etc.).
  }
}

export function getStoredReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REFERRAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredReferral(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * If a referral code is stored locally, attempt to attribute it to the
 * connected wallet. Clears the stored code on success or on a definitive
 * outcome (invalid code, self-referral, already referred) so we don't retry
 * forever. Safe to call on every wallet connect; failures are swallowed.
 */
export async function trackStoredReferral(walletAddress: string): Promise<void> {
  const code = getStoredReferralCode();
  if (!code || !REFERRAL_CODE_PATTERN.test(code)) return;

  try {
    const response = await fetch('/api/referral/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: walletAddress.toLowerCase(),
        referral_code: code,
      }),
    });

    // 2xx success, or a definitive 4xx (bad/self/already) — either way stop
    // retrying. Only transient 5xx errors keep the stored code for a later try.
    if (response.ok || (response.status >= 400 && response.status < 500)) {
      clearStoredReferral();
    }
  } catch {
    // Network error — keep the code for the next connect attempt.
  }
}

export async function getReferralStats(walletAddress: string): Promise<ReferralStats | null> {
  try {
    const response = await fetch(
      `/api/referral/stats/${encodeURIComponent(walletAddress.toLowerCase())}`
    );

    if (response.status === 404) return null;

    const result: ApiResponse<ReferralStats> = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to fetch referral stats');
    }

    return result.data ?? null;
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    throw error;
  }
}
