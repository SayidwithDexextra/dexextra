/**
 * TypeScript types for Metric Discovery Agent
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

export interface MetricSource {
  url: string;
  authority: string;
  confidence: number;
}

export interface MetricDefinition {
  metric_name: string;
  unit: string;
  scope: string;
  time_basis: string;
  measurement_method: string;
}

export interface MetricDiscoveryInput {
  description: string;
  context?: string;
  user_address?: string;
}

export interface MetricDiscoveryResult {
  measurable: boolean;
  metric_definition: MetricDefinition | null;
  assumptions: string[];
  sources: {
    primary_source: MetricSource;
    secondary_sources: MetricSource[];
  } | null;
  rejection_reason: string | null;
}

export interface MetricDiscoveryResponse extends MetricDiscoveryResult {
  search_results?: SearchResult[];
  processing_time_ms?: number;
}
