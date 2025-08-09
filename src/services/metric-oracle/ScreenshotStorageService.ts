import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ScreenshotStorageService {
  private supabase;
  private bucketName = 'metric-oracle-screenshots';

  constructor() {
    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration for screenshot storage');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    
    // Ensure bucket exists
    this.ensureBucketExists();
  }

  /**
   * Upload screenshot to Supabase storage
   */
  async uploadScreenshot(localPath: string, storagePath: string): Promise<string> {
    try {
      console.log(`📤 Uploading screenshot: ${localPath} -> ${storagePath}`);

      // Read the file
      const fileBuffer = await fs.readFile(localPath);
      
      // Generate unique filename if not provided
      if (!storagePath) {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 15);
        storagePath = `screenshots/${timestamp}-${randomId}.png`;
      }

      // Upload to Supabase storage
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(storagePath, fileBuffer, {
          contentType: 'image/png',
          upsert: true // Replace if exists
        });

      if (error) {
        console.error('❌ Screenshot upload failed:', error);
        throw new Error(`Upload failed: ${error.message}`);
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(storagePath);

      const publicUrl = urlData.publicUrl;
      
      // Clean up local file
      try {
        await fs.unlink(localPath);
        console.log(`🧹 Cleaned up local file: ${localPath}`);
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup local file:', cleanupError);
      }

      console.log(`✅ Screenshot uploaded successfully: ${publicUrl}`);
      return publicUrl;

    } catch (error) {
      console.error('❌ Screenshot upload error:', error);
      throw new Error(`Failed to upload screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload multiple screenshots in batch
   */
  async uploadMultipleScreenshots(screenshots: Array<{ localPath: string; storagePath: string }>): Promise<string[]> {
    const uploadPromises = screenshots.map(({ localPath, storagePath }) => 
      this.uploadScreenshot(localPath, storagePath)
    );

    try {
      const urls = await Promise.all(uploadPromises);
      console.log(`✅ Batch upload completed: ${urls.length} screenshots`);
      return urls;
    } catch (error) {
      console.error('❌ Batch screenshot upload failed:', error);
      throw error;
    }
  }

  /**
   * Delete screenshot from storage
   */
  async deleteScreenshot(storagePath: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .remove([storagePath]);

      if (error) {
        console.error('❌ Screenshot deletion failed:', error);
        return false;
      }

      console.log(`🗑️ Screenshot deleted: ${storagePath}`);
      return true;
    } catch (error) {
      console.error('❌ Screenshot deletion error:', error);
      return false;
    }
  }

  /**
   * Clean up old screenshots (older than specified days)
   */
  async cleanupOldScreenshots(olderThanDays: number = 7): Promise<number> {
    try {
      console.log(`🧹 Starting cleanup of screenshots older than ${olderThanDays} days...`);

      // List all files in the bucket
      const { data: files, error } = await this.supabase.storage
        .from(this.bucketName)
        .list('screenshots', {
          limit: 1000,
          offset: 0
        });

      if (error) {
        console.error('❌ Failed to list screenshots for cleanup:', error);
        return 0;
      }

      if (!files) {
        console.log('📁 No screenshots found for cleanup');
        return 0;
      }

      // Filter old files
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const oldFiles = files.filter(file => {
        if (!file.created_at) return false;
        const fileDate = new Date(file.created_at);
        return fileDate < cutoffDate;
      });

      if (oldFiles.length === 0) {
        console.log('📁 No old screenshots to cleanup');
        return 0;
      }

      // Delete old files
      const filePaths = oldFiles.map(file => `screenshots/${file.name}`);
      const { error: deleteError } = await this.supabase.storage
        .from(this.bucketName)
        .remove(filePaths);

      if (deleteError) {
        console.error('❌ Failed to delete old screenshots:', deleteError);
        return 0;
      }

      console.log(`✅ Cleaned up ${oldFiles.length} old screenshots`);
      return oldFiles.length;

    } catch (error) {
      console.error('❌ Screenshot cleanup error:', error);
      return 0;
    }
  }

  /**
   * Get storage stats
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    oldestFile?: Date;
    newestFile?: Date;
  }> {
    try {
      const { data: files, error } = await this.supabase.storage
        .from(this.bucketName)
        .list('screenshots', {
          limit: 1000,
          offset: 0
        });

      if (error || !files) {
        return { totalFiles: 0, totalSize: 0 };
      }

      const totalFiles = files.length;
      const totalSize = files.reduce((sum, file) => sum + (file.metadata?.size || 0), 0);
      
      const dates = files
        .map(file => file.created_at ? new Date(file.created_at) : null)
        .filter(date => date !== null) as Date[];

      const oldestFile = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : undefined;
      const newestFile = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : undefined;

      return {
        totalFiles,
        totalSize,
        oldestFile,
        newestFile
      };

    } catch (error) {
      console.error('❌ Failed to get storage stats:', error);
      return { totalFiles: 0, totalSize: 0 };
    }
  }

  /**
   * Ensure the storage bucket exists
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await this.supabase.storage.listBuckets();
      
      if (listError) {
        console.warn('⚠️ Could not check bucket existence:', listError);
        return;
      }

      const bucketExists = buckets?.some(bucket => bucket.name === this.bucketName);
      
      if (!bucketExists) {
        console.log(`📁 Creating storage bucket: ${this.bucketName}`);
        
        // Create the bucket
        const { error: createError } = await this.supabase.storage.createBucket(this.bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg'],
          fileSizeLimit: 10 * 1024 * 1024 // 10MB limit
        });

        if (createError) {
          console.error('❌ Failed to create storage bucket:', createError);
        } else {
          console.log(`✅ Storage bucket created: ${this.bucketName}`);
        }
      }

    } catch (error) {
      console.warn('⚠️ Could not ensure bucket exists:', error);
    }
  }

  /**
   * Generate a unique storage path
   */
  generateStoragePath(prefix: string = 'screenshot'): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    return `screenshots/${prefix}-${timestamp}-${randomId}.png`;
  }

  /**
   * Check if storage is available
   */
  async isStorageAvailable(): Promise<boolean> {
    try {
      const { data: buckets, error } = await this.supabase.storage.listBuckets();
      return !error && Array.isArray(buckets);
    } catch (error) {
      return false;
    }
  }
} 