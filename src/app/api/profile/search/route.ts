import { NextRequest, NextResponse } from 'next/server';
import { UserProfileService } from '@/lib/userProfileService';
import { z } from 'zod';

// Validation schema
const SearchSchema = z.object({
  q: z.string().min(1, 'Search term must not be empty').max(100, 'Search term too long'),
  limit: z.string().transform(Number).optional().default('20'),
});

// GET - Search user profiles
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    
    const { q: searchTerm, limit } = SearchSchema.parse(queryParams);

    // Validate limit is reasonable
    if (limit > 50 || limit < 1) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Limit must be between 1 and 50' 
        },
        { status: 400 }
      );
    }

    const profiles = await UserProfileService.searchProfiles(searchTerm);
    
    // Apply limit (the database function already limits to 50, but we can be more restrictive)
    const limitedProfiles = profiles.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: limitedProfiles,
      count: limitedProfiles.length,
      searchTerm
    });

  } catch (error) {
    console.error('Error searching profiles:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid search parameters',
          details: error.errors 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Search failed' 
      },
      { status: 500 }
    );
  }
} 