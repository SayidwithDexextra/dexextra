-- Migration: Add Facebook URL to user profiles
-- Description: Adds facebook_url column and exposes it via public_user_profiles view.

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS facebook_url TEXT;

-- Add check constraint for URL validation (idempotent)
DO $$
BEGIN
  ALTER TABLE user_profiles
  ADD CONSTRAINT check_facebook_url CHECK (is_valid_url(facebook_url));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Update public view to include facebook_url
-- NOTE: We DROP+CREATE because CREATE OR REPLACE VIEW cannot insert a column
-- in the middle of the existing view's column list without causing column rename errors.
DROP VIEW IF EXISTS public_user_profiles;

CREATE VIEW public_user_profiles AS
SELECT
  id,
  wallet_address,
  username,
  display_name,
  bio,
  website,
  twitter_url,
  discord_url,
  instagram_url,
  youtube_url,
  profile_image_url,
  banner_image_url,
  facebook_url,
  created_at,
  updated_at
FROM user_profiles
WHERE is_active = true;

-- Ensure privileges remain in place (safe to re-run)
GRANT SELECT ON public_user_profiles TO authenticated, anon;

COMMENT ON COLUMN user_profiles.facebook_url IS 'Facebook profile/page URL';

