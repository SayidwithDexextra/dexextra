# Supabase Storage Setup for Market Images

This document explains how to set up the required storage bucket for uploading market images in the vAMM Wizard.

## Prerequisites

- A Supabase project with proper environment variables configured
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in your environment
- For programmatic setup: `SUPABASE_SERVICE_ROLE_KEY` in your environment

## Setup Methods

### Method 1: Supabase Dashboard (Recommended)

1. Go to your [Supabase project dashboard](https://supabase.com/dashboard)
2. Navigate to **Storage** in the left sidebar
3. Click **Create Bucket**
4. Set the bucket name as `market-images`
5. Enable **Public bucket** (this allows public access to uploaded images)
6. Set file size limit to **5MB**
7. Add allowed MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
8. Click **Create Bucket**

### Method 2: npm Script (Automated)

Run the automated setup script:

```bash
npm run setup-storage
```

This script will:
- Create the `market-images` bucket
- Set up the necessary storage policies
- Configure file size limits and allowed MIME types

### Method 3: SQL Migration

Run the SQL migration in your Supabase SQL editor:

```bash
# Copy and paste the contents of database/migrations/003_create_storage_bucket.sql
# into your Supabase project's SQL editor and execute
```

## Storage Policies

The setup creates the following policies:

- **Allow public uploads**: Users can upload images to the bucket
- **Allow public access**: Images can be viewed publicly via URLs
- **Allow public updates**: Images can be overwritten
- **Allow public deletes**: Images can be removed

## File Restrictions

- **Maximum file size**: 5MB
- **Allowed formats**: JPEG, PNG, GIF, WebP
- **Bucket name**: `market-images`

## Troubleshooting

### "Bucket not found" Error

If you see this error, the storage bucket hasn't been created yet. Use one of the setup methods above.

### "Invalid API key" Error

Check that your environment variables are properly set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### "Storage access denied" Error

This indicates missing storage policies. Re-run the setup script or manually create the policies using Method 3.

### Network Errors

Ensure your Supabase project is active and accessible. Check your internet connection and Supabase project status.

## Environment Variables

Make sure these are set in your `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # For setup script only
```

## Testing

After setup, you can test the storage by:

1. Going to the Create Market wizard
2. Navigating to Step 3 (Market Images)
3. Trying to upload a banner or icon image
4. Verifying the upload completes successfully

## File Structure

```
project/
├── database/migrations/003_create_storage_bucket.sql  # SQL migration
├── scripts/setup-storage.js                          # Automated setup script
└── docs/STORAGE_SETUP.md                            # This documentation
``` 