import { MetricResolution } from '@/services/metric-oracle/types';

export function getMockResolution(metric: string): MetricResolution {
  return {
    metric: metric,
    value: '78.5',
    unit: '%',
    as_of: new Date().toISOString(),
    confidence: 0.95,
    asset_price_suggestion: '78.50',
    reasoning: 'This is a mock response for development purposes. The data is simulated to mimic a real AI analysis, which would involve scraping multiple sources, processing the content, and running it through a fine-tuned language model. The simulated delay helps test frontend loading states.',
    sources: [
      {
        url: 'https://www.mock-source-1.com/article',
        screenshot_url: 'https://image.dummy/screenshot1.jpg',
        quote: 'The primary analysis indicates a strong correlation between market sentiment and price fluctuations, with a confidence score of 95%.',
        match_score: 0.98,
      }
    ],
  };
} 