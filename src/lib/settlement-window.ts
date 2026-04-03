/**
 * Single source for challenge-window end time (matches settlement-engine + SettlementInterface).
 */
export function challengeWindowExpiresMs(market: {
  settlement_date?: string | null;
  market_config?: Record<string, unknown> | null;
}): number | null {
  const cfg = (market.market_config || {}) as Record<string, unknown>;
  const raw = cfg.expires_at;
  if (typeof raw === 'string' && raw.trim()) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  if (!market.settlement_date) return null;
  const settlementMs = new Date(market.settlement_date).getTime();
  if (!Number.isFinite(settlementMs)) return null;
  const sec = Number(cfg.challenge_window_seconds || cfg.challenge_duration_seconds || 0);
  const windowMs = sec > 0 ? sec * 1000 : 24 * 60 * 60 * 1000;
  return settlementMs + windowMs;
}

export function isChallengeWindowActive(market: {
  proposed_settlement_value?: unknown;
  proposed_settlement_at?: string | null;
  settlement_date?: string | null;
  market_config?: Record<string, unknown> | null;
}): boolean {
  const hasProposal =
    market.proposed_settlement_value != null &&
    market.proposed_settlement_value !== '' &&
    Boolean(market.proposed_settlement_at);
  const exp = challengeWindowExpiresMs(market);
  if (!hasProposal || exp == null) return false;
  return exp > Date.now();
}
