// Server-side points helper (Phase 3 of the growth system).
//
// Wraps the idempotent `award_points` Postgres function. Call this from
// server code (API routes, webhooks, edge logic that reaches our API) when a
// point-earning action happens. One-time actions MUST pass a stable
// `dedupeKey` so the same action is never awarded twice.
//
// IMPORTANT: uses the service-role client — never import this into client code.

import { supabaseAdmin } from './supabase-admin';

// Canonical point actions and their values. Mirrors the spec in gtm.md.
export const POINT_ACTIONS = {
  referral_signup: 5,
  referral_first_trade: 25,
  referral_volume_1k: 50,
  referral_volume_10k: 150,
  market_created_active: 100,
  market_created_volume: 200,
} as const;

export type PointAction = keyof typeof POINT_ACTIONS;

export interface AwardPointsResult {
  awarded: boolean;
  points: number;
  action: string;
}

/**
 * Award points to a wallet. Idempotent when `dedupeKey` is provided: repeated
 * calls with the same (wallet, action, dedupeKey) are no-ops that return
 * `awarded: false`.
 *
 * @param walletAddress  recipient wallet (lowercased server-side)
 * @param action         a known point action; its value comes from POINT_ACTIONS
 * @param options.dedupeKey  stable key for one-time awards (e.g. referred wallet, market id)
 * @param options.metadata   optional JSON context stored with the award
 * @param options.points     override the default point value (rarely needed)
 */
export async function awardPoints(
  walletAddress: string,
  action: PointAction,
  options: {
    dedupeKey?: string;
    metadata?: Record<string, unknown>;
    points?: number;
  } = {}
): Promise<AwardPointsResult> {
  const points = options.points ?? POINT_ACTIONS[action];

  const { data, error } = await supabaseAdmin.rpc('award_points', {
    p_wallet_address: walletAddress.toLowerCase(),
    p_action: action,
    p_points: points,
    p_metadata: options.metadata ?? {},
    p_dedupe_key: options.dedupeKey ?? null,
  });

  if (error) {
    console.error(`award_points RPC error (${action}):`, error);
    throw new Error(`Failed to award points for ${action}`);
  }

  const result = (data ?? {}) as Partial<AwardPointsResult>;
  return {
    awarded: Boolean(result.awarded),
    points: Number(result.points ?? 0),
    action,
  };
}
