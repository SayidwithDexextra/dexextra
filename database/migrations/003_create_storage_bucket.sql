-- Create storage bucket for market images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'market-images',
  'market-images', 
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
);

-- Create policy to allow public uploads to market-images bucket
CREATE POLICY "Allow public uploads to market-images bucket" ON storage.objects
FOR INSERT 
WITH CHECK (bucket_id = 'market-images');

-- Create policy to allow public access to market-images bucket
CREATE POLICY "Allow public access to market-images bucket" ON storage.objects
FOR SELECT 
USING (bucket_id = 'market-images');

-- Create policy to allow public updates to market-images bucket (for overwrites)
CREATE POLICY "Allow public updates to market-images bucket" ON storage.objects
FOR UPDATE 
USING (bucket_id = 'market-images')
WITH CHECK (bucket_id = 'market-images');

-- Create policy to allow public deletes from market-images bucket
CREATE POLICY "Allow public deletes from market-images bucket" ON storage.objects
FOR DELETE 
USING (bucket_id = 'market-images'); 