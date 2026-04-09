import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { archivePage } from '@/lib/archivePage';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface EvidenceTestResult {
  url: string;
  metric: string;
  timestamp: string;
  phases: {
    phase1_screenshot: {
      success: boolean;
      captureTimeMs?: number;
      screenshotSizeKb?: number;
      engine?: string;
      error?: string;
    };
    phase2a_upload: {
      success: boolean;
      publicUrl?: string;
      storagePath?: string;
      error?: string;
    };
    phase2b_wayback_archive: {
      screenshot: {
        success: boolean;
        waybackUrl?: string;
        waybackTimestamp?: string;
        archiveTimeMs?: number;
        error?: string;
      };
      sourcePage: {
        success: boolean;
        waybackUrl?: string;
        waybackTimestamp?: string;
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
  };
  congruence: {
    allPhasesSuccessful: boolean;
    screenshotAndWaybackMatch: boolean;
    aiAnalyzedArchivedContent: boolean;
    summary: string;
  };
  evidence: {
    primaryEvidenceUrl: string | null;
    secondaryEvidenceUrl: string | null;
    screenshotPublicUrl: string | null;
    aiExtractedPrice: number | null;
  };
}

// ─── Jina Screenshot Capture ─────────────────────────────────────────────────

interface JinaScreenshotResult {
  success: boolean;
  base64?: string;
  engine?: string;
  captureTimeMs: number;
  error?: string;
}

async function screenshotWithJina(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<JinaScreenshotResult> {
  const apiKey = process.env.JINA_API_KEY || '';
  const timeoutMs = options.timeoutMs || 45_000;
  const startTime = Date.now();
  const engines = ['direct', 'browser'];
  let lastError = '';

  for (const engine of engines) {
    try {
      const headers: Record<string, string> = {
        'X-Return-Format': 'screenshot',
        'X-Timeout': '30',
      };
      if (engine !== 'default') headers['X-Engine'] = engine;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      console.log(`[test-evidence] Capturing screenshot: ${url} (engine=${engine})`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        lastError = `Jina returned ${res.status}`;
        continue;
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('image')) {
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return { success: true, base64, engine, captureTimeMs: Date.now() - startTime };
      }

      if (contentType.includes('application/json')) {
        const json = await res.json();
        const data = json.data || json;
        if (data.screenshotUrl) {
          const imgRes = await fetch(data.screenshotUrl);
          if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            return { success: true, base64, engine, captureTimeMs: Date.now() - startTime };
          }
        }
      }

      lastError = `No image returned from engine=${engine}`;
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err?.message || String(err);
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

  const urlHash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
  const storagePath = `${jobId}/${urlHash}.png`;
  const buffer = Buffer.from(base64Data, 'base64');

  const { data, error } = await supabase.storage
    .from('metric-oracle-screenshots')
    .upload(storagePath, buffer, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
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

// ─── Main Test Route ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.url) {
    return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 });
  }

  const { url, metric = 'Current Price' } = body;
  const jobId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();

  const result: EvidenceTestResult = {
    url,
    metric,
    timestamp: new Date().toISOString(),
    phases: {
      phase1_screenshot: { success: false },
      phase2a_upload: { success: false },
      phase2b_wayback_archive: {
        screenshot: { success: false },
        sourcePage: { success: false },
      },
      phase2c_vision_analysis: { success: false },
    },
    congruence: {
      allPhasesSuccessful: false,
      screenshotAndWaybackMatch: false,
      aiAnalyzedArchivedContent: false,
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

  // ─── Phase 1: Capture Screenshot ───────────────────────────────────────────
  console.log(`[test-settlement-evidence] Phase 1: Capturing screenshot for ${url}`);
  const phase1Start = Date.now();
  
  try {
    const screenshotResult = await screenshotWithJina(url, { timeoutMs: 45_000 });
    
    if (screenshotResult.success && screenshotResult.base64) {
      screenshotBase64 = screenshotResult.base64;
      const sizeKb = Math.round(screenshotBase64.length * 0.75 / 1024);
      result.phases.phase1_screenshot = {
        success: true,
        captureTimeMs: screenshotResult.captureTimeMs,
        screenshotSizeKb: sizeKb,
        engine: screenshotResult.engine,
      };
      console.log(`[test-settlement-evidence] Phase 1 SUCCESS: ${sizeKb}KB screenshot captured (engine=${screenshotResult.engine})`);
    } else {
      result.phases.phase1_screenshot = {
        success: false,
        captureTimeMs: Date.now() - phase1Start,
        error: screenshotResult.error || 'Unknown screenshot error',
      };
      console.warn(`[test-settlement-evidence] Phase 1 FAILED: ${screenshotResult.error}`);
    }
  } catch (err: any) {
    result.phases.phase1_screenshot = {
      success: false,
      captureTimeMs: Date.now() - phase1Start,
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

  // ─── Phase 2b: Archive to Wayback (BEFORE AI analysis) ─────────────────────
  console.log(`[test-settlement-evidence] Phase 2b: Archiving to Wayback Machine`);

  // Archive screenshot (PRIMARY evidence)
  if (screenshotPublicUrl) {
    const archiveStart = Date.now();
    try {
      const archiveResult = await archivePage(screenshotPublicUrl);
      
      if (archiveResult.success && archiveResult.waybackUrl) {
        result.phases.phase2b_wayback_archive.screenshot = {
          success: true,
          waybackUrl: archiveResult.waybackUrl,
          waybackTimestamp: archiveResult.timestamp || undefined,
          archiveTimeMs: Date.now() - archiveStart,
        };
        result.evidence.primaryEvidenceUrl = archiveResult.waybackUrl;
        console.log(`[test-settlement-evidence] Phase 2b Screenshot Archive SUCCESS: ${archiveResult.waybackUrl}`);
      } else {
        result.phases.phase2b_wayback_archive.screenshot = {
          success: false,
          archiveTimeMs: Date.now() - archiveStart,
          error: archiveResult.error || 'Archive failed',
        };
        console.warn(`[test-settlement-evidence] Phase 2b Screenshot Archive FAILED: ${archiveResult.error}`);
      }
    } catch (err: any) {
      result.phases.phase2b_wayback_archive.screenshot = {
        success: false,
        archiveTimeMs: Date.now() - archiveStart,
        error: err?.message || String(err),
      };
      console.error(`[test-settlement-evidence] Phase 2b Screenshot Archive ERROR:`, err?.message);
    }
  }

  // Archive source page (SECONDARY evidence)
  const pageArchiveStart = Date.now();
  try {
    const pageArchiveResult = await archivePage(url);
    
    if (pageArchiveResult.success && pageArchiveResult.waybackUrl) {
      result.phases.phase2b_wayback_archive.sourcePage = {
        success: true,
        waybackUrl: pageArchiveResult.waybackUrl,
        waybackTimestamp: pageArchiveResult.timestamp || undefined,
        archiveTimeMs: Date.now() - pageArchiveStart,
      };
      result.evidence.secondaryEvidenceUrl = pageArchiveResult.waybackUrl;
      console.log(`[test-settlement-evidence] Phase 2b Page Archive SUCCESS: ${pageArchiveResult.waybackUrl}`);
    } else {
      result.phases.phase2b_wayback_archive.sourcePage = {
        success: false,
        archiveTimeMs: Date.now() - pageArchiveStart,
        error: pageArchiveResult.error || 'Archive failed',
      };
      console.warn(`[test-settlement-evidence] Phase 2b Page Archive FAILED: ${pageArchiveResult.error}`);
    }
  } catch (err: any) {
    result.phases.phase2b_wayback_archive.sourcePage = {
      success: false,
      archiveTimeMs: Date.now() - pageArchiveStart,
      error: err?.message || String(err),
    };
    console.error(`[test-settlement-evidence] Phase 2b Page Archive ERROR:`, err?.message);
  }

  // ─── Phase 2c: Vision Analysis (AI extracts value from screenshot) ─────────
  if (screenshotBase64) {
    console.log(`[test-settlement-evidence] Phase 2c: Running vision analysis on screenshot`);
    const visionStart = Date.now();
    
    try {
      const visionResult = await analyzeWithVision(screenshotBase64, metric);
      
      if (visionResult.success && visionResult.numericValue !== undefined) {
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

  // ─── Congruence Analysis ───────────────────────────────────────────────────
  const allPhasesSuccessful = 
    result.phases.phase1_screenshot.success &&
    result.phases.phase2a_upload.success &&
    result.phases.phase2b_wayback_archive.screenshot.success &&
    result.phases.phase2c_vision_analysis.success;

  const screenshotAndWaybackMatch = 
    result.phases.phase2a_upload.success &&
    result.phases.phase2b_wayback_archive.screenshot.success;

  const aiAnalyzedArchivedContent = 
    result.phases.phase1_screenshot.success &&
    result.phases.phase2b_wayback_archive.screenshot.success &&
    result.phases.phase2c_vision_analysis.success;

  let summary = '';
  if (allPhasesSuccessful) {
    summary = 'CONGRUENT: Screenshot, Wayback archive, and AI analysis are all aligned. The AI analyzed the exact same image that was archived to Wayback.';
  } else if (aiAnalyzedArchivedContent) {
    summary = 'PARTIAL: Screenshot was captured, archived, and analyzed by AI. Some secondary phases may have failed.';
  } else if (screenshotAndWaybackMatch) {
    summary = 'PARTIAL: Screenshot was captured and archived, but AI analysis failed.';
  } else if (result.phases.phase1_screenshot.success) {
    summary = 'PARTIAL: Screenshot was captured but archival or analysis failed.';
  } else {
    summary = 'FAILED: Screenshot capture failed. No evidence was collected.';
  }

  result.congruence = {
    allPhasesSuccessful,
    screenshotAndWaybackMatch,
    aiAnalyzedArchivedContent,
    summary,
  };

  const totalTimeMs = Date.now() - started;
  console.log(`[test-settlement-evidence] Complete in ${totalTimeMs}ms`, {
    allPhasesSuccessful,
    primaryEvidence: result.evidence.primaryEvidenceUrl,
    aiPrice: result.evidence.aiExtractedPrice,
  });

  return NextResponse.json({
    ok: allPhasesSuccessful,
    totalTimeMs,
    ...result,
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const metric = req.nextUrl.searchParams.get('metric') || 'Current Price';

  if (!url) {
    return NextResponse.json({
      error: 'Missing required query parameter: url',
      usage: {
        method: 'GET or POST',
        endpoint: '/api/debug/test-settlement-evidence',
        queryParams: {
          url: 'Required - The URL to test (e.g., https://example.com/price-page)',
          metric: 'Optional - The metric name to extract (default: "Current Price")',
        },
        postBody: {
          url: 'Required - The URL to test',
          metric: 'Optional - The metric name to extract',
        },
        examples: [
          '/api/debug/test-settlement-evidence?url=https://www.coingecko.com/en/coins/bitcoin&metric=Bitcoin Price',
          '/api/debug/test-settlement-evidence?url=https://finance.yahoo.com/quote/AAPL&metric=Apple Stock Price',
        ],
        description: 'Tests the settlement evidence capture pipeline and verifies congruence between screenshot, Wayback archive, and AI analysis.',
        phases: {
          'Phase 1': 'Screenshot capture via Jina Reader',
          'Phase 2a': 'Upload screenshot to Supabase storage',
          'Phase 2b': 'Archive screenshot (PRIMARY) and source page (SECONDARY) to Wayback Machine',
          'Phase 2c': 'AI vision analysis to extract numeric value from screenshot',
        },
        congruence: 'All phases must succeed with the AI analyzing the SAME screenshot that was archived to Wayback for full congruence.',
      },
    }, { status: 400 });
  }

  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ url, metric }),
  });

  return POST(mockReq);
}
