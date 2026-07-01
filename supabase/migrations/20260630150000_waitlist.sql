-- Public waitlist / "Notify me" email collection for the coming-soon gate.
--
-- The coming-soon wrapper shows a world.xyz-style "Coming soon" page to the
-- public. Visitors can drop their email to be notified at launch; those rows
-- land here. Writes happen exclusively through the /api/waitlist route using
-- the service-role key (so we can capture IP/UA and dedupe server-side), so
-- no anon INSERT policy is granted.

CREATE TABLE IF NOT EXISTS public.waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  source      text,
  ip          text,
  user_agent  text,
  referrer    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness so "Foo@bar.com" and "foo@bar.com" collapse.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique
  ON public.waitlist (lower(email));

CREATE INDEX IF NOT EXISTS waitlist_created_at_idx
  ON public.waitlist (created_at DESC);

-- Locked down by default: only the service role (via the API route) can read
-- or write. RLS is enabled with no anon/authenticated policies.
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
