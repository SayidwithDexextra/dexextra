import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { archiveUrl, type ArchiveProvider, type ProviderResult } from '@/lib/archive';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface ArchiveProviderResult {
  provider: ArchiveProvider;
  success: boolean;
  url?: string;
  timestamp?: string;
  durationMs?: number;
  error?: string;
}

interface EvidenceTestResult {
  url: string;
  metric: string;
  timestamp: string;
  mode: 'archive-first' | 'screenshot-first';
  phases: {
    phase0_archive_first?: {
      success: boolean;
      waybackUrl?: string;
      waybackTimestamp?: string;
      archiveTimeMs?: number;
      error?: string;
    };
    phase1_screenshot: {
      success: boolean;
      captureTimeMs?: number;
      screenshotSizeKb?: number;
      engine?: string;
      analyzedUrl?: string;
      error?: string;
    };
    phase2a_upload: {
      success: boolean;
      publicUrl?: string;
      storagePath?: string;
      error?: string;
    };
    phase2b_multi_archive: {
      screenshot: {
        success: boolean;
        primaryUrl?: string;
        primaryProvider?: ArchiveProvider;
        providers: ArchiveProviderResult[];
        archiveTimeMs?: number;
        error?: string;
      };
      sourcePage: {
        success: boolean;
        primaryUrl?: string;
        primaryProvider?: ArchiveProvider;
        providers: ArchiveProviderResult[];
        archiveTimeMs?: number;
        error?: string;
      };
    };
    phase2c_vision_analysis: {
      success: boolean;
      extractedValue?: string;
      numericValue?: number;
      confidence?: number;
      visualQuote?: string;
      model?: string;
      analysisTimeMs?: number;
      error?: string;
    };
    phase2d_dual_analysis?: {
      success: boolean;
      textExtractedValue?: number | null;
      visionExtractedValue?: number | null;
      extractionConfidenceMatch?: boolean;
      valueSource?: 'text' | 'vision' | 'consensus' | 'fallback';
      analysisTimeMs?: number;
      error?: string;
    };
  };
  congruence: {
    allPhasesSuccessful: boolean;
    screenshotAndWaybackMatch: boolean;
    aiAnalyzedArchivedContent: boolean;
    screenshotOfArchivedPage?: boolean;       // In archive-first mode: was screenshot taken OF the archived Wayback page?
    archiveFirstFlow: boolean;
    dualAnalysisEnabled: boolean;
    summary: string;
  };
  evidence: {
    primaryEvidenceUrl: string | null;        // The Wayback URL of the analyzed content (archive-first: the page, screenshot-first: the screenshot)
    secondaryEvidenceUrl: string | null;      // Secondary archive (the source page in both modes)
    screenshotWaybackUrl?: string | null;     // Wayback URL of the screenshot (supplementary in archive-first mode)
    screenshotPublicUrl: string | null;       // Supabase URL of the screenshot
    aiExtractedPrice: number | null;
    textExtractedPrice?: number | null;
    visionExtractedPrice?: number | null;
  };
}

// ─── Wayback URL Helpers ──────────────────────────────────────────────────────

/**
 * Convert a Wayback URL to its "raw" format (id_ suffix removes toolbar).
 * Example: https://web.archive.org/web/20260412033835/https://example.com
 *       -> https://web.archive.org/web/20260412033835id_/https://example.com
 */
function toRawWaybackUrl(url: string): string {
  const waybackMatch = url.match(/^(https:\/\/web\.archive\.org\/web\/\d+)(\/)(https?:\/\/.+)$/);
  if (waybackMatch) {
    return `${waybackMatch[1]}id_/${waybackMatch[3]}`;
  }
  return url;
}

/**
 * Extract the original URL from a Wayback URL.
 */
function extractOriginalUrl(waybackUrl: string): string | null {
  const match = waybackUrl.match(/^https:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/);
  return match ? match[1] : null;
}

/**
 * Check if a URL is a Wayback Machine URL.
 */
function isWaybackUrl(url: string): boolean {
  return url.includes('web.archive.org/web/');
}

// ─── Jina Screenshot Capture ─────────────────────────────────────────────────

interface JinaScreenshotResult {
  success: boolean;
  base64?: string;
  engine?: string;
  captureTimeMs: number;
  error?: string;
  actualUrl?: string;
}

