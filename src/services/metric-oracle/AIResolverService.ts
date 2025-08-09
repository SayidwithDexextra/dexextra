import OpenAI from 'openai';
import type { MetricResolution, ProcessedChunk, ScrapedSource } from './types';

export interface AIResolverInput {
  metric: string;
  description?: string;
  sources: ProcessedChunk[];
  scrapedSources: ScrapedSource[];
}

export interface AIAnalysisResult {
  value: string;
  unit: string;
  as_of: string;
  confidence: number;
  asset_price_suggestion: string;
  reasoning: string;
  source_quotes: Array<{
    url: string;
    quote: string;
    match_score: number;
  }>;
}

export class AIResolverService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Use GPT-4 for better reasoning capabilities
    this.model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
  }

  /**
   * Main method to resolve a metric using AI
   */
  async resolveMetric(input: AIResolverInput): Promise<MetricResolution> {
    console.log(`🧠 AI analyzing metric: "${input.metric}"`);
    
    try {
      // Prepare the analysis prompt
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(input);
      
      console.log('🤖 Sending request to OpenAI...');
      
      // Call OpenAI API
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // Low temperature for more consistent results
        max_tokens: 2000,
        response_format: { type: 'json_object' } // Ensure JSON output
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI model');
      }

      // Parse the AI response
      const aiResult = JSON.parse(content) as AIAnalysisResult;
      
      // Build the final resolution
      const resolution = this.buildMetricResolution(input, aiResult);
      
      console.log(`✅ AI analysis completed: ${aiResult.value} ${aiResult.unit} (confidence: ${aiResult.confidence})`);
      
      return resolution;

    } catch (error) {
      console.error('❌ AI resolution failed:', error);
      
      // Fallback to basic analysis if AI fails
      return this.generateFallbackResolution(input);
    }
  }

  /**
   * Build the system prompt for the AI
   */
  private buildSystemPrompt(): string {
    return `You are an expert metric analyst specializing in extracting and validating CURRENT, REAL-TIME quantitative information from web sources.

CRITICAL REQUIREMENT: You MUST focus ONLY on the most current value available RIGHT NOW. Do NOT use historical data, past trends, or outdated information unless it's the only data available.

Your task is to analyze multiple sources and resolve a single, accurate CURRENT metric value.

INSTRUCTIONS:
1. Extract the MOST CURRENT value available for the requested metric (as of TODAY)
2. PRIORITIZE real-time, live, or "current as of [recent date]" data
3. REJECT historical data, trends, or past values unless explicitly noted as current
4. Compare current values across sources and resolve discrepancies
5. Assign confidence scores heavily weighted on data recency
6. Calculate an asset price based on the metric value (see ASSET PRICE CALCULATION below)
7. Provide clear reasoning emphasizing why this is the current value
8. Always return valid JSON in the specified format

EVALUATION CRITERIA (in order of importance):
1. DATA RECENCY: Current/live data > recent data > historical data
2. Source credibility (official sites > news > blogs)
3. Real-time indicators ("as of today", "current", "live", "now")
4. Consistency across current sources
5. Presence of timestamps indicating recent updates

ASSET PRICE CALCULATION:
Convert the metric value to an asset price between $10.00 - $100.00 using this algorithm:
1. Take the numeric metric value (ignore units, commas, etc.)
2. Convert to scientific notation format (e.g., 8,237,468,680 → 8.237468680 × 10^9)
3. Take the mantissa (the number before × 10^x, e.g., 8.237468680)
4. Multiply by 10 to scale into price range (e.g., 8.237468680 × 10 = 82.37468680)
5. Round to 2 decimal places and ensure it's between $10.00 - $100.00
6. If result < $10.00, set to $10.00. If result > $100.00, set to $100.00.

EXAMPLES:
- World population: 8,237,468,680 → 8.237468680 → 82.37 → $82.37
- Monthly listeners: 1,345 → 1.345 → 13.45 → $13.45
- Bitcoin price: $45,231.50 → 4.523150 → 45.23 → $45.23
- Very small number: 0.00456 → 4.56 → 45.60 → $45.60
- Very large number: 999,999,999,999 → 9.99999999999 → 99.99 → $99.99

OUTPUT FORMAT (JSON):
{
  "value": "exact current numeric value or descriptive value",
  "unit": "unit of measurement (e.g., 'people', 'USD', 'percentage')",
  "as_of": "current date/time when value is valid (ISO format, prefer TODAY)",
  "confidence": 0.95,
  "asset_price_suggestion": "XX.XX",
  "reasoning": "detailed explanation emphasizing why this is the CURRENT value and when it was last updated",
  "source_quotes": [
    {
      "url": "source URL",
      "quote": "exact text from source supporting the CURRENT value",
      "match_score": 0.98
    }
  ]
}

CONFIDENCE SCORING (heavily weighted for recency):
- 0.9-1.0: Multiple authoritative sources with CURRENT data (today/this week)
- 0.7-0.9: Good sources with recent data (this month) or real-time indicators
- 0.5-0.7: Limited current sources or data from last few months
- 0.3-0.5: Only historical data available or conflicting current information
- 0.0-0.3: No current data found, only outdated historical information

REJECT: Historical trends, past data points, outdated statistics, or archived information unless it's the only available current reference.`;
  }

  /**
   * Build the user prompt with metric data
   */
  private buildUserPrompt(input: AIResolverInput): string {
    const { metric, description, sources } = input;
    
    let prompt = `METRIC TO RESOLVE: "${metric}"`;
    
    if (description) {
      prompt += `\nDESCRIPTION: ${description}`;
    }
    
    prompt += `\n\nSOURCE DATA:\n`;
    
    // Add the most relevant chunks from each source
    const sourceMap = new Map<string, ProcessedChunk[]>();
    
    // Group chunks by source URL
    sources.forEach(chunk => {
      if (!sourceMap.has(chunk.source_url)) {
        sourceMap.set(chunk.source_url, []);
      }
      sourceMap.get(chunk.source_url)!.push(chunk);
    });
    
    let sourceIndex = 1;
    for (const [url, chunks] of sourceMap) {
      prompt += `\n--- SOURCE ${sourceIndex}: ${url} ---\n`;
      
      // Take top 3 most relevant chunks per source
      const topChunks = chunks
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, 3);
      
      topChunks.forEach((chunk, idx) => {
        prompt += `\nChunk ${idx + 1} (relevance: ${chunk.relevance_score.toFixed(2)}):\n`;
        prompt += `${chunk.text}\n`;
      });
      
      sourceIndex++;
    }
    
    prompt += `\n\nTASK: Analyze the above sources and determine the most accurate current value for "${metric}". Return your analysis as valid JSON following the specified format.`;
    
    return prompt;
  }

  /**
   * Build the final metric resolution from AI result
   */
  private buildMetricResolution(input: AIResolverInput, aiResult: AIAnalysisResult): MetricResolution {
    // Map AI source quotes to resolution format
    const sources = aiResult.source_quotes.map(quote => {
      // Find matching scraped source for screenshot
      const scrapedSource = input.scrapedSources.find(s => s.url === quote.url);
      
      return {
        url: quote.url,
        screenshot_url: scrapedSource?.screenshot_url || '',
        quote: quote.quote,
        match_score: quote.match_score
      };
    });

    // Validate and sanitize AI response
    const validatedResult = {
      metric: input.metric,
      value: aiResult.value || 'Data not available',
      unit: aiResult.unit || 'unknown',
      as_of: aiResult.as_of || new Date().toISOString(),
      confidence: typeof aiResult.confidence === 'number' && !isNaN(aiResult.confidence) 
                  ? Math.min(Math.max(aiResult.confidence, 0), 1) 
                  : 0.1, // Default low confidence
      asset_price_suggestion: aiResult.asset_price_suggestion || '50.00', // Default if AI doesn't provide
      reasoning: aiResult.reasoning || 'AI analysis completed with limited data',
      sources
    };

    console.log(`✅ AI analysis completed: ${validatedResult.value} ${validatedResult.unit} (confidence: ${validatedResult.confidence})`);
    
    return validatedResult;
  }

  /**
   * Generate fallback resolution when AI fails
   */
  private generateFallbackResolution(input: AIResolverInput): MetricResolution {
    console.log('⚠️ Generating fallback resolution due to AI failure');
    
    const { metric, sources, scrapedSources } = input;
    
    // Basic analysis: look for numbers in the text
    const numberPattern = /[\d,]+\.?\d*/g;
    const allNumbers: string[] = [];
    
    sources.forEach(chunk => {
      const numbers = chunk.text.match(numberPattern);
      if (numbers) {
        allNumbers.push(...numbers);
      }
    });
    
    // Take the most common or largest number as fallback
    const fallbackValue = allNumbers.length > 0 ? allNumbers[0] : 'Unable to determine';
    
    return {
      metric,
      value: fallbackValue,
      unit: 'unknown',
      as_of: new Date().toISOString(),
      confidence: 0.1, // Very low confidence for fallback
      asset_price_suggestion: '50.00', // Default fallback price
      reasoning: 'Fallback analysis used due to AI service unavailability. Manual verification recommended.',
      sources: scrapedSources.slice(0, 3).map(source => ({
        url: source.url,
        screenshot_url: source.screenshot_url || '',
        quote: source.content.substring(0, 200) + '...',
        match_score: 0.1
      }))
    };
  }

  /**
   * Validate AI response format
   */
  private validateAIResponse(response: any): response is AIAnalysisResult {
    return (
      typeof response === 'object' &&
      typeof response.value === 'string' &&
      typeof response.unit === 'string' &&
      typeof response.as_of === 'string' &&
      typeof response.confidence === 'number' &&
      typeof response.reasoning === 'string' &&
      Array.isArray(response.source_quotes)
    );
  }

  /**
   * Alternative: Use Claude instead of OpenAI (if needed)
   */
  async resolveWithClaude(input: AIResolverInput): Promise<MetricResolution> {
    // This would require Anthropic's Claude API
    // Placeholder for future implementation
    throw new Error('Claude integration not yet implemented');
  }
} 