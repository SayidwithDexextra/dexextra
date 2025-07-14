-- Migration: Create User Profiles Table
-- Description: Creates a comprehensive user profile system based on Settings.tsx component

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address TEXT NOT NULL UNIQUE,
    username TEXT UNIQUE,
    display_name TEXT,
    bio TEXT CHECK (char_length(bio) <= 180),
    email TEXT,
    website TEXT,
    twitter_url TEXT,
    discord_url TEXT,
    instagram_url TEXT,
    youtube_url TEXT,
    profile_image_url TEXT,
    banner_image_url TEXT,
    email_notifications_enabled BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_wallet_address ON user_profiles(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_created_at ON user_profiles(created_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function to validate URLs
CREATE OR REPLACE FUNCTION is_valid_url(url TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF url IS NULL OR url = '' THEN
        RETURN true;
    END IF;
    
    RETURN url ~* '^https?://[^\s/$.?#].[^\s]*$';
END;
$$ language 'plpgsql';

-- Add check constraints for URL validation
ALTER TABLE user_profiles 
ADD CONSTRAINT check_website_url CHECK (is_valid_url(website)),
ADD CONSTRAINT check_twitter_url CHECK (is_valid_url(twitter_url)),
ADD CONSTRAINT check_discord_url CHECK (is_valid_url(discord_url)),
ADD CONSTRAINT check_instagram_url CHECK (is_valid_url(instagram_url)),
ADD CONSTRAINT check_youtube_url CHECK (is_valid_url(youtube_url)),
ADD CONSTRAINT check_profile_image_url CHECK (is_valid_url(profile_image_url)),
ADD CONSTRAINT check_banner_image_url CHECK (is_valid_url(banner_image_url));

-- Add constraint for email format
ALTER TABLE user_profiles 
ADD CONSTRAINT check_email_format CHECK (
    email IS NULL OR 
    email = '' OR 
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);

-- Add constraint for wallet address format (Ethereum addresses)
ALTER TABLE user_profiles 
ADD CONSTRAINT check_wallet_address_format CHECK (
    wallet_address ~* '^0x[a-fA-F0-9]{40}$'
);

-- Add constraint for username format (alphanumeric, underscore, hyphen)
ALTER TABLE user_profiles 
ADD CONSTRAINT check_username_format CHECK (
    username IS NULL OR 
    username = '' OR 
    (username ~* '^[a-zA-Z0-9_-]{3,30}$' AND username NOT LIKE '0x%')
);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies

-- Policy: Users can view all profiles (for public profile browsing)
CREATE POLICY "Public profiles are viewable by everyone" 
ON user_profiles FOR SELECT 
USING (is_active = true);

-- Policy: Users can only insert their own profile
CREATE POLICY "Users can insert their own profile" 
ON user_profiles FOR INSERT 
WITH CHECK (auth.uid()::text = wallet_address OR auth.role() = 'service_role');

-- Policy: Users can only update their own profile
CREATE POLICY "Users can update their own profile" 
ON user_profiles FOR UPDATE 
USING (auth.uid()::text = wallet_address OR auth.role() = 'service_role')
WITH CHECK (auth.uid()::text = wallet_address OR auth.role() = 'service_role');

-- Policy: Users can only delete their own profile (soft delete by setting is_active = false)
CREATE POLICY "Users can delete their own profile" 
ON user_profiles FOR DELETE 
USING (auth.uid()::text = wallet_address OR auth.role() = 'service_role');

-- Create a view for public profile data (excludes sensitive information)
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
    created_at,
    updated_at
FROM user_profiles 
WHERE is_active = true;

-- Create a function to get or create user profile
CREATE OR REPLACE FUNCTION get_or_create_user_profile(
    p_wallet_address TEXT,
    p_username TEXT DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL
)
RETURNS user_profiles AS $$
DECLARE
    profile_record user_profiles;
BEGIN
    -- Try to get existing profile
    SELECT * INTO profile_record 
    FROM user_profiles 
    WHERE wallet_address = p_wallet_address;
    
    -- If profile doesn't exist, create it
    IF NOT FOUND THEN
        INSERT INTO user_profiles (
            wallet_address, 
            username, 
            display_name
        ) VALUES (
            p_wallet_address, 
            p_username, 
            p_display_name
        ) RETURNING * INTO profile_record;
    END IF;
    
    RETURN profile_record;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Create a function to search users by username or display name
CREATE OR REPLACE FUNCTION search_user_profiles(search_term TEXT)
RETURNS TABLE (
    id UUID,
    wallet_address TEXT,
    username TEXT,
    display_name TEXT,
    bio TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.id,
        up.wallet_address,
        up.username,
        up.display_name,
        up.bio,
        up.profile_image_url,
        up.created_at
    FROM user_profiles up
    WHERE 
        up.is_active = true AND
        (
            up.username ILIKE '%' || search_term || '%' OR
            up.display_name ILIKE '%' || search_term || '%' OR
            up.wallet_address ILIKE '%' || search_term || '%'
        )
    ORDER BY 
        CASE 
            WHEN up.username = search_term THEN 1
            WHEN up.display_name = search_term THEN 2
            WHEN up.wallet_address = search_term THEN 3
            ELSE 4
        END,
        up.created_at DESC
    LIMIT 50;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Grant necessary permissions
GRANT SELECT ON public_user_profiles TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_profiles TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_user_profile(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_user_profiles(TEXT) TO authenticated, anon;

-- Insert sample data (optional - remove if not needed)
INSERT INTO user_profiles (
    wallet_address,
    username,
    display_name,
    bio,
    website,
    twitter_url,
    email_notifications_enabled
) VALUES 
(
    '0x60D4a8b8a9b7f96D7e9c8E5f2796B1a2C3d4E5f6',
    'dex_trader',
    'DeFi Trader',
    'Passionate about decentralized finance and trading. Building the future of finance.',
    'https://example.com',
    'https://twitter.com/dex_trader',
    true
),
(
    '0x742d35Cc6635C0532925a3b8D9B5A7b8C6B9D0e1',
    'crypto_maven',
    'Crypto Maven',
    'Blockchain enthusiast and smart contract developer.',
    'https://cryptomaven.dev',
    'https://twitter.com/crypto_maven',
    false
) ON CONFLICT (wallet_address) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE user_profiles IS 'User profile information linked to wallet addresses';
COMMENT ON COLUMN user_profiles.wallet_address IS 'Ethereum wallet address (primary identifier)';
COMMENT ON COLUMN user_profiles.username IS 'Unique username for the platform';
COMMENT ON COLUMN user_profiles.bio IS 'User biography (max 180 characters)';
COMMENT ON COLUMN user_profiles.email_notifications_enabled IS 'Whether user wants to receive email notifications';
COMMENT ON FUNCTION get_or_create_user_profile(TEXT, TEXT, TEXT) IS 'Gets existing profile or creates new one for wallet address';
COMMENT ON FUNCTION search_user_profiles(TEXT) IS 'Searches user profiles by username, display name, or wallet address'; 