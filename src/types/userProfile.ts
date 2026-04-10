// User Profile Types - matches database schema from 002_create_user_profiles.sql

export const DEFAULT_PROFILE_IMAGE = '/GenericDexeteraUser. .jpg';

export interface AnalyticsPrivacySettings {
  hide_portfolio_value: boolean;
  hide_pnl: boolean;
  hide_trade_history: boolean;
  hide_from_public: boolean;
}

export const DEFAULT_ANALYTICS_PRIVACY: AnalyticsPrivacySettings = {
  hide_portfolio_value: false,
  hide_pnl: false,
  hide_trade_history: false,
  hide_from_public: false,
};

export interface UserProfile {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  bio?: string;
  email?: string;
  website?: string;
  twitter_url?: string;
  discord_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  facebook_url?: string;
  profile_image_url?: string;
  banner_image_url?: string;
  email_notifications_enabled: boolean;
  is_active: boolean;
  analytics_privacy?: AnalyticsPrivacySettings;
  created_at: string;
  updated_at: string;
}

export interface PublicUserProfile {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  bio?: string;
  website?: string;
  twitter_url?: string;
  discord_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  facebook_url?: string;
  profile_image_url?: string;
  banner_image_url?: string;
  analytics_privacy?: AnalyticsPrivacySettings;
  created_at: string;
  updated_at: string;
}

export interface UserProfileFormData {
  username: string;
  name: string; // maps to display_name
  bio: string;
  email: string;
  website: string;
  twitter: string; // maps to twitter_url
  discord: string; // maps to discord_url
  instagram: string; // maps to instagram_url
  youtube: string; // maps to youtube_url
  facebook: string; // maps to facebook_url
}

export interface CreateUserProfileRequest {
  wallet_address: string;
  username?: string;
  display_name?: string;
}

export interface UpdateUserProfileRequest {
  username?: string;
  display_name?: string;
  bio?: string;
  email?: string;
  website?: string;
  twitter_url?: string;
  discord_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  facebook_url?: string;
  profile_image_url?: string;
  banner_image_url?: string;
  email_notifications_enabled?: boolean;
  analytics_privacy?: AnalyticsPrivacySettings;
}

export interface UserProfileSearchResult {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  bio?: string;
  profile_image_url?: string;
  created_at: string;
}

// Helper function to convert form data to database format
export function formDataToUserProfile(
  formData: UserProfileFormData,
  walletAddress: string,
  profileImageUrl?: string,
  bannerImageUrl?: string
): UpdateUserProfileRequest {
  return {
    username: formData.username || undefined,
    display_name: formData.name || undefined,
    bio: formData.bio || undefined,
    email: formData.email || undefined,
    website: formData.website || undefined,
    twitter_url: formData.twitter || undefined,
    discord_url: formData.discord || undefined,
    instagram_url: formData.instagram || undefined,
    youtube_url: formData.youtube || undefined,
    facebook_url: formData.facebook || undefined,
    profile_image_url: profileImageUrl,
    banner_image_url: bannerImageUrl,
  };
}

/**
 * Ensures profile_image_url falls back to the generic Dexetera avatar
 * when no custom image has been set.
 */
export function withDefaultProfileImage<T extends { profile_image_url?: string }>(profile: T): T {
  if (!profile.profile_image_url) {
    return { ...profile, profile_image_url: DEFAULT_PROFILE_IMAGE };
  }
  return profile;
}

// Helper function to convert user profile to form data
export function userProfileToFormData(profile: UserProfile): UserProfileFormData {
  return {
    username: profile.username || '',
    name: profile.display_name || '',
    bio: profile.bio || '',
    email: profile.email || '',
    website: profile.website || '',
    twitter: profile.twitter_url || '',
    discord: profile.discord_url || '',
    instagram: profile.instagram_url || '',
    youtube: profile.youtube_url || '',
    facebook: profile.facebook_url || '',
  };
} 