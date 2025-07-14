import { NextRequest, NextResponse } from 'next/server';
import { UserProfileService } from '@/lib/userProfileService';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';

// Validation schema
const UploadSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  type: z.enum(['profile', 'banner'], { required_error: 'Type must be profile or banner' }),
});

// POST - Upload profile or banner image
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract and validate form data
    const walletAddress = formData.get('wallet_address') as string;
    const type = formData.get('type') as 'profile' | 'banner';
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No file provided' 
        },
        { status: 400 }
      );
    }

    // Validate the input data
    const validatedData = UploadSchema.parse({ wallet_address: walletAddress, type });

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.' 
        },
        { status: 400 }
      );
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'File too large. Maximum size is 10MB.' 
        },
        { status: 400 }
      );
    }

    // Check if profile exists
    const existingProfile = await UserProfileService.getProfile(validatedData.wallet_address);
    
    if (!existingProfile) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Profile not found. Please create a profile first.' 
        },
        { status: 404 }
      );
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${validatedData.wallet_address}/${validatedData.type}_${Date.now()}.${fileExt}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('profile-images')
      .upload(fileName, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json(
        { 
          success: false, 
          error: `Failed to upload image to storage: ${uploadError.message}` 
        },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('profile-images')
      .getPublicUrl(fileName);

    // Update profile with new image URL
    const updateField = validatedData.type === 'profile' ? 'profile_image_url' : 'banner_image_url';
    const updatedProfile = await UserProfileService.updateProfile(
      validatedData.wallet_address, 
      { [updateField]: publicUrl }
    );

    // Delete old image if it exists (optional cleanup)
    const oldImageUrl = validatedData.type === 'profile' 
      ? existingProfile.profile_image_url 
      : existingProfile.banner_image_url;
    
    if (oldImageUrl && oldImageUrl.includes('profile-images')) {
      try {
        // Extract filename from URL
        const oldFileName = oldImageUrl.split('/').pop();
        if (oldFileName && oldFileName !== fileName.split('/').pop()) {
          await supabase.storage
            .from('profile-images')
            .remove([`${validatedData.wallet_address}/${oldFileName}`]);
        }
      } catch (cleanupError) {
        console.warn('Failed to cleanup old image:', cleanupError);
        // Don't fail the request if cleanup fails
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        imageUrl: publicUrl,
        fileName: fileName,
        type: validatedData.type,
        profile: updatedProfile
      },
      message: 'Image uploaded successfully'
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid upload data',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to upload image' 
      },
      { status: 500 }
    );
  }
}

// DELETE - Remove profile or banner image
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet_address');
    const type = searchParams.get('type') as 'profile' | 'banner';

    if (!walletAddress || !type) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Wallet address and type are required' 
        },
        { status: 400 }
      );
    }

    // Validate input
    const validatedData = UploadSchema.parse({ wallet_address: walletAddress, type });

    // Get current profile
    const profile = await UserProfileService.getProfile(validatedData.wallet_address);
    if (!profile) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Profile not found' 
        },
        { status: 404 }
      );
    }

    // Get current image URL
    const imageUrl = validatedData.type === 'profile' 
      ? profile.profile_image_url 
      : profile.banner_image_url;

    if (!imageUrl || !imageUrl.includes('profile-images')) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No image to delete' 
        },
        { status: 400 }
      );
    }

    // Extract filename from URL and delete from storage
    const fileName = imageUrl.split('/').pop();
    if (fileName) {
      const { error: deleteError } = await supabase.storage
        .from('profile-images')
        .remove([`${validatedData.wallet_address}/${fileName}`]);

      if (deleteError) {
        console.error('Storage delete error:', deleteError);
      }
    }

    // Update profile to remove image URL
    const updateField = validatedData.type === 'profile' ? 'profile_image_url' : 'banner_image_url';
    const updatedProfile = await UserProfileService.updateProfile(
      validatedData.wallet_address, 
      { [updateField]: null }
    );

    return NextResponse.json({
      success: true,
      data: updatedProfile,
      message: 'Image removed successfully'
    });

  } catch (error) {
    console.error('Error deleting image:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid delete request',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to delete image' 
      },
      { status: 500 }
    );
  }
} 