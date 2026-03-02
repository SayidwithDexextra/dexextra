CREATE TABLE IF NOT EXISTS public.metric_workers (
  instance_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running'::text,
  polling_ms integer NOT NULL DEFAULT 10000,
  started_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  last_seen_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  market_id uuid NOT NULL,
  CONSTRAINT metric_workers_pkey PRIMARY KEY (market_id),
  CONSTRAINT metric_workers_market_fk FOREIGN KEY (market_id) REFERENCES public.markets(id)
);

CREATE INDEX IF NOT EXISTS idx_metric_workers_last_seen
  ON public.metric_workers (last_seen_at DESC);

ALTER TABLE public.metric_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage workers"
  ON public.metric_workers
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
