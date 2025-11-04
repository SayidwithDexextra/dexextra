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

export interface MetricInput {
  metric: string;
  description?: string;
  urls: string[];
}

export interface ScrapedSource {
  url: string;
  title: string;
  content: string;
  screenshot_path?: string;
  screenshot_url?: string;
  error?: string;
  timestamp: Date;
  candidates?: Array<{
    selector: string;
    xpath: string;
    text: string;
    html_snippet: string;
    id?: string;
    className?: string;
    dataAttrs?: Record<string, string>;
  }>;
  raw_html_excerpt?: string;
}

export interface ProcessedChunk {
  text: string;
  relevance_score: number;
  source_url: string;
  context: string;
  position?: number;
}

export interface JobStatus {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: MetricResolution;
  error?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface TextChunk {
  text: string;
  source_url: string;
  context: string;
  position: number;
} 