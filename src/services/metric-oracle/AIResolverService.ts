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
  javascript_extractor?: string;
  javascript_extractor_b64?: string;
  // Optional explicit locators for the primary source
  css_selector?: string;
  xpath?: string;
}

export class AIResolverService {
  private openai: OpenAI;
  private model: string;
  private enabled: boolean;

  constructor() {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    this.enabled = !!apiKey && String(process.env.METRIC_AI_DISABLED).toLowerCase() !== 'true';
    this.openai = new OpenAI({ apiKey });
    
    // Prefer a larger modern model by default; override via OPENAI_MODEL
    this.model = process.env.OPENAI_MODEL || 'gpt-4.1';
  }

  /**
   * Main method to resolve a metric using AI
   */
  async resolveMetric(input: AIResolverInput): Promise<MetricResolution> {
    console.log(`🧠 AI analyzing metric: "${input.metric}"`);
    
    try {
      // Short-circuit if AI is disabled or not configured
      if (!this.enabled) {
        console.warn('⚠️ AI disabled or OPENAI_API_KEY not set; using fallback resolution');
        return this.generateFallbackResolution(input);
      }

      // Prepare the analysis prompt
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(input);
      
      console.log('🤖 Sending request to OpenAI...');
      
      // Build messages, including Wayback screenshots if available (vision models)
      const waybackImages = (input.scrapedSources || [])
        .map(s => s.screenshot_url)
        .filter((u): u is string => typeof u === 'string' && !!u)
        .slice(0, 3);

      // Default: text-only
      const basePayload: any = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      };

      // If screenshots exist, attempt multimodal call
      let multimodalPayload: any | null = null;
      const visionEnabled = String(process.env.METRIC_AI_ENABLE_VISION || '').toLowerCase() === 'true';
      if (visionEnabled && waybackImages.length > 0) {
        const visionModel = process.env.OPENAI_VISION_MODEL || this.model;
        const contentParts = [
          { type: 'text', text: userPrompt },
          ...waybackImages.map(url => ({ type: 'image_url', image_url: { url } }))
        ];
        multimodalPayload = {
          model: visionModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: contentParts as any }
          ],
          response_format: { type: 'json_object' }
        };
      }
      // Optionally include temperature via env override
      const tempEnv = process.env.OPENAI_TEMPERATURE;
      if (typeof tempEnv === 'string' && tempEnv.trim() !== '') {
        const t = Number(tempEnv);
        if (Number.isFinite(t)) basePayload.temperature = t;
      }

      const isUnsupportedTokens = (e: any) => {
        const c = e?.code || e?.error?.code;
        const p = e?.param || e?.error?.param;
        return c === 'unsupported_parameter' && (p === 'max_tokens' || p === 'max_output_tokens' || p === 'max_completion_tokens');
      };
      const isUnsupportedTemp = (e: any) => {
        const c = e?.code || e?.error?.code;
        const p = e?.param || e?.error?.param;
        return c === 'unsupported_value' && p === 'temperature';
      };

      let response;
      // Attempt 1: prefer multimodal if available
      try {
        if (multimodalPayload) {
          response = await this.openai.chat.completions.create({ ...multimodalPayload, max_completion_tokens: 2000 } as any);
        } else {
          response = await this.openai.chat.completions.create({ ...basePayload, max_completion_tokens: 2000 } as any);
        }
      } catch (e1: any) {
        if (isUnsupportedTemp(e1)) {
          // Retry without temperature, keep max_completion_tokens
          const initial = multimodalPayload || basePayload;
          const { temperature, ...noTemp } = initial;
          try {
            response = await this.openai.chat.completions.create({ ...noTemp, max_completion_tokens: 2000 } as any);
          } catch (e1b: any) {
            if (isUnsupportedTokens(e1b)) {
              // Fallback to legacy max_tokens without temperature
              response = await this.openai.chat.completions.create({ ...noTemp, max_tokens: 2000 } as any);
            } else {
              throw e1b;
            }
          }
        } else if (isUnsupportedTokens(e1)) {
          // Legacy fallback: try max_tokens (may still have temperature)
          try {
            const initial = multimodalPayload || basePayload;
            response = await this.openai.chat.completions.create({ ...initial, max_tokens: 2000 } as any);
          } catch (e2: any) {
            if (isUnsupportedTemp(e2)) {
              const initial = multimodalPayload || basePayload;
              const { temperature, ...noTemp } = initial as any;
              response = await this.openai.chat.completions.create({ ...noTemp, max_tokens: 2000 } as any);
            } else {
              throw e2;
            }
          }
        } else if (multimodalPayload) {
          // If multimodal failed for other reasons, try text-only as final attempt
          try {
            response = await this.openai.chat.completions.create({ ...basePayload, max_completion_tokens: 2000 } as any);
          } catch (eText: any) {
            throw eText;
          }
        } else {
          throw e1;
        }
      }

      let content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        // Retry once without response_format and without temperature to maximize compatibility
        try {
          const { response_format, ...noRF } = basePayload;
          const { temperature, ...noTemp } = noRF as any;
          try {
            const res2 = await this.openai.chat.completions.create({ ...noTemp, max_completion_tokens: 2000 } as any);
            content = res2.choices[0]?.message?.content?.trim();
          } catch (e2: any) {
            // Last attempt: legacy max_tokens
            const res3 = await this.openai.chat.completions.create({ ...noTemp, max_tokens: 2000 } as any);
            content = res3.choices[0]?.message?.content?.trim();
          }
        } catch {}
        if (!content) {
          throw new Error('No response from AI model');
        }
      }

      // Parse the AI response
      const aiResult = this.parseAIJson(content) as AIAnalysisResult;
      
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
   * Attempt to safely parse JSON emitted by the LLM, repairing common formatting issues.
   */
  private parseAIJson(raw: string): any {
    const attempts: Array<(s: string) => string> = [
      (s) => s,
      // Remove code fences
      (s) => s.replace(/```json[\r\n]?|```/g, ''),
      // Remove BOM and unusual control characters
      (s) => s.replace(/\uFEFF/g, '').replace(/[\u0000-\u0019]/g, ''),
      // Remove trailing commas before } or ]
      (s) => s.replace(/,\s*(\}|\])/g, '$1'),
    ];

    for (const fix of attempts) {
      const candidate = fix(raw);
      try {
        return JSON.parse(candidate);
      } catch {}
    }

    // Fallback: extract outermost JSON object
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        const slice = raw.slice(start, end + 1);
        return JSON.parse(slice.replace(/,\s*(\}|\])/g, '$1'));
      }
    } catch {}

    throw new Error('Failed to parse AI JSON response');
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
6. Provide clear reasoning emphasizing why this is the current value
7. Always return valid JSON in the specified format

