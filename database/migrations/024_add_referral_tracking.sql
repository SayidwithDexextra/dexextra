-- =============================================
-- Migration: 024_add_referral_tracking.sql
-- Phase 2 of the growth system: referral tracking.
-- Adds referral columns to user_profiles, a unique
-- referral code per user, and an atomic track_referral()
-- function that records who referred whom.
-- =============================================

-- 1. Add referral columns (idempotent).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS referred_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS referral_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_volume_usd DECIMAL(20,2) DEFAULT 0;

-- 2. Backfill a unique 8-char hex code for any existing rows that lack one.
--    gen_random_bytes(4) -> 4 bytes -> 8 hex characters (matches client-side
--    `refCode.length === 8` validation).
UPDATE user_profiles
SET referral_code = encode(gen_random_bytes(4), 'hex')
WHERE referral_code IS NULL;

-- 3. New rows get a code automatically.
ALTER TABLE user_profiles
  ALTER COLUMN referral_code SET DEFAULT encode(gen_random_bytes(4), 'hex');

-- 4. Enforce uniqueness on referral_code and the FK on referred_by.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_referral_code_key'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_referral_code_key UNIQUE (referral_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_referred_by_fkey'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_referred_by_fkey
      FOREIGN KEY (referred_by) REFERENCES user_profiles(wallet_address)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Indexes for lookups.
CREATE INDEX IF NOT EXISTS idx_user_profiles_referral_code ON user_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by ON user_profiles(referred_by);

-- 6. Atomic referral tracking function.
--    Validates the code, prevents self-referral and double-referral,
--    auto-creates the referred user's profile if it does not exist yet,
--    and increments the referrer's referral_count in a single transaction.
--    Returns a JSON status object instead of raising, so the API can map
--    outcomes to friendly responses.
CREATE OR REPLACE FUNCTION track_referral(
  p_wallet_address TEXT,
  p_referral_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet   TEXT := lower(p_wallet_address);
  v_code     TEXT := lower(p_referral_code);
  v_referrer user_profiles;
  v_user     user_profiles;
BEGIN
  -- Resolve referrer by code.
  SELECT * INTO v_referrer
  FROM user_profiles
  WHERE lower(referral_code) = v_code
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  -- Prevent self-referral.
  IF lower(v_referrer.wallet_address) = v_wallet THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_referral');
  END IF;

  -- Ensure the referred user has a profile row (create a minimal one if not).
  SELECT * INTO v_user FROM user_profiles WHERE wallet_address = v_wallet;
  IF NOT FOUND THEN
    INSERT INTO user_profiles (wallet_address)
    VALUES (v_wallet)
    RETURNING * INTO v_user;
  END IF;

  -- A user can only ever be referred once.
  IF v_user.referred_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_referred');
  END IF;

  -- Record the referral on the referred user.
  UPDATE user_profiles
  SET referred_by = v_referrer.wallet_address,
      referred_at = NOW()
  WHERE wallet_address = v_wallet;

  -- Credit the referrer.
  UPDATE user_profiles
  SET referral_count = COALESCE(referral_count, 0) + 1
  WHERE wallet_address = v_referrer.wallet_address;

  RETURN jsonb_build_object(
    'success', true,
    'referrer', v_referrer.wallet_address,
    'referral_code', v_referrer.referral_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION track_referral(TEXT, TEXT) TO authenticated, anon, service_role;

-- Documentation.
COMMENT ON COLUMN user_profiles.referral_code IS 'Unique 8-char hex code this user shares to refer others.';
COMMENT ON COLUMN user_profiles.referred_by IS 'wallet_address of the user who referred this user (set once).';
COMMENT ON COLUMN user_profiles.referred_at IS 'Timestamp when the referral relationship was recorded.';
COMMENT ON COLUMN user_profiles.referral_count IS 'Number of users this user has successfully referred.';
COMMENT ON COLUMN user_profiles.referral_volume_usd IS 'Cumulative USD trading volume attributed to referred users.';
COMMENT ON FUNCTION track_referral(TEXT, TEXT) IS 'Atomically records a referral relationship; returns a JSON status object.';
