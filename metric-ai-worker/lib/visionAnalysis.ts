/**
 * Vision AI Analysis using GPT-4o
 * Analyzes screenshots to extract price/metric data
 */

import OpenAI from 'openai';

export interface VisionAnalysisResult {
  success: boolean;
  /** Extracted value from the screenshot */
  value?: string;
  /** Confidence score 0.0-1.0 */
  confidence?: number;
  /** Visual quote/description of what was found */
  visualQuote?: string;
  /** Raw numeric value for trading */
  numericValue?: string;
  /** Error message if analysis failed */
  error?: string;
  /** Token usage for cost tracking */
  tokensUsed?: number;
}

export interface VisionAnalysisOptions {
  /** Additional context about the metric */
  description?: string;
  /** Expected value range hint */
  expectedRange?: { min?: number; max?: number };
  /** Model to use (default: gpt-4o) */
  model?: string;
}

const VISION_SYSTEM_PROMPT = `You are an expert financial data analyst specializing in extracting price and metric values from screenshots of financial websites, trading platforms, and data sources.

Your task is to analyze the provided screenshot and extract the current price/value for the specified metric.

ANALYSIS RULES:
1. Look for prominent price displays, quote boxes, ticker values, and chart labels
2. Prioritize "last", "price", "close", "current", "spot" labeled values
3. Ignore bid/ask spreads unless the metric specifically asks for them
4. Ignore percentage changes, volume numbers, and timestamps
5. For charts, identify the most recent/rightmost data point
6. Consider currency symbols and units visible in the image

OUTPUT FORMAT:
Return a JSON object with these fields:
- value: The extracted value with units if visible (e.g., "$94,523.45" or "2,847.30 points")
- numericValue: Just the number, properly formatted (e.g., "94523.45")
- confidence: Your confidence level from 0.0 to 1.0
- visualQuote: A brief description of where you found this value (e.g., "Large price display in top-left showing 'BTC/USD: $94,523.45'")

CONFIDENCE GUIDELINES:
- 0.9-1.0: Clear, unambiguous price display with matching metric name
- 0.7-0.9: Visible price but some ambiguity about exact metric
- 0.5-0.7: Price found but unclear if it matches the requested metric
- 0.3-0.5: Multiple candidates, best guess provided
- 0.0-0.3: No clear price found or image quality issues

Return ONLY valid JSON, no markdown or explanation.`;

const MAX_VISION_RETRIES = 2;
const RETRY_BACKOFF_MS = [1000, 3000];

const TRANSIENT_PATTERNS = ['rate_limit', '429', 'timeout', 'ECONNRESET', 'ETIMEDOUT', 'socket hang up', '503', '502', 'overloaded'];

function isRetryable(err: string): boolean {
  const lower = err.toLowerCase();
  return TRANSIENT_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Single-attempt GPT-4o vision call (used by retry wrapper and multi-model consensus)
 */
async function analyzeOnce(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions
): Promise<VisionAnalysisResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userPromptParts = [`METRIC TO FIND: ${metric}`];
  if (options.description) userPromptParts.push(`DESCRIPTION: ${options.description}`);
  if (options.expectedRange) {
    const rangeHint: string[] = [];
    if (options.expectedRange.min !== undefined) rangeHint.push(`min: ${options.expectedRange.min}`);
    if (options.expectedRange.max !== undefined) rangeHint.push(`max: ${options.expectedRange.max}`);
    if (rangeHint.length > 0) userPromptParts.push(`EXPECTED RANGE: ${rangeHint.join(', ')}`);
  }
  userPromptParts.push('', 'Analyze this screenshot and extract the current value for the specified metric.', 'Return your analysis as JSON.');

  const response = await openai.chat.completions.create({
    model: options.model || 'gpt-4o',
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPromptParts.join('\n') },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content?.trim() || '{}';
  const tokensUsed = response.usage?.total_tokens;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    return { success: false, error: 'Failed to parse vision analysis response', tokensUsed };
  }

  const value = typeof parsed.value === 'string' ? parsed.value : undefined;
  const numericValue = typeof parsed.numericValue === 'string'
    ? parsed.numericValue
    : (typeof parsed.numeric_value === 'string' ? parsed.numeric_value : undefined);
  const confidence = typeof parsed.confidence === 'number'
    ? Math.min(Math.max(parsed.confidence, 0), 1)
    : 0.5;
  const visualQuote = typeof parsed.visualQuote === 'string'
    ? parsed.visualQuote
    : (typeof parsed.visual_quote === 'string' ? parsed.visual_quote : undefined);

  if (!value && !numericValue) {
    return {
      success: false, confidence: 0.1,
      error: 'No price/value found in screenshot',
      visualQuote: typeof parsed.visualQuote === 'string' ? parsed.visualQuote : 'Unable to locate price data in image',
      tokensUsed,
    };
  }

  return { success: true, value, numericValue, confidence, visualQuote, tokensUsed };
}

/**
 * Analyze a screenshot using GPT-4o vision with automatic retry for transient failures.
 */
export async function analyzeScreenshotWithVision(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions = {}
): Promise<VisionAnalysisResult> {
  let lastError: VisionAnalysisResult | null = null;

  for (let attempt = 0; attempt <= MAX_VISION_RETRIES; attempt++) {
    try {
      const result = await analyzeOnce(base64Image, metric, options);
      if (result.success) {
        if (attempt > 0) console.log(`[Vision] Succeeded on retry ${attempt} for ${metric}`);
        return result;
      }
      lastError = result;
      if (!isRetryable(result.error || '')) break;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = { success: false, error: `Vision analysis failed: ${message}` };
      if (!isRetryable(message)) break;
    }

    if (attempt < MAX_VISION_RETRIES) {
      const backoff = RETRY_BACKOFF_MS[attempt] || 3000;
      console.warn(`[Vision] Attempt ${attempt + 1} failed, retrying in ${backoff}ms...`);
      await sleepMs(backoff);
    }
  }

  return lastError || { success: false, error: 'Vision analysis exhausted all retries' };
}

/**
 * Analyze multiple screenshots and combine results
 */
export async function analyzeMultipleScreenshots(
  screenshots: Array<{ base64: string; url: string }>,
  metric: string,
  options: VisionAnalysisOptions = {}
): Promise<Map<string, VisionAnalysisResult>> {
  const results = new Map<string, VisionAnalysisResult>();
  
  // Process in parallel
  const analysisPromises = screenshots.map(async ({ base64, url }) => {
    const result = await analyzeScreenshotWithVision(base64, metric, options);
    return { url, result };
  });
  
  const analysisResults = await Promise.all(analysisPromises);
  
  for (const { url, result } of analysisResults) {
    results.set(url, result);
  }
  
  return results;
}

export default analyzeScreenshotWithVision;
