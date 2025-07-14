// User Profile Types - matches database schema from 002_create_user_profiles.sql

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
  profile_image_url?: string;
  banner_image_url?: string;
  email_notifications_enabled: boolean;
  is_active: boolean;
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
  profile_image_url?: string;
  banner_image_url?: string;
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
  profile_image_url?: string;
  banner_image_url?: string;
  email_notifications_enabled?: boolean;
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
    profile_image_url: profileImageUrl,
    banner_image_url: bannerImageUrl,
  };
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
  };
} 