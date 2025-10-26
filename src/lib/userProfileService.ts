// User Profile Service - handles all user profile database operations

import { supabase } from './supabase';
import { supabaseAdmin } from './supabase-admin';
import type { 
  UserProfile, 
  PublicUserProfile, 
  CreateUserProfileRequest, 
  UpdateUserProfileRequest, 
  UserProfileSearchResult 
} from '../types/userProfile';

export class UserProfileService {
  
  // Use service-role client on the server, anon client on the client
  private static get db() {
    const isServer = typeof window === 'undefined';
    return isServer ? supabaseAdmin : supabase;
  }
  
  /**
   * Get user profile by wallet address
   */
  static async getProfile(walletAddress: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await this.db
        .from('user_profiles')
        .select('*')
        .eq('wallet_address', walletAddress)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }

  /**
   * Get public profile by wallet address (excludes sensitive info)
   */
  static async getPublicProfile(walletAddress: string): Promise<PublicUserProfile | null> {
    try {
      const { data, error } = await this.db
        .from('public_user_profiles')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching public user profile:', error);
      throw error;
    }
  }

  /**
   * Create or get user profile (uses database function)
   */
  static async getOrCreateProfile(
    walletAddress: string, 
    username?: string, 
    displayName?: string
  ): Promise<UserProfile> {
    try {
      const { data, error } = await this.db
        .rpc('get_or_create_user_profile', {
          p_wallet_address: walletAddress,
          p_username: username,
          p_display_name: displayName
        });

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error creating/getting user profile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(
    walletAddress: string, 
    updates: UpdateUserProfileRequest
  ): Promise<UserProfile> {
    try {
      // First validate the username format if it's being updated
      if (updates.username) {
        const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
        if (!usernameRegex.test(updates.username)) {
          throw new Error('Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens');
        }
        if (updates.username.startsWith('0x')) {
          throw new Error('Username cannot start with 0x');
        }
      }

      const { data, error } = await this.db
        .from('user_profiles')
        .update(updates)
        .eq('wallet_address', walletAddress)
        .select()
        .single();

      if (error) {
        // Handle specific database errors
        if (error.code === '23505') { // Unique violation
          throw new Error('Username is already taken');
        }
        if (error.code === '42501') { // RLS violation
          throw new Error('You can only update your own profile');
        }
        throw new Error(`Database error: ${error.message}`);
      }

      if (!data) {
        throw new Error('Profile not found');
      }

      return data;
    } catch (error) {
      console.error('Error updating user profile:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to update profile');
    }
  }

  /**
   * Check if username is available
   */
  static async isUsernameAvailable(username: string, excludeWalletAddress?: string): Promise<boolean> {
    try {
      let query = this.db
        .from('user_profiles')
        .select('username')
        .eq('username', username)
        .eq('is_active', true);

      if (excludeWalletAddress) {
        query = query.neq('wallet_address', excludeWalletAddress);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data.length === 0;
    } catch (error) {
      console.error('Error checking username availability:', error);
      throw error;
    }
  }

  /**
   * Search user profiles
   */
  static async searchProfiles(searchTerm: string): Promise<UserProfileSearchResult[]> {
    try {
      const { data, error } = await this.db
        .rpc('search_user_profiles', { search_term: searchTerm });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error searching user profiles:', error);
      throw error;
    }
  }

  /**
   * Soft delete user profile (set is_active = false)
   */
  static async deactivateProfile(walletAddress: string): Promise<void> {
    try {
      const { error } = await this.db
        .from('user_profiles')
        .update({ is_active: false })
        .eq('wallet_address', walletAddress);

      if (error) throw error;
    } catch (error) {
      console.error('Error deactivating user profile:', error);
      throw error;
    }
  }

  /**
   * Get profile by username
   */
  static async getProfileByUsername(username: string): Promise<PublicUserProfile | null> {
    try {
      const { data, error } = await this.db
        .from('public_user_profiles')
        .select('*')
        .eq('username', username)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching profile by username:', error);
      throw error;
    }
  }

  /**
   * Get recent profiles (for discovery/browsing)
   */
  static async getRecentProfiles(limit: number = 20): Promise<PublicUserProfile[]> {
    try {
      const { data, error } = await this.db
        .from('public_user_profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching recent profiles:', error);
      throw error;
    }
  }

  /**
   * Upload profile image to Supabase Storage and update profile
   */
  static async uploadProfileImage(
    walletAddress: string, 
    file: File, 
    type: 'profile' | 'banner' = 'profile'
  ): Promise<string> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${walletAddress}/${type}_${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await this.db.storage
        .from('profile-images')
        .upload(fileName, file, {
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = this.db.storage
        .from('profile-images')
        .getPublicUrl(fileName);

      // Update the profile with the new image URL
      const updateField = type === 'profile' ? 'profile_image_url' : 'banner_image_url';
      await this.updateProfile(walletAddress, { [updateField]: publicUrl });

      return publicUrl;
    } catch (error) {
      console.error('Error uploading profile image:', error);
      throw error;
    }
  }

  /**
   * Update email notification preferences
   */
  static async updateEmailNotifications(
    walletAddress: string, 
    enabled: boolean
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ email_notifications_enabled: enabled })
        .eq('wallet_address', walletAddress);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating email notification preferences:', error);
      throw error;
    }
  }
} 