/**
 * Screenshot upload utility for Supabase Storage
 * Uploads screenshots to the metric-oracle-screenshots bucket
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

export interface UploadResult {
  success: boolean;
  /** Public URL of the uploaded screenshot */
  publicUrl?: string;
  /** Storage path within the bucket */
  storagePath?: string;
  /** Error message if upload failed */
  error?: string;
}

const BUCKET_NAME = 'metric-oracle-screenshots';

/**
 * Get or create a Supabase client for storage operations
 */
function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Generate a hash from a URL for consistent file naming
 */
function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Upload a base64-encoded screenshot to Supabase Storage
 */
export async function uploadScreenshot(
  base64Data: string,
  jobId: string,
  sourceUrl: string
): Promise<UploadResult> {
  try {
    const supabase = getSupabaseClient();
    
    // Generate storage path: {jobId}/{urlHash}.png
    const urlHash = hashUrl(sourceUrl);
    const storagePath = `${jobId}/${urlHash}.png`;
    
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: true, // Overwrite if exists
      });
    
    if (error) {
      return {
        success: false,
        error: `Storage upload failed: ${error.message}`,
      };
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);
    
    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath: data.path,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Screenshot upload failed: ${message}`,
    };
  }
}

/**
 * Upload multiple screenshots in parallel
 */
export async function uploadScreenshots(
  screenshots: Array<{ base64: string; sourceUrl: string }>,
  jobId: string
): Promise<Map<string, UploadResult>> {
  const results = new Map<string, UploadResult>();
  
  const uploadPromises = screenshots.map(async ({ base64, sourceUrl }) => {
    const result = await uploadScreenshot(base64, jobId, sourceUrl);
    return { sourceUrl, result };
  });
  
  const uploadResults = await Promise.all(uploadPromises);
  
  for (const { sourceUrl, result } of uploadResults) {
    results.set(sourceUrl, result);
  }
  
  return results;
}

/**
 * Delete screenshots for a job (cleanup utility)
 */
export async function deleteJobScreenshots(jobId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    
    // List all files in the job folder
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(jobId);
    
    if (listError || !files || files.length === 0) {
      return true; // Nothing to delete
    }
    
    // Delete all files
    const filePaths = files.map((f) => `${jobId}/${f.name}`);
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filePaths);
    
    return !deleteError;
  } catch {
    return false;
  }
}

export default uploadScreenshot;
