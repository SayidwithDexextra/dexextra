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

/**
 * Analyze a screenshot using GPT-4o vision to extract price data
 */
export async function analyzeScreenshotWithVision(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions = {}
): Promise<VisionAnalysisResult> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Build the user prompt
    const userPromptParts = [
      `METRIC TO FIND: ${metric}`,
    ];
    
    if (options.description) {
      userPromptParts.push(`DESCRIPTION: ${options.description}`);
    }
    
    if (options.expectedRange) {
      const rangeHint = [];
      if (options.expectedRange.min !== undefined) {
        rangeHint.push(`min: ${options.expectedRange.min}`);
      }
      if (options.expectedRange.max !== undefined) {
        rangeHint.push(`max: ${options.expectedRange.max}`);
      }
      if (rangeHint.length > 0) {
        userPromptParts.push(`EXPECTED RANGE: ${rangeHint.join(', ')}`);
      }
    }
    
    userPromptParts.push(
      '',
      'Analyze this screenshot and extract the current value for the specified metric.',
      'Return your analysis as JSON.'
    );
    
    const userPrompt = userPromptParts.join('\n');
    
    // Call GPT-4o with vision
    const response = await openai.chat.completions.create({
      model: options.model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: VISION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: 'high', // Use high detail for financial data
              },
            },
          ],
        },
      ],
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    
    const content = response.choices[0]?.message?.content?.trim() || '{}';
    const tokensUsed = response.usage?.total_tokens;
    
    // Parse the response
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    } catch {
      return {
        success: false,
        error: 'Failed to parse vision analysis response',
        tokensUsed,
      };
    }
    
    // Extract and validate fields
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
        success: false,
        confidence: 0.1,
        error: 'No price/value found in screenshot',
        visualQuote: typeof parsed.visualQuote === 'string' ? parsed.visualQuote : 'Unable to locate price data in image',
        tokensUsed,
      };
    }
    
    return {
      success: true,
      value,
      numericValue,
      confidence,
      visualQuote,
      tokensUsed,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Vision analysis failed: ${message}`,
    };
  }
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
