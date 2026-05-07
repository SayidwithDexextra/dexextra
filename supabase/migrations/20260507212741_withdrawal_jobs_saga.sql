-- Withdrawal saga: persistent state for cross-chain withdrawals.
--
-- Models the three-step flow (CollateralHub.requestWithdraw → HubBridgeOutbox.sendWithdraw
-- → SpokeBridgeInbox.receiveMessage) so we can recover from any failure
-- between hub debit and spoke delivery via the withdrawal-retry-worker
-- Edge Function (cron'd every minute).

-- ─────── Enum ───────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_job_status') THEN
    CREATE TYPE public.withdrawal_job_status AS ENUM (
      'pending',
      'hub_debiting',
      'hub_debited',
      'hub_sending',
      'hub_sent',
      'spoke_pending',
      'spoke_delivering',
      'completed',
      'hub_debit_failed',
      'outbox_failed',
      'spoke_failed',
      'requires_manual'
    );
  END IF;
END $$;

-- ─────── Table ───────
CREATE TABLE IF NOT EXISTS public.withdrawal_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address        text NOT NULL,
  target_chain_id     integer NOT NULL,
  amount_wei          numeric(78,0) NOT NULL,
  amount_human        text NOT NULL,
  spoke_token         text,
  status              public.withdrawal_job_status NOT NULL DEFAULT 'pending',
  withdraw_id         text,
  hub_request_tx      text,
  hub_request_block   bigint,
  hub_send_tx         text,
  hub_send_block      bigint,
  spoke_deliver_tx    text,
  spoke_deliver_block bigint,
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 8,
  earliest_run_at     timestamptz NOT NULL DEFAULT now(),
  last_error          text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT withdrawal_jobs_amount_pos CHECK (amount_wei > 0),
  CONSTRAINT withdrawal_jobs_target_chain CHECK (target_chain_id IN (137, 42161))
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_jobs_withdraw_id_uniq
  ON public.withdrawal_jobs (withdraw_id)
  WHERE withdraw_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS withdrawal_jobs_status_run_idx
  ON public.withdrawal_jobs (status, earliest_run_at)
  WHERE status NOT IN ('completed','requires_manual','hub_debit_failed');

CREATE INDEX IF NOT EXISTS withdrawal_jobs_user_idx
  ON public.withdrawal_jobs (lower(user_address), created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_jobs_created_idx
  ON public.withdrawal_jobs (created_at DESC);

CREATE OR REPLACE FUNCTION public.withdrawal_jobs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS withdrawal_jobs_touch ON public.withdrawal_jobs;
CREATE TRIGGER withdrawal_jobs_touch
BEFORE UPDATE ON public.withdrawal_jobs
FOR EACH ROW EXECUTE FUNCTION public.withdrawal_jobs_set_updated_at();

ALTER TABLE public.withdrawal_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS withdrawal_jobs_block_anon ON public.withdrawal_jobs;
CREATE POLICY withdrawal_jobs_block_anon
  ON public.withdrawal_jobs FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS withdrawal_jobs_block_authenticated ON public.withdrawal_jobs;
CREATE POLICY withdrawal_jobs_block_authenticated
  ON public.withdrawal_jobs FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.withdrawal_jobs IS
  'Persistent saga state for cross-chain withdrawals. Tracks every withdrawal from hub debit through spoke delivery so failures between steps can be reconciled by the retry worker. Service-role only.';

-- ─────── RPC: create_withdrawal_job ───────
CREATE OR REPLACE FUNCTION public.create_withdrawal_job(
  p_user text,
  p_target_chain_id integer,
  p_amount_wei numeric,
  p_amount_human text,
  p_spoke_token text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_max_attempts integer DEFAULT 8
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.withdrawal_jobs (
    user_address, target_chain_id, amount_wei, amount_human, spoke_token,
    status, max_attempts, metadata
  ) VALUES (
    lower(p_user), p_target_chain_id, p_amount_wei, p_amount_human,
    CASE WHEN p_spoke_token IS NULL THEN NULL ELSE lower(p_spoke_token) END,
    'pending', GREATEST(p_max_attempts, 1), COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_withdrawal_job(text, integer, numeric, text, text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_withdrawal_job(text, integer, numeric, text, text, jsonb, integer) FROM anon, authenticated;

-- ─────── RPC: mark_withdrawal_step ───────
CREATE OR REPLACE FUNCTION public.mark_withdrawal_step(
  p_id uuid,
  p_to_status public.withdrawal_job_status,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS public.withdrawal_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.withdrawal_jobs;
BEGIN
  UPDATE public.withdrawal_jobs
     SET status = p_to_status,
         withdraw_id          = COALESCE(p_patch->>'withdraw_id',          withdraw_id),
         hub_request_tx       = COALESCE(p_patch->>'hub_request_tx',       hub_request_tx),
         hub_request_block    = COALESCE((p_patch->>'hub_request_block')::bigint, hub_request_block),
         hub_send_tx          = COALESCE(p_patch->>'hub_send_tx',          hub_send_tx),
         hub_send_block       = COALESCE((p_patch->>'hub_send_block')::bigint, hub_send_block),
         spoke_deliver_tx     = COALESCE(p_patch->>'spoke_deliver_tx',     spoke_deliver_tx),
         spoke_deliver_block  = COALESCE((p_patch->>'spoke_deliver_block')::bigint, spoke_deliver_block),
         last_error           = NULLIF(p_patch->>'last_error',''),
         completed_at         = CASE WHEN p_to_status = 'completed' THEN now() ELSE completed_at END,
         metadata             = metadata || COALESCE(p_patch->'metadata','{}'::jsonb)
   WHERE id = p_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_withdrawal_step(uuid, public.withdrawal_job_status, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_withdrawal_step(uuid, public.withdrawal_job_status, jsonb) FROM anon, authenticated;

-- ─────── RPC: fail_or_requeue_withdrawal_job ───────
CREATE OR REPLACE FUNCTION public.fail_or_requeue_withdrawal_job(
  p_id uuid,
  p_error text,
  p_requeue_to public.withdrawal_job_status,
  p_backoff_seconds integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_max integer;
BEGIN
  UPDATE public.withdrawal_jobs
     SET attempts = attempts + 1,
         last_error = left(coalesce(p_error,''), 1000),
         earliest_run_at = now() + make_interval(secs => GREATEST(p_backoff_seconds, 1))
   WHERE id = p_id
   RETURNING attempts, max_attempts INTO v_attempts, v_max;

  IF v_attempts IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_attempts >= v_max THEN
    UPDATE public.withdrawal_jobs SET status = 'requires_manual' WHERE id = p_id;
    RETURN 'requires_manual';
  ELSE
    UPDATE public.withdrawal_jobs SET status = p_requeue_to WHERE id = p_id;
    RETURN 'requeued';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_or_requeue_withdrawal_job(uuid, text, public.withdrawal_job_status, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_or_requeue_withdrawal_job(uuid, text, public.withdrawal_job_status, integer) FROM anon, authenticated;

-- ─────── RPC: claim_withdrawal_jobs ───────
CREATE OR REPLACE FUNCTION public.claim_withdrawal_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.withdrawal_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id
      FROM public.withdrawal_jobs
     WHERE status IN ('outbox_failed','hub_sent','spoke_pending','spoke_failed')
       AND earliest_run_at <= now()
     ORDER BY earliest_run_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(p_limit, 1)
  ) s;

  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    UPDATE public.withdrawal_jobs
       SET status = CASE
         WHEN status = 'outbox_failed' THEN 'hub_sending'::public.withdrawal_job_status
         WHEN status = 'hub_sent'       THEN 'spoke_delivering'::public.withdrawal_job_status
         WHEN status = 'spoke_failed'   THEN 'spoke_delivering'::public.withdrawal_job_status
         WHEN status = 'spoke_pending'  THEN 'spoke_delivering'::public.withdrawal_job_status
         ELSE status
       END,
         earliest_run_at = now() + interval '90 seconds'
     WHERE id = ANY(v_ids)
     RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_withdrawal_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_withdrawal_jobs(integer) FROM anon, authenticated;

-- ─────── RPC: complete_withdrawal_job ───────
CREATE OR REPLACE FUNCTION public.complete_withdrawal_job(
  p_id uuid,
  p_spoke_deliver_tx text DEFAULT NULL,
  p_spoke_deliver_block bigint DEFAULT NULL
)
RETURNS public.withdrawal_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.withdrawal_jobs;
BEGIN
  UPDATE public.withdrawal_jobs
     SET status = 'completed',
         spoke_deliver_tx = COALESCE(p_spoke_deliver_tx, spoke_deliver_tx),
         spoke_deliver_block = COALESCE(p_spoke_deliver_block, spoke_deliver_block),
         completed_at = now(),
         last_error = NULL
   WHERE id = p_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_withdrawal_job(uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_withdrawal_job(uuid, text, bigint) FROM anon, authenticated;

-- ─────── pg_cron: schedule retry worker (every minute) and alerter (every 5 min) ───────
-- Vault secret used as the bearer for both functions (set out-of-band):
--   SELECT vault.create_secret('<anon_key>', 'withdrawal_worker_anon_key', 'cron-only');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'withdrawal-retry-worker') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'withdrawal-retry-worker'));
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'withdrawal-alerter') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'withdrawal-alerter'));
  END IF;
END $$;

SELECT cron.schedule(
  'withdrawal-retry-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://khhknmobkkkvvogznxdj.supabase.co/functions/v1/withdrawal-retry-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'withdrawal_worker_anon_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()),
    timeout_milliseconds := 25000
  ) AS request_id;
  $cron$
);

SELECT cron.schedule(
  'withdrawal-alerter',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://khhknmobkkkvvogznxdj.supabase.co/functions/v1/withdrawal-alerter',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'withdrawal_worker_anon_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()),
    timeout_milliseconds := 15000
  ) AS request_id;
  $cron$
);
