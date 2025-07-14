// Client-side service for interacting with user profile API

import type { UserProfile } from '@/types/wallet';

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
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
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
  static async getProfile(walletAddress: string): Promise<UserProfile | null> {
    try {
      const response = await fetch(`/api/profile?wallet=${encodeURIComponent(walletAddress)}`);
      
      if (response.status === 404) {
        return null; // Profile doesn't exist
      }

      const result: ApiResponse<UserProfile> = await response.json();

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
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          ...updates,
        }),
      });

      const result: ApiResponse<UserProfile> = await response.json();

      if (!response.ok || !result.success) {
        // Enhanced error message with more context
        let errorMessage = result.error || 'Failed to update profile';
        
        // Add status code for debugging
        if (response.status !== 200) {
          errorMessage += ` (HTTP ${response.status})`;
        }
        
        // Add validation details if available
        if (result.details && Array.isArray(result.details)) {
          const validationErrors = result.details.map((detail: any) => 
            `${detail.path?.join('.') || 'field'}: ${detail.message}`
          ).join(', ');
          errorMessage += ` - Validation errors: ${validationErrors}`;
        }
        
        throw new Error(errorMessage);
      }

      if (!result.data) {
        throw new Error('No profile data returned');
      }

      return result.data;
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
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
      const response = await fetch(
        `/api/profile?wallet=${encodeURIComponent(walletAddress)}`,
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

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('wallet_address', walletAddress);
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
      const response = await fetch(
        `/api/profile/upload?wallet_address=${encodeURIComponent(walletAddress)}&type=${type}`,
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