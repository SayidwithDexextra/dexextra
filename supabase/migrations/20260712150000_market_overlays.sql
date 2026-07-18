-- Liquidity Overlay — server-shared source of truth.
--
-- The overlay is a strictly *visual* layer superimposed on top of the real
-- on-chain markets: it drives a platform-wide "mark price" and injects
-- synthetic order-book liquidity + a synthetic trade tape. Because every user
-- must see identical values, the authoritative state lives here (one row per
-- market) and is advanced/persisted server-side via the service-role key.
--
-- The full engine state (mark price, book levels, trade tape, RNG seed, tick
-- counter) is stored in the `state` jsonb blob so the engine can evolve
-- without schema churn. Each synthetic level in that blob carries a stable id
-- and a `remaining` size so a future matching engine can consume specific
-- overlay liquidity and mint real trades against it.

CREATE TABLE IF NOT EXISTS public.market_overlays (
  -- Uppercase market identifier / symbol (primary key).
  symbol      text PRIMARY KEY,
  -- Supabase markets.id (uuid), when known. Nullable so overlays can exist
  -- before a market row is fully resolved.
  market_id   uuid,
  -- Full authoritative engine state (MarketOverlayState).
  state       jsonb NOT NULL,
  -- Denormalized mark price for cheap batch reads (platform-wide price map).
  mark_price  double precision,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_overlays_market_id_idx
  ON public.market_overlays (market_id);

CREATE INDEX IF NOT EXISTS market_overlays_updated_at_idx
  ON public.market_overlays (updated_at DESC);

-- Overlay data is non-sensitive and purely cosmetic. Allow public reads (so a
-- future Supabase Realtime subscription can distribute prices directly), but
-- keep writes locked to the service role used by the /api/overlay routes.
ALTER TABLE public.market_overlays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_overlays_public_read ON public.market_overlays;
CREATE POLICY market_overlays_public_read
  ON public.market_overlays
  FOR SELECT
  USING (true);
