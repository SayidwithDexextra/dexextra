# User Profile System Setup

This document explains how to set up and use the user profile system that integrates with your Settings.tsx component.

## Files Created

1. **`database/migrations/002_create_user_profiles.sql`** - Complete SQL migration
2. **`src/types/userProfile.ts`** - TypeScript interfaces
3. **`src/lib/userProfileService.ts`** - Service layer for database operations

## Database Setup

### 1. Run the SQL Migration

Execute the SQL script in your Supabase dashboard:

```sql
-- Copy the contents of database/migrations/002_create_user_profiles.sql
-- and run it in your Supabase SQL editor
```

### 2. Set up Storage Bucket for Image Uploads

Execute the following SQL commands in your Supabase SQL editor to set up image storage:

```sql
-- Create storage bucket for profile images
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public uploads to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public access to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates to profile-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes to profile-images" ON storage.objects;

-- Create permissive policies for profile-images bucket
-- Note: These policies allow public access since we're using anon key
-- In production, you might want to restrict based on authenticated users

-- Allow anyone to view/download images from profile-images bucket
CREATE POLICY "Allow public access to profile-images" ON storage.objects
FOR SELECT USING (bucket_id = 'profile-images');

-- Allow anyone to upload to profile-images bucket
CREATE POLICY "Allow public uploads to profile-images" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'profile-images');

-- Allow anyone to update files in profile-images bucket
CREATE POLICY "Allow public updates to profile-images" ON storage.objects
FOR UPDATE USING (bucket_id = 'profile-images');

-- Allow anyone to delete files in profile-images bucket
CREATE POLICY "Allow public deletes to profile-images" ON storage.objects
FOR DELETE USING (bucket_id = 'profile-images');

-- Verify the policies were created
SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- Optional: Set file size limit (10MB)
UPDATE storage.buckets 
SET file_size_limit = 10485760 
WHERE id = 'profile-images';

-- Optional: Restrict file types to images only
UPDATE storage.buckets 
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
WHERE id = 'profile-images';
```

## Usage Examples

### 1. Update your Settings.tsx component

```typescript
import { UserProfileService } from '../lib/userProfileService';
import { formDataToUserProfile, userProfileToFormData } from '../types/userProfile';

// In your Settings component:
const handleSave = async () => {
  try {
    const walletAddress = '0x...'; // Get from wallet connection
    const updateData = formDataToUserProfile(formData, walletAddress, profileImage);
    
    await UserProfileService.updateProfile(walletAddress, updateData);
     console.log('Profile updated successfully!');
  } catch (error) {
    console.error('Failed to update profile:', error);
  }
};

// Load existing profile data:
useEffect(() => {
  const loadProfile = async () => {
    if (walletAddress) {
      const profile = await UserProfileService.getProfile(walletAddress);
      if (profile) {
        setFormData(userProfileToFormData(profile));
        setProfileImage(profile.profile_image_url);
      }
    }
  };
  loadProfile();
}, [walletAddress]);
```

### 2. Create or Get Profile on Wallet Connection

```typescript
// When user connects wallet
const handleWalletConnect = async (walletAddress: string) => {
  try {
    const profile = await UserProfileService.getOrCreateProfile(walletAddress);
     console.log('User profile:', profile);
  } catch (error) {
    console.error('Error handling wallet connection:', error);
  }
};
```

### 3. Search for Users

```typescript
const searchUsers = async (searchTerm: string) => {
  try {
    const results = await UserProfileService.searchProfiles(searchTerm);
    return results;
  } catch (error) {
    console.error('Error searching users:', error);
    return [];
  }
};
```

### 4. Upload Profile Images

```typescript
// Using the ProfileApi (recommended - handles client-side validation)
const handleImageUpload = async (file: File, type: 'profile' | 'banner') => {
  try {
    const result = await ProfileApi.uploadImage(walletAddress, file, type);
    
    // result contains: { imageUrl: string, profile: UserProfile }
    if (type === 'profile') {
      setProfileImage(result.imageUrl);
    } else {
      setBannerImage(result.imageUrl);
    }
    
    // Refresh profile data in wallet context
    await refreshProfile();
    
    return result.imageUrl;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

// Remove image
const handleRemoveImage = async (type: 'profile' | 'banner') => {
  try {
    const updatedProfile = await ProfileApi.removeImage(walletAddress, type);
    
    if (type === 'profile') {
      setProfileImage(null);
    } else {
      setBannerImage(null);
    }
    
    await refreshProfile();
  } catch (error) {
    console.error('Error removing image:', error);
    throw error;
  }
};
```

## Database Schema

### Main Table: `user_profiles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `wallet_address` | TEXT | Ethereum wallet address (unique) |
| `username` | TEXT | Unique username (optional) |
| `display_name` | TEXT | Display name |
| `bio` | TEXT | Biography (max 180 chars) |
| `email` | TEXT | Email address |
| `website` | TEXT | Website URL |
| `twitter_url`