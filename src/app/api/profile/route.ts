import { NextRequest, NextResponse } from 'next/server';
import { UserProfileService } from '@/lib/userProfileService';
import { z } from 'zod';
import { normalizeSocialUrlInput } from '@/lib/socialUrl';

// Validation schemas
const GetProfileSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
});

const CreateProfileSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  username: z.string().optional(),
  display_name: z.string().optional(),
});

// Helper function to validate URLs but allow empty strings
const optionalUrl = (errorMessage: string) => 
  z.string()
    .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
      message: errorMessage
    })
    .optional();

const optionalEmail = () =>
  z.string()
    .refine((val) => !val || val === '' || z.string().email().safeParse(val).success, {
      message: 'Invalid email format'
    })
    .optional();

const optionalSocialUrl = (platform: Parameters<typeof normalizeSocialUrlInput>[0], errorMessage: string) =>
  z
    .string()
    .optional()
    .refine((val) => !val || val === '' || normalizeSocialUrlInput(platform, val) !== null, {
      message: errorMessage,
    })
    .transform((val) => {
      if (!val || val === '') return undefined;
      // Safe due to refine above
      const normalized = normalizeSocialUrlInput(platform, val);
      return normalized === null ? undefined : normalized;
    });

const UpdateProfileSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  username: z.string().optional(),
  display_name: z.string().optional(),
  bio: z.string().max(180, 'Bio must be 180 characters or less').optional(),
  email: optionalEmail(),
  website: optionalUrl('Invalid website URL'),
  twitter_url: optionalUrl('Invalid Twitter URL'),
  discord_url: optionalUrl('Invalid Discord URL'),
  instagram_url: optionalSocialUrl('instagram', 'Invalid Instagram URL or handle'),
  youtube_url: optionalUrl('Invalid YouTube URL'),
  facebook_url: optionalSocialUrl('facebook', 'Invalid Facebook URL or handle'),
  profile_image_url: optionalUrl('Invalid profile image URL'),
  banner_image_url: optionalUrl('Invalid banner image URL'),
  email_notifications_enabled: z.boolean().optional(),
});

// GET - Get user profile by wallet address
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    
    const { wallet } = GetProfileSchema.parse(queryParams);

    const profile = await UserProfileService.getPublicProfile(wallet);
    
    if (!profile) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Profile not found' 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: profile
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid query parameters',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch profile' 
      },
      { status: 500 }
    );
  }
}

// POST - Create or get user profile (for wallet connection)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = CreateProfileSchema.parse(body);

    // Use the get or create function from the service
    const profile = await UserProfileService.getOrCreateProfile(
      validatedData.wallet_address,
      validatedData.username,
      validatedData.display_name
    );

    return NextResponse.json({
      success: true,
      data: profile,
      message: 'Profile created or retrieved successfully'
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating/getting profile:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid profile data',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    // Handle specific database errors
    if (error instanceof Error) {
      if (error.message.includes('duplicate key')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Username already exists' 
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to create profile' 
      },
      { status: 500 }
    );
  }
}

// PUT - Update user profile
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = UpdateProfileSchema.parse(body);

    const { wallet_address, ...updateData } = validatedData;

    // Check if profile exists first
    const existingProfile = await UserProfileService.getProfile(wallet_address);
    if (!existingProfile) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Profile not found' 
        },
        { status: 404 }
      );
    }

    // Check username availability if username is being updated
    if (updateData.username && updateData.username !== existingProfile.username) {
      const isAvailable = await UserProfileService.isUsernameAvailable(
        updateData.username, 
        wallet_address
      );
      
      if (!isAvailable) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Username already taken' 
          },
          { status: 409 }
        );
      }
    }

    const updatedProfile = await UserProfileService.updateProfile(
      wallet_address, 
      updateData
    );

    return NextResponse.json({
      success: true,
      data: updatedProfile,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid profile data',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to update profile' 
      },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate user profile (soft delete)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Wallet address required' 
        },
        { status: 400 }
      );
    }

    // Validate wallet address format
    GetProfileSchema.parse({ wallet });

    await UserProfileService.deactivateProfile(wallet);

    return NextResponse.json({
      success: true,
      message: 'Profile deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating profile:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid wallet address',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to deactivate profile' 
      },
      { status: 500 }
    );
  }
} 