EVALUATION CRITERIA (in order of importance):
1. DATA RECENCY: Current/live data > recent data > historical data
2. Source credibility (official sites > news > blogs)
3. Real-time indicators ("as of today", "current", "live", "now")
4. Consistency across current sources
5. Presence of timestamps indicating recent updates

OUTPUT FORMAT (JSON):
{
  "value": "exact current numeric value or descriptive value",
  "unit": "unit of measurement (e.g., 'people', 'USD', 'percentage')",
  "as_of": "current date/time when value is valid (ISO format, prefer TODAY)",
  "confidence": 0.95,
  "asset_price_suggestion": "Numeric string computed per ASSET PRICE RULES below; MUST be formatted with up to 5 significant figures using standard rounding (no unnecessary trailing zeros). You may include an optional decimal point (up to 4 places) and optional thousands separators (commas). MUST contain no units or other characters.",
  "reasoning": "detailed explanation emphasizing why this is the CURRENT value and when it was last updated",
  "source_quotes": [
    {
      "url": "source URL",
      "quote": "exact text from source supporting the CURRENT value",
      "match_score": 0.98
    }
  ],
  "css_selector": "Precise CSS selector that targets the exact DOM node containing the numeric value on the FIRST source URL. Prefer stable ids or data-*; avoid volatile classes.",
  "xpath": "Precise XPath expression that targets the exact DOM node containing the numeric value on the FIRST source URL. Prefer label-anchored or id-anchored paths.",
  "javascript_extractor_b64": "Base64-encoded IIFE JavaScript that, when executed in the browser console on the FIRST source_quotes[0].url page, returns the metric's numeric value as a string. The decoded code must only use document.querySelector on the precise CSS selector, sanitize text to digits/.-, and return the cleaned string. No network requests, no async, no external libraries, no DOM mutations. Example (decoded): (function(){ const el = document.querySelector('CSS'); if(!el) return ''; const t = (el.textContent||''); const cleaned = t.replace(/[^0-9+\\-.,]/g,'').replace(/,/g,''); return cleaned; })();"
}

