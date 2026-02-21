// Client-side service for interacting with user profile API

import type { PublicUserProfile, UserProfile } from '@/types/userProfile';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  details?: any;
}

export class ProfileApi {
  
  /**
   * Create or get user profile for wallet connection
   */
  static async createOrGetProfile(
    walletAddress: string,
    username?: string,
    displayName?: string
  ): Promise<UserProfile> {
    try {
      // Normalize wallet address to lowercase to prevent case-sensitivity duplicates
      const normalizedAddress = walletAddress.toLowerCase();
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: normalizedAddress,
          username,
          display_name: displayName,
        }),
      });

      const result: ApiResponse<UserProfile> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create/get profile');
      }

      if (!result.data) {
        throw new Error('No profile data returned');
      }

      return result.data;
    } catch (error) {
      console.error('Error creating/getting profile:', error);
      throw error;
    }
  }

  /**
   * Get user profile by wallet address
   */
  static async getProfile(walletAddress: string): Promise<PublicUserProfile | null> {
    try {
      // Normalize wallet address to lowercase to prevent case-sensitivity issues
      const normalizedAddress = walletAddress.toLowerCase();
      const response = await fetch(`/api/profile?wallet=${encodeURIComponent(normalizedAddress)}`);
      
      if (response.status === 404) {
        return null; // Profile doesn't exist
      }

      const result: ApiResponse<PublicUserProfile> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to fetch profile');
      }

      return result.data || null;
    } catch (error) {
      console.error('Error fetching profile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(
    walletAddress: string,
    updates: Partial<UserProfile>
  ): Promise<UserProfile> {
    try {
      // Client-side validation
      if (updates.username) {
        const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
        if (!usernameRegex.test(updates.username)) {
          throw new Error('Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens');
        }
        if (updates.username.startsWith('0x')) {
          throw new Error('Username cannot start with 0x');
        }
      }

      // Normalize wallet address to lowercase to prevent case-sensitivity issues
      const normalizedAddress = walletAddress.toLowerCase();
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: normalizedAddress,
          ...updates,
        }),
      });

      let result: ApiResponse<UserProfile>;
      try {
        result = await response.json();
      } catch (e) {
        throw new Error(`Failed to parse server response: ${e.message}`);
      }

      if (!response.ok || !result.success) {
        let errorMessage = '';
        
        // Handle specific error cases
        if (response.status === 401 || response.status === 403) {
          errorMessage = 'You are not authorized to update this profile. Please reconnect your wallet.';
        } else if (response.status === 409) {
          errorMessage = 'Username is already taken. Please choose another one.';
        } else if (response.status === 400) {
          // Handle validation errors
          if (result.details && Array.isArray(result.details)) {
            const validationErrors = result.details
              .map((detail: any) => `${detail.path?.join('.') || 'field'}: ${detail.message}`)
              .join(', ');
            errorMessage = `Invalid input - ${validationErrors}`;
          } else {
            errorMessage = result.error || 'Invalid input data';
          }
        } else {
          errorMessage = result.error || `Failed to update profile (HTTP ${response.status})`;
        }
        
        throw new Error(errorMessage);
      }

      if (!result.data) {
        throw new Error('No profile data returned from server');
      }

      return result.data;
    } catch (error) {
      console.error('Error updating profile:', error);
      // Ensure we always throw an Error object with a message
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('An unexpected error occurred while updating profile');
    }
  }

  /**
   * Search user profiles
   */
  static async searchProfiles(
    searchTerm: string,
    limit: number = 20
  ): Promise<UserProfile[]> {
    try {
      const response = await fetch(
        `/api/profile/search?q=${encodeURIComponent(searchTerm)}&limit=${limit}`
      );

      const result: ApiResponse<UserProfile[]> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Search failed');
      }

      return result.data || [];
    } catch (error) {
      console.error('Error searching profiles:', error);
      throw error;
    }
  }

  /**
   * Deactivate user profile
   */
  static async deactivateProfile(walletAddress: string): Promise<void> {
    try {
      // Normalize wallet address to lowercase
      const normalizedAddress = walletAddress.toLowerCase();
      const response = await fetch(
        `/api/profile?wallet=${encodeURIComponent(normalizedAddress)}`,
        {
          method: 'DELETE',
        }
      );

      const result: ApiResponse<void> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to deactivate profile');
      }
    } catch (error) {
      console.error('Error deactivating profile:', error);
      throw error;
    }
  }

  /**
   * Upload profile or banner image
   */
  static async uploadImage(
    walletAddress: string,
    file: File,
    type: 'profile' | 'banner' = 'profile'
  ): Promise<{ imageUrl: string; profile: UserProfile }> {
    try {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.');
      }

      // Validate file size (10MB limit)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        throw new Error('File too large. Maximum size is 10MB.');
      }

      // Normalize wallet address to lowercase
      const normalizedAddress = walletAddress.toLowerCase();

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('wallet_address', normalizedAddress);
      formData.append('type', type);

      const response = await fetch('/api/profile/upload', {
        method: 'POST',
        body: formData,
      });

      const result: ApiResponse<{ imageUrl: string; profile: UserProfile }> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to upload image');
      }

      if (!result.data) {
        throw new Error('No upload data returned');
      }

      return result.data;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  }

  /**
   * Remove profile or banner image
   */
  static async removeImage(
    walletAddress: string,
    type: 'profile' | 'banner' = 'profile'
  ): Promise<UserProfile> {
    try {
      // Normalize wallet address to lowercase
      const normalizedAddress = walletAddress.toLowerCase();
      const response = await fetch(
        `/api/profile/upload?wallet_address=${encodeURIComponent(normalizedAddress)}&type=${type}`,
        {
          method: 'DELETE',
        }
      );

      const result: ApiResponse<UserProfile> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to remove image');
      }

      if (!result.data) {
        throw new Error('No profile data returned');
      }

      return result.data;
    } catch (error) {
      console.error('Error removing image:', error);
      throw error;
    }
  }
} 