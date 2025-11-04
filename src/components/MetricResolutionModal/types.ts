/**
 * Type definitions for the Metric Resolution Modal component
 * Interfaces for handling resolve-metric-fast API responses
 */

export interface MetricResolution {
  metric: string;
  value: string;
  unit: string;
  as_of: string;
  confidence: number;
  asset_price_suggestion: string;
  reasoning: string;
  sources: Array<{
    url: string;
    screenshot_url: string;
    quote: string;
    match_score: number;
    css_selector?: string;
    xpath?: string;
    html_snippet?: string;
    js_extractor?: string;
  }>;
}

export interface MetricResolutionResponse {
  status: 'completed' | 'processing' | 'error';
  processingTime: string;
  data: MetricResolution;
  cached: boolean;
  performance: {
    totalTime: number;
    breakdown: {
      cacheCheck: string;
      scraping: string;
      processing: string;
      aiAnalysis: string;
    };
  };
}

export interface MetricResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: MetricResolutionResponse | null;
  onAccept?: () => void;
  imageUrl?: string;
  fullscreenImageUrl?: string;
} 