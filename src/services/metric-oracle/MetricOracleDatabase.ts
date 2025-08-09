import { createClient } from '@supabase/supabase-js';
import type { MetricResolution, MetricInput, JobStatus } from './types';

export interface MetricResolutionRecord {
  id: string;
  metric_name: string;
  metric_description?: string;
  source_urls: string[];
  resolution_data: MetricResolution;
  confidence_score: number;
  processing_time_ms?: number;
  created_at: Date;
  user_address?: string;
  related_market_id?: string;
}

export interface JobRecord {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress?: number;
  metric_input: MetricInput;
  result?: MetricResolution;
  error?: string;
  created_at: Date;
  completed_at?: Date;
  processing_time_ms?: number;
}

export class MetricOracleDatabase {
  private supabase;

  constructor() {
    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration for Metric Oracle database');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Store a metric resolution result
   */
  async storeResolution(
    input: MetricInput, 
    resolution: MetricResolution, 
    options?: {
      processingTimeMs?: number;
      userAddress?: string;
      relatedMarketId?: string;
    }
  ): Promise<string> {
    try {
      console.log(`💾 Storing metric resolution: "${input.metric}"`);

      // Validate and sanitize data before storing
      const confidenceScore = typeof resolution.confidence === 'number' && 
                               !isNaN(resolution.confidence) && 
                               resolution.confidence >= 0 && 
                               resolution.confidence <= 1 
                               ? resolution.confidence 
                               : 0.1; // Default low confidence

      const record: Partial<MetricResolutionRecord> = {
        metric_name: input.metric,
        metric_description: input.description,
        source_urls: input.urls,
        resolution_data: resolution,
        confidence_score: confidenceScore,
        processing_time_ms: options?.processingTimeMs,
        user_address: options?.userAddress,
        related_market_id: options?.relatedMarketId,
        created_at: new Date()
      };

      console.log(`💾 Storing with confidence: ${confidenceScore} (original: ${resolution.confidence})`);

      const { data, error } = await this.supabase
        .from('metric_oracle_resolutions')
        .insert([record])
        .select()
        .single();

      if (error) {
        console.error('❌ Failed to store metric resolution:', error);
        throw new Error(`Database insert failed: ${error.message}`);
      }

      console.log(`✅ Metric resolution stored with ID: ${data.id}`);
      return data.id;

    } catch (error) {
      console.error('❌ Error storing metric resolution:', error);
      throw error;
    }
  }

  /**
   * Get stored metric resolutions
   */
  async getResolutions(filters?: {
    metricName?: string;
    userAddress?: string;
    relatedMarketId?: string;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }): Promise<MetricResolutionRecord[]> {
    try {
      let query = this.supabase
        .from('metric_oracle_resolutions')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters?.metricName) {
        query = query.ilike('metric_name', `%${filters.metricName}%`);
      }

      if (filters?.userAddress) {
        query = query.eq('user_address', filters.userAddress);
      }

      if (filters?.relatedMarketId) {
        query = query.eq('related_market_id', filters.relatedMarketId);
      }

      if (filters?.minConfidence !== undefined) {
        query = query.gte('confidence_score', filters.minConfidence);
      }

      // Apply pagination
      const limit = filters?.limit || 50;
      const offset = filters?.offset || 0;
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        console.error('❌ Failed to fetch metric resolutions:', error);
        throw new Error(`Database query failed: ${error.message}`);
      }

      return data || [];

    } catch (error) {
      console.error('❌ Error fetching metric resolutions:', error);
      throw error;
    }
  }

  /**
   * Create a background job record
   */
  async createJob(jobData: {
    job_id: string;
    status: 'processing';
    metric_input: MetricInput;
    created_at: Date;
  }): Promise<void> {
    try {
      console.log(`📝 Creating job record: ${jobData.job_id}`);

      const { error } = await this.supabase
        .from('metric_oracle_jobs')
        .insert([jobData]);

      if (error) {
        console.error('❌ Failed to create job record:', error);
        throw new Error(`Job creation failed: ${error.message}`);
      }

      console.log(`✅ Job record created: ${jobData.job_id}`);

    } catch (error) {
      console.error('❌ Error creating job:', error);
      throw error;
    }
  }

  /**
   * Update job status and result
   */
  async updateJob(
    jobId: string, 
    updates: {
      status?: 'processing' | 'completed' | 'failed';
      progress?: number;
      result?: MetricResolution;
      error?: string;
      completed_at?: Date;
      processing_time_ms?: number;
    }
  ): Promise<void> {
    try {
      console.log(`📝 Updating job: ${jobId}`);

      const { error } = await this.supabase
        .from('metric_oracle_jobs')
        .update(updates)
        .eq('job_id', jobId);

      if (error) {
        console.error('❌ Failed to update job:', error);
        throw new Error(`Job update failed: ${error.message}`);
      }

      console.log(`✅ Job updated: ${jobId} -> ${updates.status || 'in-progress'}`);

    } catch (error) {
      console.error('❌ Error updating job:', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      const { data, error } = await this.supabase
        .from('metric_oracle_jobs')
        .select('*')
        .eq('job_id', jobId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new Error('Job not found');
        }
        throw new Error(`Database query failed: ${error.message}`);
      }

      return {
        job_id: data.job_id,
        status: data.status,
        progress: data.progress,
        result: data.result,
        error: data.error,
        created_at: new Date(data.created_at),
        completed_at: data.completed_at ? new Date(data.completed_at) : undefined
      };

    } catch (error) {
      console.error('❌ Error fetching job status:', error);
      throw error;
    }
  }

  /**
   * Get resolution by ID
   */
  async getResolutionById(resolutionId: string): Promise<MetricResolutionRecord | null> {
    try {
      const { data, error } = await this.supabase
        .from('metric_oracle_resolutions')
        .select('*')
        .eq('id', resolutionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Database query failed: ${error.message}`);
      }

      return data;

    } catch (error) {
      console.error('❌ Error fetching resolution by ID:', error);
      throw error;
    }
  }

  /**
   * Search for similar metric resolutions (for caching/reuse)
   */
  async findSimilarResolutions(
    metricName: string, 
    urls: string[], 
    maxAgeHours: number = 24
  ): Promise<MetricResolutionRecord[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - maxAgeHours);

      // Find resolutions with similar metric name and overlapping URLs
      const { data, error } = await this.supabase
        .from('metric_oracle_resolutions')
        .select('*')
        .ilike('metric_name', `%${metricName}%`)
        .gte('created_at', cutoffDate.toISOString())
        .gte('confidence_score', 0.7) // Only high-confidence results
        .order('confidence_score', { ascending: false })
        .limit(5);

      if (error) {
        console.error('❌ Failed to search similar resolutions:', error);
        return [];
      }

      // Filter by URL overlap
      const filteredResults = (data || []).filter(resolution => {
        const overlap = resolution.source_urls.filter((url: string) => urls.includes(url));
        return overlap.length > 0; // At least one URL in common
      });

      return filteredResults;

    } catch (error) {
      console.error('❌ Error searching similar resolutions:', error);
      return [];
    }
  }

  /**
   * Get resolution statistics
   */
  async getResolutionStats(): Promise<{
    totalResolutions: number;
    averageConfidence: number;
    successRate: number;
    mostCommonMetrics: Array<{ metric: string; count: number }>;
    recentActivity: number;
  }> {
    try {
      // Get total count and average confidence
      const { data: aggregateData, error: aggregateError } = await this.supabase
        .from('metric_oracle_resolutions')
        .select('confidence_score');

      if (aggregateError) {
        throw new Error(`Aggregate query failed: ${aggregateError.message}`);
      }

      const totalResolutions = aggregateData?.length || 0;
      const averageConfidence = totalResolutions > 0 
        ? aggregateData.reduce((sum, item) => sum + item.confidence_score, 0) / totalResolutions 
        : 0;

      // Calculate success rate (confidence > 0.7)
      const successfulResolutions = aggregateData?.filter(item => item.confidence_score > 0.7).length || 0;
      const successRate = totalResolutions > 0 ? successfulResolutions / totalResolutions : 0;

      // Get most common metrics
      const { data: metricData, error: metricError } = await this.supabase
        .from('metric_oracle_resolutions')
        .select('metric_name')
        .limit(1000);

      const metricCounts = new Map<string, number>();
      metricData?.forEach(item => {
        const count = metricCounts.get(item.metric_name) || 0;
        metricCounts.set(item.metric_name, count + 1);
      });

      const mostCommonMetrics = Array.from(metricCounts.entries())
        .map(([metric, count]) => ({ metric, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Get recent activity (last 24 hours)
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);

      const { data: recentData, error: recentError } = await this.supabase
        .from('metric_oracle_resolutions')
        .select('id')
        .gte('created_at', yesterday.toISOString());

      const recentActivity = recentData?.length || 0;

      return {
        totalResolutions,
        averageConfidence,
        successRate,
        mostCommonMetrics,
        recentActivity
      };

    } catch (error) {
      console.error('❌ Error fetching resolution stats:', error);
      return {
        totalResolutions: 0,
        averageConfidence: 0,
        successRate: 0,
        mostCommonMetrics: [],
        recentActivity: 0
      };
    }
  }

  /**
   * Clean up old job records (optional maintenance)
   */
  async cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { data, error } = await this.supabase
        .from('metric_oracle_jobs')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('job_id');

      if (error) {
        console.error('❌ Failed to cleanup old jobs:', error);
        return 0;
      }

      const deletedCount = data?.length || 0;
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} old job records`);
      }

      return deletedCount;

    } catch (error) {
      console.error('❌ Error cleaning up old jobs:', error);
      return 0;
    }
  }
} 