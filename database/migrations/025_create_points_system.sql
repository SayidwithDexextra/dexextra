-- =============================================
-- Migration: 025_create_points_system.sql
-- Phase 3 of the growth system: points.
-- Adds the user_points ledger, an idempotent award_points()
-- function, a get_points_summary() helper (total + rank), and
-- wires the `referral_signup` award into track_referral().
-- =============================================

-- 1. Points ledger. Every awarded action is one immutable row.
CREATE TABLE IF NOT EXISTS user_points (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address TEXT NOT NULL REFERENCES user_profiles(wallet_address) ON DELETE CASCADE,
    action TEXT NOT NULL,
    points INT NOT NULL,
    -- Stable key for one-time awards (e.g. the referred wallet, a market id).
    -- NULL for repeatable actions.
    dedupe_key TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_points_wallet ON user_points(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_points_action ON user_points(action);

-- One-time awards are deduped on (wallet, action, dedupe_key). Repeatable
-- awards (dedupe_key IS NULL) are never blocked by this index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_points_dedupe
    ON user_points(wallet_address, action, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- 2. Idempotent award function. Returns whether a row was actually inserted.
--    Safe to call repeatedly for one-time actions thanks to ON CONFLICT.
CREATE OR REPLACE FUNCTION award_points(
    p_wallet_address TEXT,
    p_action TEXT,
    p_points INT,
    p_metadata JSONB DEFAULT '{}',
    p_dedupe_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet TEXT := lower(p_wallet_address);
    v_inserted_id UUID;
BEGIN
    -- Ensure the wallet has a profile row to satisfy the FK.
    IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE wallet_address = v_wallet) THEN
        INSERT INTO user_profiles (wallet_address) VALUES (v_wallet)
        ON CONFLICT (wallet_address) DO NOTHING;
    END IF;

    INSERT INTO user_points (wallet_address, action, points, dedupe_key, metadata)
    VALUES (v_wallet, p_action, p_points, p_dedupe_key, COALESCE(p_metadata, '{}'::jsonb))
    ON CONFLICT (wallet_address, action, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_inserted_id;

    RETURN jsonb_build_object(
        'awarded', v_inserted_id IS NOT NULL,
        'points', CASE WHEN v_inserted_id IS NOT NULL THEN p_points ELSE 0 END,
        'action', p_action
    );
END;
$$;

GRANT EXECUTE ON FUNCTION award_points(TEXT, TEXT, INT, JSONB, TEXT) TO service_role;

-- 3. Points summary (total + global rank) for a single wallet.
--    Rank is computed only across wallets that have points; a wallet with
--    zero points returns total_points 0 and rank NULL.
CREATE OR REPLACE FUNCTION get_points_summary(p_wallet TEXT)
RETURNS TABLE(total_points BIGINT, rank BIGINT)
LANGUAGE sql
STABLE
AS $$
    WITH totals AS (
        SELECT up.wallet_address,
               SUM(up.points)::BIGINT AS total_points,
               RANK() OVER (ORDER BY SUM(up.points) DESC) AS rank
        FROM user_points up
        JOIN user_profiles p ON p.wallet_address = up.wallet_address
        WHERE p.is_active = true
        GROUP BY up.wallet_address
    )
    SELECT COALESCE(t.total_points, 0)::BIGINT, t.rank
    FROM (SELECT lower(p_wallet) AS wallet_address) q
    LEFT JOIN totals t ON t.wallet_address = q.wallet_address;
$$;

GRANT EXECUTE ON FUNCTION get_points_summary(TEXT) TO authenticated, anon, service_role;

-- 4. Re-create track_referral() so a successful referral also credits the
--    referrer with `referral_signup` points (5), deduped per referred wallet.
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
    SELECT * INTO v_referrer
    FROM user_profiles
    WHERE lower(referral_code) = v_code
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
    END IF;

    IF lower(v_referrer.wallet_address) = v_wallet THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_referral');
    END IF;

    SELECT * INTO v_user FROM user_profiles WHERE wallet_address = v_wallet;
    IF NOT FOUND THEN
        INSERT INTO user_profiles (wallet_address)
        VALUES (v_wallet)
        RETURNING * INTO v_user;
    END IF;

    IF v_user.referred_by IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_referred');
    END IF;

    UPDATE user_profiles
    SET referred_by = v_referrer.wallet_address,
        referred_at = NOW()
    WHERE wallet_address = v_wallet;

    UPDATE user_profiles
    SET referral_count = COALESCE(referral_count, 0) + 1
    WHERE wallet_address = v_referrer.wallet_address;

    -- Credit the referrer with signup points (idempotent per referred wallet).
    PERFORM award_points(
        v_referrer.wallet_address,
        'referral_signup',
        5,
        jsonb_build_object('referred_wallet', v_wallet),
        v_wallet
    );

    RETURN jsonb_build_object(
        'success', true,
        'referrer', v_referrer.wallet_address,
        'referral_code', v_referrer.referral_code
    );
END;
$$;

-- Documentation.
COMMENT ON TABLE user_points IS 'Immutable ledger of points awarded for growth actions.';
COMMENT ON COLUMN user_points.dedupe_key IS 'Stable key for one-time awards (NULL = repeatable). Unique per (wallet, action, dedupe_key).';
COMMENT ON FUNCTION award_points(TEXT, TEXT, INT, JSONB, TEXT) IS 'Idempotently awards points; returns { awarded, points, action }.';
COMMENT ON FUNCTION get_points_summary(TEXT) IS 'Returns total_points and global rank for a wallet (rank NULL if no points).';