async function screenshotWithJina(
  url: string,
  options: { timeoutMs?: number; fallbackToOriginal?: boolean } = {},
): Promise<JinaScreenshotResult> {
  const apiKey = process.env.JINA_API_KEY || '';
  const timeoutMs = options.timeoutMs || 45_000;
  const startTime = Date.now();
  const engines = ['direct', 'browser'];
  let lastError = '';

  // For Wayback URLs, try both the raw format and original URL as fallbacks
  const urlsToTry: string[] = [url];
  if (isWaybackUrl(url)) {
    // Try raw Wayback URL first (removes toolbar)
    const rawUrl = toRawWaybackUrl(url);
    if (rawUrl !== url) {
      urlsToTry.unshift(rawUrl);
    }
    // If all else fails and fallback is enabled, try the original URL
    if (options.fallbackToOriginal !== false) {
      const originalUrl = extractOriginalUrl(url);
      if (originalUrl) {
        urlsToTry.push(originalUrl);
      }
    }
  }

  for (const targetUrl of urlsToTry) {
    for (const engine of engines) {
      try {
        const headers: Record<string, string> = {
          'X-Return-Format': 'screenshot',
          'X-Timeout': '30',
        };
        if (engine !== 'default') headers['X-Engine'] = engine;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        console.log(`[test-evidence] Capturing screenshot: ${targetUrl} (engine=${engine})`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          lastError = `Jina returned ${res.status} for ${targetUrl}`;
          console.log(`[test-evidence] Screenshot failed: ${lastError}`);
          continue;
        }

        const contentType = res.headers.get('content-type') || '';

        if (contentType.includes('image')) {
          const buffer = await res.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          console.log(`[test-evidence] Screenshot SUCCESS for ${targetUrl}`);
          return { success: true, base64, engine, captureTimeMs: Date.now() - startTime, actualUrl: targetUrl };
        }

        if (contentType.includes('application/json')) {
          const json = await res.json();
          const data = json.data || json;
          if (data.screenshotUrl) {
            const imgRes = await fetch(data.screenshotUrl);
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              const base64 = Buffer.from(buffer).toString('base64');
              console.log(`[test-evidence] Screenshot SUCCESS (via URL) for ${targetUrl}`);
              return { success: true, base64, engine, captureTimeMs: Date.now() - startTime, actualUrl: targetUrl };
            }
          }
        }

        lastError = `No image returned from engine=${engine} for ${targetUrl}`;
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err?.message || String(err);
        console.log(`[test-evidence] Screenshot error: ${lastError}`);
      }
    }
  }

  return { success: false, error: lastError, captureTimeMs: Date.now() - startTime };
}

// ─── Screenshot Upload ───────────────────────────────────────────────────────

interface UploadResult {
  success: boolean;
  publicUrl?: string;
  storagePath?: string;
  error?: string;
}

async function uploadScreenshot(base64Data: string, jobId: string, sourceUrl: string): Promise<UploadResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: 'Supabase not configured' };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Include timestamp in filename to ensure each screenshot is unique
  const urlHash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
  const timestamp = Date.now();
  const storagePath = `${jobId}/${urlHash}-${timestamp}.png`;
  const buffer = Buffer.from(base64Data, 'base64');

  const { data, error } = await supabase.storage
    .from('metric-oracle-screenshots')
    .upload(storagePath, buffer, {
      contentType: 'image/png',
      cacheControl: '0',  // No caching - always fresh
      upsert: false,      // Don't overwrite - fail if exists (shouldn't with timestamp)
    });

  if (error) {
    return { success: false, error: error.message };
  }

  const { data: urlData } = supabase.storage
    .from('metric-oracle-screenshots')
    .getPublicUrl(storagePath);

  return { success: true, publicUrl: urlData.publicUrl, storagePath: data.path };
}

// ─── Vision Analysis (OpenAI GPT-4 Vision) ───────────────────────────────────

interface VisionResult {
  success: boolean;
  extractedValue?: string;
  numericValue?: number;
  confidence?: number;
  visualQuote?: string;
  model?: string;
  error?: string;
}

async function analyzeWithVision(base64: string, metric: string): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }

  const prompt = `You are analyzing a screenshot to extract a specific numeric value.

METRIC TO FIND: "${metric}"

TASK: Find the current numeric value for this metric displayed in the image.

Return ONLY a JSON object with these fields:
{
  "value": "the extracted value as a string",
  "numericValue": 123.45,
  "confidence": 0.95,
  "visualQuote": "exact text from the image that shows this value"
}

If you cannot find the value, return:
{
  "value": null,
  "numericValue": null,
  "confidence": 0,
  "visualQuote": "reason why value was not found"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `OpenAI API error: ${response.status} - ${errorText.slice(0, 200)}` };
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';
    
    let parsed: any;
    try {
      const cleanContent = content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleanContent);
    } catch {
      return { success: false, error: `Failed to parse vision response: ${content.slice(0, 200)}` };
    }

    if (parsed.numericValue !== null && parsed.numericValue !== undefined) {
      return {
        success: true,
        extractedValue: parsed.value,
        numericValue: Number(parsed.numericValue),
        confidence: parsed.confidence,
        visualQuote: parsed.visualQuote,
        model: 'gpt-4o',
      };
    }

    return {
      success: false,
      visualQuote: parsed.visualQuote,
      error: 'No numeric value extracted',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ─── Text Extraction from Content (for Dual Analysis) ────────────────────────

async function extractTextValue(content: string, metric: string): Promise<number | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  
  const prompt = `You are extracting a precise numeric value from archived webpage content.