CONFIDENCE SCORING (heavily weighted for recency):
- 0.9-1.0: Multiple authoritative sources with CURRENT data (today/this week)
- 0.7-0.9: Good sources with recent data (this month) or real-time indicators
- 0.5-0.7: Limited current sources or data from last few months
- 0.3-0.5: Only historical data available or conflicting current information
- 0.0-0.3: No current data found, only outdated historical information

ASSET PRICE RULES (for asset_price_suggestion):
You are an expert in market design and contract specification. Your job is to determine the correct numeric "price per unit" for a market, based on the value shown at a specific settlement URL. You MUST follow these rules when deriving "asset_price_suggestion":

1) Identify the main numeric value on the settlement page.

2) If the value uses a globally recognized financial trading unit (e.g., USD per troy ounce, USD per barrel, USD per ton, USD per BTC), use the price exactly as shown with no scaling.

3) If the value represents a non-financial metric (e.g., population, GDP, emissions, macro indicators, real estate metrics):
   - If the number is below one million, use the value exactly as shown.
   - If the number is one million or larger, rescale it to the natural human unit normally used to discuss that metric (e.g., Population → billions; GDP → trillions; Emissions → billions of tons; Followers → millions). After rescaling, compute the new numeric price.

4) Never invent arbitrary scales. The rescaling must reflect the way people normally describe the metric (millions, billions, trillions).

5) After selecting the base price (unscaled or rescaled), ROUND/FORMAT the final value to up to 5 significant figures (using standard rounding). Do NOT pad with trailing zeros beyond what is natural. If decimals are required, use at most 4 decimal places.
   Examples:
   - 466        → 466
   - 8243.729   → 8243.7
   - 8.240437918→ 8.2404
   - 0.01234567 → 0.012346

6) asset_price_suggestion MUST contain ONLY the final numeric value (rescaled or unmodified) with up to 5 significant figures; no units and no commentary. Use only digits, an optional decimal point, and optional thousands separators (commas). Emit it as a JSON string.

ADDITIONAL RULES FOR LOCATORS & EXTRACTOR:
- The first entry in source_quotes MUST be the best/primary source you used.
- Return the extractor only in "javascript_extractor_b64" (base64). Do NOT include raw code blocks.
- The extractor MUST be designed to work on that first source URL.
- Prefer stable selectors (ids, data-* attrs) when possible. Do not rely on volatile class names if avoidable.
- Use the provided candidate locators to pick the most reliable CSS selector and XPath. Only emit css_selector/xpath if they directly resolve to the numeric node. If none are reliable, leave fields empty.

