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
  /**
   * Optional error message for validation failures (e.g. could not extract a numeric price).
   * When present, the modal shows an error state instead of an infinite loading spinner.
   */
  error?: string | null;
  onAccept?: () => void;
  /**
   * Invoked when the user explicitly rejects the current source validation.
   * This will close the modal and signal the parent to re-search for alternative sources.
   */
  onDeny?: () => void;
  /**
   * Invoked when validation fails and the user wants to choose another source / enter a custom URL.
   * This should keep the user on the source selection step without necessarily excluding the URL.
   */
  onPickAnotherSource?: () => void;
  /**
   * Invoked when the user explicitly rejects the suggested asset price (if present).
   * Parent components should clear any auto-populated price fields (e.g. startPrice/initialPrice)
   * and/or remove `asset_price_suggestion` from stored AI results.
   */
  onDenySuggestedAssetPrice?: () => void;
  imageUrl?: string;
  fullscreenImageUrl?: string;
} 