METRIC TO EXTRACT: "${metric}"

INSTRUCTIONS:
1. Find the EXACT current value for the specified metric in the content below
2. Return ONLY the numeric value (no currency symbols, units, or text)
3. Use decimal notation (e.g., 95123.45, not "$95,123.45")
4. If multiple values exist, use the most recent/current one
5. If the value cannot be found, respond with "NOT_FOUND"

CONTENT:
${content.slice(0, 30_000)}

EXTRACTED NUMERIC VALUE:`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0,
      }),
    });

    if (!response.ok) return null;

    const json = await response.json();
    const extractedText = json.choices?.[0]?.message?.content?.trim() || '';

    if (extractedText === 'NOT_FOUND' || !extractedText) return null;

    const cleanedValue = extractedText.replace(/[^0-9.+-]/g, '');
    const numericValue = parseFloat(cleanedValue);

    return Number.isFinite(numericValue) ? numericValue : null;
  } catch {
    return null;
  }
}

// ─── Fetch Text Content via Jina Reader ───────────────────────────────────────

async function fetchTextWithJina(url: string): Promise<string | null> {
  const apiKey = process.env.JINA_API_KEY || '';
  
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    
    if (!res.ok) return null;
    
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text')) {
      return await res.text();
    }
    if (contentType.includes('application/json')) {
      const json = await res.json();
      return json.data?.content || json.content || null;
    }
    
    return null;
  } catch {
    return null;
  }
}

// ─── Main Test Route ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.url) {
    return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 });
  }

  const { 
    url, 
    metric = 'Current Price',
    archiveFirst = false,
    dualAnalysis = false,
    verbose = false,
  } = body;
  
  const jobId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  
  // Determine flow mode
  const useArchiveFirst = archiveFirst === true || archiveFirst === 'true';
  const useDualAnalysis = dualAnalysis === true || dualAnalysis === 'true' || useArchiveFirst;

  const result: EvidenceTestResult = {
    url,
    metric,
    timestamp: new Date().toISOString(),
    mode: useArchiveFirst ? 'archive-first' : 'screenshot-first',
    phases: {
      phase1_screenshot: { success: false },
      phase2a_upload: { success: false },
      phase2b_multi_archive: {
        screenshot: { success: false, providers: [] },
        sourcePage: { success: false, providers: [] },
      },
      phase2c_vision_analysis: { success: false },
    },
    congruence: {
      allPhasesSuccessful: false,
      screenshotAndWaybackMatch: false,
      aiAnalyzedArchivedContent: false,
      archiveFirstFlow: useArchiveFirst,
      dualAnalysisEnabled: useDualAnalysis,
      summary: '',
    },
    evidence: {
      primaryEvidenceUrl: null,
      secondaryEvidenceUrl: null,
      screenshotPublicUrl: null,
      aiExtractedPrice: null,
    },
  };

  let screenshotBase64: string | null = null;
  let screenshotPublicUrl: string | null = null;
  let waybackUrl: string | null = null;
  let analyzedUrl = url;
  let textContent: string | null = null;

  // ─── Phase 0: Archive-First (Try to archive live page, fall back to live screenshot) ───
  let archiveFirstFailed = false;
  
  if (useArchiveFirst) {
    console.log(`[test-settlement-evidence] Phase 0: ARCHIVE-FIRST - Attempting to archive live page`);
    const phase0Start = Date.now();
    
    try {
      const archiveResult = await archiveUrl(url, {
        totalTimeoutMs: 30_000,       // 30s - don't wait too long
        providerTimeoutMs: 25_000,
        maxAgeMs: 2 * 60 * 1000,      // Require fresh archive (< 2 minutes old)
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });
      
      if (archiveResult.success && archiveResult.primaryUrl) {
        waybackUrl = archiveResult.primaryUrl;
        analyzedUrl = waybackUrl;
        
        result.phases.phase0_archive_first = {
          success: true,
          waybackUrl,
          waybackTimestamp: archiveResult.archives.find(a => a.provider === 'internet_archive' && a.success)?.timestamp,
          archiveTimeMs: Date.now() - phase0Start,
        };
        result.evidence.primaryEvidenceUrl = waybackUrl;
        
        console.log(`[test-settlement-evidence] Phase 0 SUCCESS: Fresh archive ${waybackUrl}`);
        
        // Wait for Wayback to be accessible
        console.log(`[test-settlement-evidence] Waiting 3s for Wayback availability...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } else {
        // Archive failed or returned stale - fall back to live URL screenshot
        archiveFirstFailed = true;
        result.phases.phase0_archive_first = {
          success: false,
          archiveTimeMs: Date.now() - phase0Start,
          error: archiveResult.error || 'No fresh archive available',
        };
        console.warn(`[test-settlement-evidence] Phase 0: No fresh archive available (${archiveResult.error})`);
        console.log(`[test-settlement-evidence] Phase 0: FALLBACK - Will screenshot live URL and archive the screenshot`);
        analyzedUrl = url; // Use live URL
      }
    } catch (err: any) {
      archiveFirstFailed = true;
      result.phases.phase0_archive_first = {
        success: false,
        archiveTimeMs: Date.now() - phase0Start,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 0 ERROR:`, err?.message);
      console.log(`[test-settlement-evidence] Phase 0: FALLBACK - Will screenshot live URL and archive the screenshot`);
      analyzedUrl = url; // Use live URL
    }
  }

  // ─── Phase 1: Capture Screenshot (of archived URL in archive-first mode) ────
  console.log(`[test-settlement-evidence] Phase 1: Capturing screenshot for ${analyzedUrl}`);
  const phase1Start = Date.now();
  
  try {
    // In archive-first mode, also fetch text content for dual analysis
    const [screenshotResult, fetchedText] = await Promise.all([
      screenshotWithJina(analyzedUrl, { timeoutMs: 45_000 }),
      useDualAnalysis ? fetchTextWithJina(analyzedUrl) : Promise.resolve(null),
    ]);
    
    textContent = fetchedText;
    
    if (screenshotResult.success && screenshotResult.base64) {
      screenshotBase64 = screenshotResult.base64;
      const sizeKb = Math.round(screenshotBase64.length * 0.75 / 1024);
      result.phases.phase1_screenshot = {
        success: true,
        captureTimeMs: screenshotResult.captureTimeMs,
        screenshotSizeKb: sizeKb,
        engine: screenshotResult.engine,
        analyzedUrl,
      };
      console.log(`[test-settlement-evidence] Phase 1 SUCCESS: ${sizeKb}KB screenshot captured (engine=${screenshotResult.engine})`);
      if (textContent) {
        console.log(`[test-settlement-evidence] Phase 1: Also fetched ${textContent.length} chars of text content`);
      }
    } else {
      result.phases.phase1_screenshot = {
        success: false,
        captureTimeMs: Date.now() - phase1Start,
        analyzedUrl,
        error: screenshotResult.error || 'Unknown screenshot error',
      };
      console.warn(`[test-settlement-evidence] Phase 1 FAILED: ${screenshotResult.error}`);
    }
  } catch (err: any) {
    result.phases.phase1_screenshot = {
      success: false,
      captureTimeMs: Date.now() - phase1Start,
      analyzedUrl,
      error: err?.message || String(err),
    };
    console.error(`[test-settlement-evidence] Phase 1 ERROR:`, err?.message);
  }

  // ─── Phase 2a: Upload Screenshot to Supabase ───────────────────────────────
  if (screenshotBase64) {
    console.log(`[test-settlement-evidence] Phase 2a: Uploading screenshot to Supabase`);
    
    try {
      const uploadResult = await uploadScreenshot(screenshotBase64, jobId, url);
      
      if (uploadResult.success && uploadResult.publicUrl) {
        screenshotPublicUrl = uploadResult.publicUrl;
        result.phases.phase2a_upload = {
          success: true,
          publicUrl: screenshotPublicUrl,
          storagePath: uploadResult.storagePath,
        };
        result.evidence.screenshotPublicUrl = screenshotPublicUrl;
        console.log(`[test-settlement-evidence] Phase 2a SUCCESS: ${screenshotPublicUrl}`);
      } else {
        result.phases.phase2a_upload = {
          success: false,
          error: uploadResult.error || 'Upload failed',
        };
        console.warn(`[test-settlement-evidence] Phase 2a FAILED: ${uploadResult.error}`);
      }
    } catch (err: any) {
      result.phases.phase2a_upload = {
        success: false,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 2a ERROR:`, err?.message);
    }
  }

  // ─── Phase 2b: Multi-Archive (Belt & Suspenders - IA + Archive.today) ───────
  console.log(`[test-settlement-evidence] Phase 2b: Multi-archiving (Internet Archive + Archive.today)`);

  // Archive screenshot (PRIMARY evidence) to multiple providers via unified API
  if (screenshotPublicUrl) {
    const archiveStart = Date.now();
    try {
      const archiveResult = await archiveUrl(screenshotPublicUrl, {
        totalTimeoutMs: 45_000,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      
      const providerResults: ArchiveProviderResult[] = archiveResult.archives.map((a: ProviderResult) => ({
        provider: a.provider,
        success: a.success,
        url: a.url,
        timestamp: a.timestamp,
        durationMs: a.durationMs,
        error: a.error,
      }));

      if (archiveResult.success && archiveResult.primaryUrl) {
        result.phases.phase2b_multi_archive.screenshot = {
          success: true,
          primaryUrl: archiveResult.primaryUrl,
          primaryProvider: archiveResult.primaryProvider,
          providers: providerResults,
          archiveTimeMs: Date.now() - archiveStart,
        };
        // Store the screenshot's Wayback URL
        result.evidence.screenshotWaybackUrl = archiveResult.primaryUrl;
        
        // In archive-first mode with successful page archive, the primary evidence is the archived PAGE
        // But if archive-first FAILED (fallback mode), the screenshot IS the primary evidence
        if (useArchiveFirst && archiveFirstFailed) {
          // Fallback mode: screenshot of live URL is our primary evidence
          result.evidence.primaryEvidenceUrl = archiveResult.primaryUrl;
          console.log(`[test-settlement-evidence] Phase 2b: Fallback mode - screenshot archive is PRIMARY evidence`);
        } else if (!useArchiveFirst || !result.evidence.primaryEvidenceUrl) {
          result.evidence.primaryEvidenceUrl = archiveResult.primaryUrl;
        }
        const successCount = providerResults.filter(p => p.success).length;
        console.log(`[test-settlement-evidence] Phase 2b Screenshot Archive SUCCESS: ${successCount}/${providerResults.length} providers → ${archiveResult.primaryUrl}`);
      } else {
        result.phases.phase2b_multi_archive.screenshot = {
          success: false,
          providers: providerResults,
          archiveTimeMs: Date.now() - archiveStart,
          error: archiveResult.error || 'All providers failed',
        };
        console.warn(`[test-settlement-evidence] Phase 2b Screenshot Archive FAILED: ${archiveResult.error}`);
      }
    } catch (err: any) {
      result.phases.phase2b_multi_archive.screenshot = {
        success: false,
        providers: [],
        archiveTimeMs: Date.now() - archiveStart,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 2b Screenshot Archive ERROR:`, err?.message);
    }
  }

  // Archive source page (SECONDARY evidence) to multiple providers via unified API
  const pageArchiveStart = Date.now();
  try {
    const pageArchiveResult = await archiveUrl(url, {
      totalTimeoutMs: 60_000,       // 60s total - live pages take longer
      providerTimeoutMs: 55_000,    // 55s per provider
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const providerResults: ArchiveProviderResult[] = pageArchiveResult.archives.map((a: ProviderResult) => ({
      provider: a.provider,
      success: a.success,
      url: a.url,
      timestamp: a.timestamp,
      durationMs: a.durationMs,
      error: a.error,
    }));

    if (pageArchiveResult.success && pageArchiveResult.primaryUrl) {
      result.phases.phase2b_multi_archive.sourcePage = {
        success: true,
        primaryUrl: pageArchiveResult.primaryUrl,
        primaryProvider: pageArchiveResult.primaryProvider,
        providers: providerResults,
        archiveTimeMs: Date.now() - pageArchiveStart,
      };
      result.evidence.secondaryEvidenceUrl = pageArchiveResult.primaryUrl;
      const successCount = providerResults.filter(p => p.success).length;
      console.log(`[test-settlement-evidence] Phase 2b Page Archive SUCCESS: ${successCount}/${providerResults.length} providers → ${pageArchiveResult.primaryUrl}`);
    } else {
      result.phases.phase2b_multi_archive.sourcePage = {
        success: false,
        providers: providerResults,
        archiveTimeMs: Date.now() - pageArchiveStart,
        error: pageArchiveResult.error || 'All providers failed',
      };
      console.warn(`[test-settlement-evidence] Phase 2b Page Archive FAILED: ${pageArchiveResult.error}`);
    }
  } catch (err: any) {
    result.phases.phase2b_multi_archive.sourcePage = {
      success: false,
      providers: [],
      archiveTimeMs: Date.now() - pageArchiveStart,
      error: err?.message || String(err),
    };
    console.error(`[test-settlement-evidence] Phase 2b Page Archive ERROR:`, err?.message);
  }

  // ─── Phase 2c: Vision Analysis (AI extracts value from screenshot) ─────────
  let visionExtractedValue: number | null = null;
  
  if (screenshotBase64) {
    console.log(`[test-settlement-evidence] Phase 2c: Running vision analysis on screenshot`);
    const visionStart = Date.now();
    
    try {
      const visionResult = await analyzeWithVision(screenshotBase64, metric);
      
      if (visionResult.success && visionResult.numericValue !== undefined) {
        visionExtractedValue = visionResult.numericValue;
        result.phases.phase2c_vision_analysis = {
          success: true,
          extractedValue: visionResult.extractedValue,
          numericValue: visionResult.numericValue,
          confidence: visionResult.confidence,
          visualQuote: visionResult.visualQuote,
          model: visionResult.model,
          analysisTimeMs: Date.now() - visionStart,
        };
        result.evidence.aiExtractedPrice = visionResult.numericValue;
        result.evidence.visionExtractedPrice = visionResult.numericValue;
        console.log(`[test-settlement-evidence] Phase 2c SUCCESS: value=${visionResult.numericValue}, confidence=${visionResult.confidence?.toFixed(2)}`);
      } else {
        result.phases.phase2c_vision_analysis = {
          success: false,
          visualQuote: visionResult.visualQuote,
          analysisTimeMs: Date.now() - visionStart,
          error: visionResult.error || 'No value extracted',
        };
        console.warn(`[test-settlement-evidence] Phase 2c FAILED: ${visionResult.error}`);
      }
    } catch (err: any) {
      result.phases.phase2c_vision_analysis = {
        success: false,
        analysisTimeMs: Date.now() - visionStart,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 2c ERROR:`, err?.message);
    }
  }

  // ─── Phase 2d: Dual Analysis (Text + Vision Comparison) ─────────────────────
  let textExtractedValue: number | null = null;
  let extractionConfidenceMatch = false;
  let valueSource: 'text' | 'vision' | 'consensus' | 'fallback' = 'fallback';
  
  if (useDualAnalysis && textContent) {
    console.log(`[test-settlement-evidence] Phase 2d: Running dual analysis (text extraction)`);
    const dualStart = Date.now();
    
    try {
      textExtractedValue = await extractTextValue(textContent, metric);
      result.evidence.textExtractedPrice = textExtractedValue;
      
      if (textExtractedValue !== null && visionExtractedValue !== null) {
        const tolerance = 0.01; // 1% tolerance
        const diff = Math.abs(textExtractedValue - visionExtractedValue);
        const maxVal = Math.max(Math.abs(textExtractedValue), Math.abs(visionExtractedValue));
        const relativeDiff = maxVal > 0 ? diff / maxVal : 0;
        
        extractionConfidenceMatch = relativeDiff < tolerance;
        
        if (extractionConfidenceMatch) {
          valueSource = 'consensus';
          console.log(`[test-settlement-evidence] Phase 2d SUCCESS: Text and Vision AGREE (diff=${(relativeDiff * 100).toFixed(3)}%)`);
        } else {
          valueSource = 'vision';
          console.warn(`[test-settlement-evidence] Phase 2d: Text/Vision MISMATCH (diff=${(relativeDiff * 100).toFixed(3)}%), using vision`);
        }
        
        result.phases.phase2d_dual_analysis = {
          success: true,
          textExtractedValue,
          visionExtractedValue,
          extractionConfidenceMatch,
          valueSource,
          analysisTimeMs: Date.now() - dualStart,
        };
      } else if (visionExtractedValue !== null) {
        valueSource = 'vision';
        result.phases.phase2d_dual_analysis = {
          success: true,
          textExtractedValue: null,
          visionExtractedValue,
          extractionConfidenceMatch: false,
          valueSource: 'vision',
          analysisTimeMs: Date.now() - dualStart,
        };
        console.log(`[test-settlement-evidence] Phase 2d: Using vision only (text extraction unavailable)`);
      } else if (textExtractedValue !== null) {
        valueSource = 'text';
        result.evidence.aiExtractedPrice = textExtractedValue;
        result.phases.phase2d_dual_analysis = {
          success: true,
          textExtractedValue,
          visionExtractedValue: null,
          extractionConfidenceMatch: false,
          valueSource: 'text',
          analysisTimeMs: Date.now() - dualStart,
        };
        console.log(`[test-settlement-evidence] Phase 2d: Using text only (vision extraction unavailable)`);
      } else {
        result.phases.phase2d_dual_analysis = {
          success: false,
          textExtractedValue: null,
          visionExtractedValue: null,
          extractionConfidenceMatch: false,
          valueSource: 'fallback',
          analysisTimeMs: Date.now() - dualStart,
          error: 'Both text and vision extraction failed',
        };
        console.warn(`[test-settlement-evidence] Phase 2d FAILED: Both extractions failed`);
      }
    } catch (err: any) {
      result.phases.phase2d_dual_analysis = {
        success: false,
        analysisTimeMs: Date.now() - dualStart,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 2d ERROR:`, err?.message);
    }
  }

  // ─── Congruence Analysis ───────────────────────────────────────────────────
  const archiveFirstSucceeded = useArchiveFirst && result.phases.phase0_archive_first?.success === true;
  
  // For dual analysis, success means at least ONE extraction method worked
  const hasExtractedValue = 
    result.phases.phase2c_vision_analysis.success || 
    (result.phases.phase2d_dual_analysis?.success && 
     (result.phases.phase2d_dual_analysis.textExtractedValue !== null || 
      result.phases.phase2d_dual_analysis.visionExtractedValue !== null));
  
  const allPhasesSuccessful = 
    result.phases.phase1_screenshot.success &&
    result.phases.phase2a_upload.success &&
    result.phases.phase2b_multi_archive.screenshot.success &&
    hasExtractedValue &&
    (!useArchiveFirst || archiveFirstSucceeded);

  const screenshotAndWaybackMatch = 
    result.phases.phase2a_upload.success &&
    result.phases.phase2b_multi_archive.screenshot.success;

  // In archive-first mode, verify the screenshot was taken OF the archived page
  const screenshotOfArchivedPage = useArchiveFirst
    ? (result.phases.phase1_screenshot.analyzedUrl === result.phases.phase0_archive_first?.waybackUrl)
    : true;

  const aiAnalyzedArchivedContent = useArchiveFirst 
    ? archiveFirstSucceeded && result.phases.phase1_screenshot.success && hasExtractedValue && screenshotOfArchivedPage
    : result.phases.phase1_screenshot.success &&
      result.phases.phase2b_multi_archive.screenshot.success &&
      hasExtractedValue;

  // In fallback mode: screenshot of live URL was archived - this is still valid evidence
  const fallbackEvidenceCollected = useArchiveFirst && 
    archiveFirstFailed && 
    result.phases.phase1_screenshot.success &&
    result.phases.phase2b_multi_archive.screenshot.success &&
    hasExtractedValue;

  // Count successful archive providers
  const screenshotProviderCount = result.phases.phase2b_multi_archive.screenshot.providers.filter(p => p.success).length;
  const pageProviderCount = result.phases.phase2b_multi_archive.sourcePage.providers.filter(p => p.success).length;

  let summary = '';
  if (useArchiveFirst && archiveFirstSucceeded && allPhasesSuccessful) {
    const dualInfo = useDualAnalysis 
      ? (extractionConfidenceMatch 
          ? ' Text/Vision values MATCH.' 
          : ` Value extracted via ${valueSource}.`)
      : '';
    summary = `ARCHIVE-FIRST CONGRUENT: Live page archived FIRST, then analyzed.${dualInfo} Perfect evidence congruence achieved.`;
  } else if (fallbackEvidenceCollected) {
    // Fallback succeeded - we have archived screenshot of live page
    const dualInfo = useDualAnalysis 
      ? (extractionConfidenceMatch 
          ? ' Text/Vision values MATCH.' 
          : ` Value extracted via ${valueSource}.`)
      : '';
    summary = `SCREENSHOT-FALLBACK CONGRUENT: No fresh page archive available, but live screenshot captured and archived.${dualInfo} Evidence preserved.`;
  } else if (allPhasesSuccessful) {
    summary = `CONGRUENT: Screenshot archived to ${screenshotProviderCount} provider(s), AI analysis aligned. Belt & suspenders redundancy achieved.`;
  } else if (aiAnalyzedArchivedContent) {
    summary = `PARTIAL: Screenshot archived to ${screenshotProviderCount} provider(s) and analyzed by AI. Some secondary phases may have failed.`;
  } else if (screenshotAndWaybackMatch && !hasExtractedValue) {
    summary = `PARTIAL: Screenshot archived to ${screenshotProviderCount} provider(s), but value extraction failed (neither text nor vision could extract a numeric value).`;
  } else if (screenshotAndWaybackMatch) {
    summary = `PARTIAL: Screenshot archived to ${screenshotProviderCount} provider(s), but AI analysis failed.`;
  } else if (result.phases.phase1_screenshot.success) {
    summary = 'PARTIAL: Screenshot was captured but multi-archival or analysis failed.';
  } else {
    summary = 'FAILED: Screenshot capture failed. No evidence was collected.';
  }

  // Update allPhasesSuccessful to include fallback case
  const effectiveSuccess = allPhasesSuccessful || fallbackEvidenceCollected;

  result.congruence = {
    allPhasesSuccessful: effectiveSuccess,
    screenshotAndWaybackMatch,
    aiAnalyzedArchivedContent: aiAnalyzedArchivedContent || fallbackEvidenceCollected,
    screenshotOfArchivedPage: useArchiveFirst ? (archiveFirstSucceeded ? screenshotOfArchivedPage : false) : undefined,
    archiveFirstFlow: useArchiveFirst && archiveFirstSucceeded,
    dualAnalysisEnabled: useDualAnalysis,
    summary,
  };

  const totalTimeMs = Date.now() - started;
  console.log(`[test-settlement-evidence] Complete in ${totalTimeMs}ms`, {
    effectiveSuccess,
    archiveFirstSucceeded,
    fallbackUsed: archiveFirstFailed,
    primaryEvidence: result.evidence.primaryEvidenceUrl,
    aiPrice: result.evidence.aiExtractedPrice,
  });

  // Build evidence summary - belt and suspenders = Wayback + Supabase screenshot
  const waybackPageUrl = result.phases.phase2b_multi_archive.sourcePage.providers
    .find(p => p.provider === 'internet_archive' && p.success)?.url || null;
  const waybackScreenshotUrl = result.phases.phase2b_multi_archive.screenshot.providers
    .find(p => p.provider === 'internet_archive' && p.success)?.url || null;
  const supabaseScreenshotUrl = result.evidence.screenshotPublicUrl;

  // Build simplified response
  const simplifiedResponse = {
    ok: effectiveSuccess,
    url,
    metric,
    timestamp: result.timestamp,
    totalTimeMs,
    
    // Extracted value
    extractedValue: result.evidence.aiExtractedPrice,
    valueSource: result.phases.phase2d_dual_analysis?.valueSource || 
                 (result.phases.phase2c_vision_analysis.success ? 'vision' : null),
    confidence: result.phases.phase2d_dual_analysis?.extractionConfidenceMatch 
                ? 'high' 
                : (result.phases.phase2c_vision_analysis.confidence 
                   ? (result.phases.phase2c_vision_analysis.confidence >= 0.8 ? 'high' : 'medium')
                   : 'low'),
    
    // Flow info
    flow: archiveFirstSucceeded ? 'archive-first' : (archiveFirstFailed ? 'screenshot-fallback' : 'screenshot-first'),
    
    // Belt and suspenders: redundant evidence sources
    evidence: {
      // Source 1: Wayback Machine (public, immutable, third-party)
      wayback: {
        page: waybackPageUrl,
        screenshot: waybackScreenshotUrl,
      },
      // Source 2: Supabase (self-hosted, immediate, always available)
      supabase: {
        screenshot: supabaseScreenshotUrl,
      },
      // Summary
      redundancy: waybackPageUrl && supabaseScreenshotUrl 
        ? '2 sources (Wayback + Supabase)' 
        : supabaseScreenshotUrl 
          ? '1 source (Supabase only)' 
          : 'No evidence captured',
    },
    
    summary,
    
    // Only include errors if something failed
    ...(effectiveSuccess ? {} : {
      errors: {
        archiveError: result.phases.phase0_archive_first?.error,
        screenshotError: result.phases.phase1_screenshot.error,
        analysisError: result.phases.phase2c_vision_analysis.error,
      }
    }),
  };

  // Return verbose response if requested
  if (verbose === true || verbose === 'true') {
    return NextResponse.json({
      ...simplifiedResponse,
      details: {
        phases: result.phases,
        congruence: result.congruence,
        evidence: result.evidence,
      }
    });
  }

  return NextResponse.json(simplifiedResponse);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const metric = req.nextUrl.searchParams.get('metric') || 'Current Price';
  const archiveFirst = req.nextUrl.searchParams.get('archiveFirst') === 'true';
  const dualAnalysis = req.nextUrl.searchParams.get('dualAnalysis') === 'true';
  const verbose = req.nextUrl.searchParams.get('verbose') === 'true';

  if (!url) {
    return NextResponse.json({
      error: 'Missing required query parameter: url',
      usage: {
        method: 'GET or POST',
        endpoint: '/api/debug/test-settlement-evidence',
        queryParams: {
          url: 'Required - The URL to test (e.g., https://example.com/price-page)',
          metric: 'Optional - The metric name to extract (default: "Current Price")',
          archiveFirst: 'Optional - Enable archive-first flow (default: false). Archives live page FIRST, then analyzes the archived Wayback URL.',
          dualAnalysis: 'Optional - Enable dual analysis (default: false, auto-enabled with archiveFirst). Extracts values from both text and vision for comparison.',
        },
        postBody: {
          url: 'Required - The URL to test',
          metric: 'Optional - The metric name to extract',
          archiveFirst: 'Optional - Enable archive-first flow (default: false)',
          dualAnalysis: 'Optional - Enable dual analysis (default: false)',
        },
        examples: [
          '/api/debug/test-settlement-evidence?url=https://www.coingecko.com/en/coins/bitcoin&metric=Bitcoin Price',
          '/api/debug/test-settlement-evidence?url=https://finance.yahoo.com/quote/AAPL&metric=Apple Stock Price',
          '/api/debug/test-settlement-evidence?url=https://www.coingecko.com/en/coins/bitcoin&metric=Bitcoin Price&archiveFirst=true',
          '/api/debug/test-settlement-evidence?url=https://www.coingecko.com/en/coins/bitcoin&metric=Bitcoin Price&dualAnalysis=true',
        ],
        description: 'Tests the settlement evidence capture pipeline with "belt & suspenders" multi-archiving to Internet Archive AND Archive.today.',
        modes: {
          'screenshot-first': 'Default mode: Screenshot live page → Upload → Archive screenshot → AI analysis',
          'archive-first': 'Archive live page FIRST → Screenshot archived URL → AI analysis. Ensures perfect congruence between evidence and extracted value.',
        },
        phases: {
          'Phase 0': '(archive-first only) Archive live page to Wayback Machine FIRST',
          'Phase 1': 'Screenshot capture via Jina Reader (of archived URL in archive-first mode)',
          'Phase 2a': 'Upload screenshot to Supabase storage',
          'Phase 2b': 'Multi-archive screenshot + source page to Internet Archive AND Archive.today (belt & suspenders)',
          'Phase 2c': 'AI vision analysis to extract numeric value from screenshot',
          'Phase 2d': '(dual analysis) Text extraction + comparison with vision for confidence',
        },
        archiveProviders: ['internet_archive', 'archive_today'],
        congruence: 'All phases must succeed with the AI analyzing the SAME content that was archived. In archive-first mode, the AI analyzes the archived Wayback URL, ensuring perfect congruence.',
      },
    }, { status: 400 });
  }

  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ url, metric, archiveFirst, dualAnalysis, verbose }),
  });

  return POST(mockReq);
}
