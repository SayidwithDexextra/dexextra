-- =============================================
-- Migration: 006_create_metric_oracle_tables.sql
-- Add Metric Oracle AI system tables
-- =============================================

-- 1. CREATE METRIC ORACLE RESOLUTIONS TABLE
CREATE TABLE IF NOT EXISTS metric_oracle_resolutions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Metric Information
  metric_name VARCHAR(500) NOT NULL,
  metric_description TEXT,
  source_urls TEXT[] NOT NULL,
  
  -- Resolution Results (stored as JSONB for flexibility)
  resolution_data JSONB NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  
  -- Performance Metrics
  processing_time_ms INTEGER,
  
  -- Relationships
  user_address VARCHAR(42),
  related_market_id VARCHAR(255), -- Can link to vamm_markets.id or market identifier
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_metric_name_not_empty CHECK (LENGTH(metric_name) > 0),
  CONSTRAINT check_source_urls_not_empty CHECK (array_length(source_urls, 1) > 0),
  CONSTRAINT check_user_address_format CHECK (
    user_address IS NULL OR 
    user_address ~* '^0x[a-fA-F0-9]{40}$'
  )
);

-- 2. CREATE METRIC ORACLE JOBS TABLE (for async processing)
CREATE TABLE IF NOT EXISTS metric_oracle_jobs (
  job_id VARCHAR(100) PRIMARY KEY,
  
  -- Job Status
  status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  progress INTEGER CHECK (progress >= 0 AND progress <= 100),
  
  -- Input/Output Data
  metric_input JSONB NOT NULL,
  result JSONB,
  error TEXT,
  
  -- Performance
  processing_time_ms INTEGER,
  
  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT check_job_completion CHECK (
    (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL) OR
    (status = 'failed' AND error IS NOT NULL AND completed_at IS NOT NULL) OR
    (status = 'processing')
  )
);

-- 3. CREATE INDEXES FOR PERFORMANCE

-- Metric Oracle Resolutions Indexes
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_metric_name ON metric_oracle_resolutions(metric_name);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_user ON metric_oracle_resolutions(user_address);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_market ON metric_oracle_resolutions(related_market_id);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_confidence ON metric_oracle_resolutions(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_created ON metric_oracle_resolutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_text_search ON metric_oracle_resolutions USING GIN (to_tsvector('english', metric_name || ' ' || COALESCE(metric_description, '')));

-- JSONB indexes for flexible queries
CREATE INDEX IF NOT EXISTS idx_metric_oracle_resolutions_data_gin ON metric_oracle_resolutions USING GIN (resolution_data);

-- Metric Oracle Jobs Indexes
CREATE INDEX IF NOT EXISTS idx_metric_oracle_jobs_status ON metric_oracle_jobs(status);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_jobs_created ON metric_oracle_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_jobs_completed ON metric_oracle_jobs(completed_at DESC);

-- JSONB indexes for job data
CREATE INDEX IF NOT EXISTS idx_metric_oracle_jobs_input_gin ON metric_oracle_jobs USING GIN (metric_input);
CREATE INDEX IF NOT EXISTS idx_metric_oracle_jobs_result_gin ON metric_oracle_jobs USING GIN (result);

-- 4. CREATE UPDATED_AT TRIGGERS

-- Add updated_at column to resolutions table
ALTER TABLE metric_oracle_resolutions 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger for resolutions
CREATE TRIGGER update_metric_oracle_resolutions_updated_at 
  BEFORE UPDATE ON metric_oracle_resolutions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. CREATE STORAGE BUCKET FOR SCREENSHOTS (if not exists)
DO $$
BEGIN
  -- This will only work if running with appropriate permissions
  -- In production, create this bucket manually in Supabase dashboard
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'metric-oracle-screenshots'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'metric-oracle-screenshots',
      'metric-oracle-screenshots',
      true,
      10485760, -- 10MB limit
      ARRAY['image/png', 'image/jpeg', 'image/jpg']
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors if we don't have permission to create buckets
    -- This will need to be done manually in Supabase dashboard
    NULL;
END $$;

-- 6. CREATE STORAGE POLICIES (if bucket creation succeeded)
DO $$
BEGIN
  -- Allow public access to screenshots
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'metric-oracle-screenshots') THEN
    
    -- Policy for public read access
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Allow public access to metric oracle screenshots'
    ) THEN
      CREATE POLICY "Allow public access to metric oracle screenshots" ON storage.objects
      FOR SELECT 
      USING (bucket_id = 'metric-oracle-screenshots');
    END IF;
    
    -- Policy for service role uploads
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Allow service role uploads to metric oracle screenshots'
    ) THEN
      CREATE POLICY "Allow service role uploads to metric oracle screenshots" ON storage.objects
      FOR INSERT 
      WITH CHECK (bucket_id = 'metric-oracle-screenshots');
    END IF;
    
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore policy creation errors
    NULL;
END $$;

-- 7. CREATE HELPFUL VIEWS

-- View for recent high-confidence resolutions
CREATE OR REPLACE VIEW recent_metric_resolutions AS
SELECT 
  id,
  metric_name,
  confidence_score,
  (resolution_data->>'value') as resolved_value,
  (resolution_data->>'unit') as unit,
  (resolution_data->>'as_of') as as_of_date,
  array_length(source_urls, 1) as source_count,
  user_address,
  created_at
FROM metric_oracle_resolutions
WHERE confidence_score >= 0.7
ORDER BY created_at DESC
LIMIT 100;

-- View for job status summary
CREATE OR REPLACE VIEW metric_oracle_job_summary AS
SELECT 
  status,
  COUNT(*) as job_count,
  AVG(processing_time_ms) as avg_processing_time_ms,
  MIN(created_at) as oldest_job,
  MAX(created_at) as newest_job
FROM metric_oracle_jobs
GROUP BY status;

-- 8. ADD COMMENTS FOR DOCUMENTATION

COMMENT ON TABLE metric_oracle_resolutions IS 'Stores AI-powered metric resolution results with sources and confidence scores';
COMMENT ON TABLE metric_oracle_jobs IS 'Manages async processing jobs for complex metric resolutions';

COMMENT ON COLUMN metric_oracle_resolutions.resolution_data IS 'Complete MetricResolution object stored as JSONB';
COMMENT ON COLUMN metric_oracle_resolutions.confidence_score IS 'AI confidence score from 0.0 to 1.0';
COMMENT ON COLUMN metric_oracle_resolutions.source_urls IS 'Array of URLs used for the resolution';

COMMENT ON COLUMN metric_oracle_jobs.metric_input IS 'Original MetricInput request stored as JSONB';
COMMENT ON COLUMN metric_oracle_jobs.result IS 'Final MetricResolution result stored as JSONB';
COMMENT ON COLUMN metric_oracle_jobs.status IS 'Job status: processing, completed, or failed';

-- 9. INSERT SAMPLE DATA (optional, for testing)
/*
INSERT INTO metric_oracle_resolutions (
  metric_name,
  metric_description,
  source_urls,
  resolution_data,
  confidence_score,
  processing_time_ms
) VALUES (
  'World Population',
  'Current world population as of 2025',
  ARRAY['https://www.worldometers.info/world-population/', 'https://data.worldbank.org/indicator/SP.POP.TOTL'],
  '{
    "metric": "World Population",
    "value": "8,117,000,000",
    "unit": "people",
    "as_of": "2025-01-29T00:00:00Z",
    "confidence": 0.95,
    "reasoning": "Multiple authoritative sources agree on approximately 8.12 billion people as of early 2025",
    "sources": []
  }'::jsonb,
  0.95,
  4500
);
*/ 