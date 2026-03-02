CREATE TABLE IF NOT EXISTS public.metrics (
  value numeric,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  market_id uuid NOT NULL,
  CONSTRAINT metrics_pkey PRIMARY KEY (market_id),
  CONSTRAINT metrics_market_fk FOREIGN KEY (market_id) REFERENCES public.markets(id)
);

ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read metrics"
  ON public.metrics
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage metrics"
  ON public.metrics
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