REJECT: Historical trends, past data points, outdated statistics, or archived information unless it's the only available current reference.`;
  }

  /**
   * Build the user prompt with metric data
   */
  private buildUserPrompt(input: AIResolverInput): string {
    const { metric, description, sources, scrapedSources } = input;
    
    let prompt = `METRIC TO RESOLVE: "${metric}"`;
    
    if (description) {
      prompt += `\nDESCRIPTION: ${description}`;
    }
    
    // Determine primary settlement URL for price computation context
    const sourceMap = new Map<string, ProcessedChunk[]>();
    sources.forEach(chunk => {
      if (!sourceMap.has(chunk.source_url)) {
        sourceMap.set(chunk.source_url, []);
      }
      sourceMap.get(chunk.source_url)!.push(chunk);
    });
    const primaryUrl = (scrapedSources && scrapedSources[0]?.url) || Array.from(sourceMap.keys())[0] || '';

    // Asset price determination context (for start price suggestion)
    if (primaryUrl) {
      prompt += `\n\nASSET PRICE DETERMINATION CONTEXT:\nYou are an expert in market design and contract specification. Your job is to determine the correct numeric "price per unit" for a market, based on the value shown at a specific URL.\n\nThe market is:\n${metric}\n\nThe settlement URL is:\n${primaryUrl}\n\nIMPORTANT FOR asset_price_suggestion:\n• You must output ONLY the final numeric price.\n• The final numeric price MUST have up to 5 significant figures (use standard rounding). Do not pad with trailing zeros. If decimals are required, use at most 4 decimal places.\n• You may use digits, an optional decimal point, and optional thousands separators (commas).\n• Do NOT output units.\n• Do NOT output any words, explanations, or symbols other than digits, an optional decimal point, and optional thousands separators (commas).\n• Output a single line only (as a JSON string for asset_price_suggestion).\n\nRULES YOU MUST FOLLOW (summarized; see system prompt for details):\n1) Identify the main numeric value on the settlement page.\n2) If value uses a recognized trading unit (e.g., USD per BTC/oz/barrel/ton), do NOT rescale.\n3) For non-financial metrics: if < 1,000,000 use as-is; if ≥ 1,000,000 rescale to the natural human unit (millions/billions/trillions) people use to discuss that metric, then use the rescaled value.\n4) Never invent arbitrary scales; only natural, commonly used scales.\n5) After selecting the base value, format to up to 5 significant figures.\n\nReturn your full JSON with asset_price_suggestion conforming to the above.`;
    }
    
    prompt += `\n\nSOURCE DATA:\n`;
    
    // Add the most relevant chunks from each source
    // (sourceMap already built above)
    
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
      
      // Append locator candidates summary for this source (top 5)
      const scraped = scrapedSources.find(s => s.url === url);
      if (scraped && Array.isArray(scraped.candidates) && scraped.candidates.length > 0) {
        const topCands = scraped.candidates.slice(0, 5);
        prompt += `\nLocator candidates (top ${topCands.length}):\n`;
        topCands.forEach((c, i) => {
          const trimmed = (c.text || '').slice(0, 160).replace(/\s+/g, ' ').trim();
          const htmlTrim = (c.html_snippet || '').slice(0, 600);
          prompt += `#${i+1}:\nCSS: ${c.selector}\nXPath: ${c.xpath}\nText: ${trimmed}\nHTML: ${htmlTrim}\n`;
        });
      }

      // Include raw HTML excerpt for the first source only to guide precise selection
      if (sourceIndex === 1 && scraped?.raw_html_excerpt) {
        const rawPreview = scraped.raw_html_excerpt.slice(0, 4000);
        prompt += `\nRAW_HTML_EXCERPT (truncated):\n${rawPreview}\n`;
      }

      sourceIndex++;
    }
    
    prompt += `\n\nTASK: Analyze the above sources and determine the most accurate current value for "${metric}". Return your analysis as valid JSON following the specified format. Ensure the first element in source_quotes is the primary URL. Using the provided locator candidates, choose a robust css_selector and xpath that directly resolve to the numeric node. Also include a javascript_extractor_b64 matching the chosen css selector.`;
    
    return prompt;
  }

  /**
   * Build the final metric resolution from AI result
   */
  private buildMetricResolution(input: AIResolverInput, aiResult: AIAnalysisResult): MetricResolution {
    // Map AI source quotes to resolution format
    const sources = aiResult.source_quotes.map(quote => {
      // Find matching scraped source for screenshot and locator candidates
      const scrapedSource = input.scrapedSources.find(s => s.url === quote.url);
      // Try to pick the best candidate matching the quoted text
      let css_selector: string | undefined;
      let xpath: string | undefined;
      let html_snippet: string | undefined;
      const candidates = scrapedSource?.candidates || [];
      if (candidates.length > 0) {
        // naive match by inclusion or highest text similarity
        const lowerQuote = (quote.quote || '').toLowerCase();
        let best = candidates[0];
        let bestScore = 0;
        candidates.forEach(c => {
          const text = (c.text || '').toLowerCase();
          let score = 0;
          if (text && lowerQuote) {
            if (text.includes(lowerQuote) || lowerQuote.includes(text)) score += 2;
            // length proximity bonus
            score += Math.max(0, 1 - Math.abs(text.length - lowerQuote.length) / Math.max(1, lowerQuote.length));
          }
          if (score > bestScore) { bestScore = score; best = c; }
        });
        css_selector = best.selector;
        xpath = best.xpath;
        html_snippet = best.html_snippet;
      }
      const sourceObj: any = {
        url: quote.url,
        screenshot_url: scrapedSource?.screenshot_url || '',
        quote: quote.quote,
        match_score: quote.match_score,
        css_selector,
        xpath,
        html_snippet
      };

      return sourceObj;
    });

    // Validate and sanitize AI response
    // Attach AI-provided locators and javascript_extractor to the first/best source when provided
    if (Array.isArray(sources) && sources.length > 0) {
      let extractor: string | undefined;
      if (aiResult.javascript_extractor_b64) {
        try {
          extractor = Buffer.from(aiResult.javascript_extractor_b64, 'base64').toString('utf8');
        } catch {}
      }
      if (!extractor && aiResult.javascript_extractor) {
        extractor = aiResult.javascript_extractor;
      }
      const primary = (sources[0] as any);
      if (extractor) primary.js_extractor = extractor;
      if (aiResult.css_selector) primary.css_selector = aiResult.css_selector;
      if (aiResult.xpath) primary.xpath = aiResult.xpath;
    }

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