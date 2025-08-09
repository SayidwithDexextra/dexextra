import { supabase } from './supabase';

export interface ImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface MarketImageUrls {
  bannerImageUrl?: string;
  iconImageUrl?: string;
  supportingPhotoUrls: string[];
}

/**
 * Upload a single image to Supabase storage
 */
export const uploadImageToSupabase = async (
  file: File, 
  path: string
): Promise<ImageUploadResult> => {
  try {
    // Check if Supabase is properly configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || supabaseUrl.includes('placeholder') || 
        !supabaseKey || supabaseKey.includes('placeholder')) {
      return {
        success: false,
        error: 'Supabase is not properly configured. Please set environment variables.'
      };
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return {
        success: false,
        error: 'Invalid file type. Please upload an image file.'
      };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${path}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('market-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Supabase storage error:', error);
      
      if (error.message?.includes('Bucket not found')) {
        return {
          success: false,
          error: 'Storage bucket "market-images" not found. Please set up storage bucket first.'
        };
      }
      if (error.message?.includes('Invalid API key')) {
        return {
          success: false,
          error: 'Invalid Supabase API key. Please check your configuration.'
        };
      }
      if (error.message?.includes('Row level security')) {
        return {
          success: false,
          error: 'Storage access denied. Please check your storage policies.'
        };
      }
      
      return {
        success: false,
        error: error.message || 'Unknown storage error'
      };
    }

    const { data: { publicUrl } } = supabase.storage
      .from('market-images')
      .getPublicUrl(filePath);

    return {
      success: true,
      url: publicUrl
    };
  } catch (uploadError: any) {
    console.error('Upload error details:', uploadError);
    
    return {
      success: false,
      error: uploadError.message || 'Upload failed'
    };
  }
};

/**
 * Upload all market images during market creation
 */
export const uploadMarketImages = async (
  bannerImage?: File,
  iconImage?: File,
  supportingPhotos: (File | null)[] = []
): Promise<{ success: boolean; urls?: MarketImageUrls; error?: string }> => {
  try {
    const results: MarketImageUrls = {
      supportingPhotoUrls: []
    };

    // Upload banner image
    if (bannerImage) {
      const bannerResult = await uploadImageToSupabase(bannerImage, 'markets/banner');
      if (!bannerResult.success) {
        return {
          success: false,
          error: `Banner upload failed: ${bannerResult.error}`
        };
      }
      results.bannerImageUrl = bannerResult.url;
    }

    // Upload icon image
    if (iconImage) {
      const iconResult = await uploadImageToSupabase(iconImage, 'markets/icon');
      if (!iconResult.success) {
        return {
          success: false,
          error: `Icon upload failed: ${iconResult.error}`
        };
      }
      results.iconImageUrl = iconResult.url;
    }

    // Upload supporting photos
    for (let i = 0; i < supportingPhotos.length; i++) {
      const photo = supportingPhotos[i];
      if (photo) {
        const photoResult = await uploadImageToSupabase(photo, 'markets/supporting');
        if (!photoResult.success) {
          return {
            success: false,
            error: `Supporting photo ${i + 1} upload failed: ${photoResult.error}`
          };
        }
        results.supportingPhotoUrls.push(photoResult.url!);
      }
    }

    return {
      success: true,
      urls: results
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Image upload failed'
    };
  }
};

/**
 * Cleanup preview URLs to prevent memory leaks
 */
export const cleanupPreviewUrls = (urls: string[]) => {
  urls.forEach(url => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
}; 