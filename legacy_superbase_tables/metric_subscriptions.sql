CREATE TABLE IF NOT EXISTS public.metric_subscriptions (
  client_id uuid NOT NULL,
  last_seen_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  market_id uuid NOT NULL,
  CONSTRAINT metric_subscriptions_pkey PRIMARY KEY (market_id, client_id),
  CONSTRAINT metric_subscriptions_market_fk FOREIGN KEY (market_id) REFERENCES public.markets(id)
);

CREATE INDEX IF NOT EXISTS idx_metric_subscriptions_last_seen
  ON public.metric_subscriptions (last_seen_at DESC);

ALTER TABLE public.metric_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon/auth can select subscriptions"
  ON public.metric_subscriptions
  FOR SELECT
  USING (true);

CREATE POLICY "Anon/auth can upsert their subscription"
  ON public.metric_subscriptions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anon/auth can update their subscription"
  ON public.metric_subscriptions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon/auth can delete their subscription"
  ON public.metric_subscriptions
  FOR DELETE
  USING (true);
