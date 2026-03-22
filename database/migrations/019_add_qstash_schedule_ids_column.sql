-- Add dedicated column for QStash lifecycle message IDs.
-- Stores the message IDs returned by QStash so they can be tracked and cancelled.
-- Shape: { "rollover": "msg_...", "settlement": "msg_...", "finalize": "msg_...", "deferred": ["msg_..."] }

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS qstash_schedule_ids jsonb DEFAULT NULL;

COMMENT ON COLUMN public.markets.qstash_schedule_ids
  IS 'QStash message IDs for lifecycle triggers (rollover, settlement, finalize, deferred). Used to cancel/track pending lifecycle events.';
