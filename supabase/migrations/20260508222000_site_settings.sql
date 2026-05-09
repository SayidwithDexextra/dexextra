-- Global site-wide key/value settings.
--
-- The first concrete use case is a one-shot "coming soon" gate: when any user
-- enters the right access code, the gate is dismissed for EVERYONE forever
-- by flipping a single flag here. The gate UI watches this row via the
-- supabase-js realtime channel so every open browser unlocks instantly.

CREATE TABLE IF NOT EXISTS public.site_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.site_settings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_settings_touch_updated_at ON public.site_settings;
CREATE TRIGGER site_settings_touch_updated_at
BEFORE UPDATE ON public.site_settings
FOR EACH ROW
EXECUTE FUNCTION public.site_settings_touch_updated_at();

-- Public, read-only by default. Only service_role can write.
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_settings public read" ON public.site_settings;
CREATE POLICY "site_settings public read"
  ON public.site_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed the coming-soon flag (idempotent).
INSERT INTO public.site_settings (key, value)
VALUES ('coming_soon_unlocked', jsonb_build_object('unlocked', false, 'unlocked_at', null))
ON CONFLICT (key) DO NOTHING;

-- Make sure the row is broadcast over Supabase Realtime so every browser
-- gets the unlock the moment one user enters the code.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'site_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings';
  END IF;
END $$;
