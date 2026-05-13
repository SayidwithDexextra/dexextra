-- Platform-wide notifications + per-wallet read state.
--
-- Two-table design:
--   public.notifications      → durable announcement rows authored by admins.
--                               Public read, service-role write. Wired into the
--                               `supabase_realtime` publication so every open
--                               browser sees new rows immediately, even if the
--                               Pusher fan-out below misses.
--   public.notification_reads → per-wallet read receipts. Lets the bell badge
--                               and the panel render "unread" state correctly
--                               for each user, including users who come back
--                               days after the notification was published.
--
-- Delivery is belt-and-braces: the publish endpoint inserts a row AND triggers
-- a Pusher event on the public `platform-notifications` channel. Pusher wins
-- on latency (toasts feel instant), Supabase Realtime wins on durability
-- (clients that reconnect/refresh still pick the row up).

CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'announcement',
  -- 'info' | 'success' | 'warning' | 'critical' — drives panel/toast styling.
  severity      text NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  cta_label     text NULL CHECK (cta_label IS NULL OR char_length(cta_label) <= 40),
  cta_href      text NULL CHECK (cta_href IS NULL OR char_length(cta_href) <= 500),
  -- Free-form audience selector. v1 only supports {"scope":"all"} but we keep
  -- this jsonb so future cohort/geo/role filters don't need a migration.
  audience      jsonb NOT NULL DEFAULT '{"scope":"all"}'::jsonb,
  published_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NULL,
  -- Audit. Either the admin display name from the publish payload, or
  -- 'admin-api' / 'admin-script' when no display name was supplied.
  created_by    text NOT NULL DEFAULT 'admin-api',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- We deliberately do not use a partial index filtered on `now()` here —
-- Postgres rejects non-IMMUTABLE functions in index predicates. The feed
-- query (`/api/notifications`) filters by expires_at at runtime, which
-- combines fine with this regular DESC index.
CREATE INDEX IF NOT EXISTS idx_notifications_published_at
  ON public.notifications (published_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  -- Wallets are normalized to lowercase everywhere in this codebase
  -- (see src/lib/userProfileService.ts). Enforce it at the DB layer too.
  wallet_address   text NOT NULL CHECK (wallet_address = lower(wallet_address)),
  notification_id  uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_wallet
  ON public.notification_reads (wallet_address);

-- Covering index for the FK to public.notifications(id). The primary key
-- leads with wallet_address, so without this index the ON DELETE CASCADE
-- from `notifications` would seq-scan `notification_reads` for every
-- deleted notification.
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification_id
  ON public.notification_reads (notification_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- notifications: world-readable (the bell needs to render for anon visitors
-- the moment they land on the page), service-role-only writes.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications public read" ON public.notifications;
CREATE POLICY "notifications public read"
  ON public.notifications
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- notification_reads: never exposed directly. All writes go through the
-- API which uses the service-role client and scopes by wallet. We keep
-- RLS enabled with NO permissive policy so anon/authenticated cannot
-- read or write directly, even if someone accidentally ships the anon
-- key with broader privileges later.
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- ── Realtime publication ─────────────────────────────────────────────────
-- Same idempotent DO-block we use for site_settings: every browser that
-- has a Supabase channel open on `notifications` gets the INSERT instantly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;
