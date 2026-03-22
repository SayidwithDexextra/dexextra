/**
 * Multi-model vision consensus engine.
 *
 * Runs the same screenshot through GPT-4o, Claude Sonnet, and Gemini Flash
 * in parallel and computes a consensus value + agreement score.
 * Gracefully degrades when API keys are missing.
 */

import { analyzeScreenshotWithVision, VisionAnalysisResult, VisionAnalysisOptions } from './visionAnalysis';

export interface ModelVisionResult extends VisionAnalysisResult {
  model: string;
}

export interface VisionConsensus {
  /** Best value to use (median when models agree, highest-confidence otherwise) */
  value: string | undefined;
  numericValue: number | undefined;
  /** 0-1 overall confidence accounting for cross-model agreement */
  confidence: number;
  /** 'full' (2-3 agree), 'partial' (some agree), 'single' (only 1 model), 'none' */
  agreement: 'full' | 'partial' | 'single' | 'none';
  /** Per-model results for prompt injection */
  models: ModelVisionResult[];
  /** Human-readable summary for the fusion prompt */
  summary: string;
}

const AGREEMENT_TOLERANCE = 0.005; // 0.5% relative tolerance

function parseNumeric(raw: string | number | undefined | null): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const cleaned = String(raw).replace(/[^0-9.\-+]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function withinTolerance(a: number, b: number, tol: number): boolean {
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= tol;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function analyzeWithClaude(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions
): Promise<ModelVisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: 'ANTHROPIC_API_KEY not configured', model: 'claude-sonnet' };

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const userParts = [`METRIC TO FIND: ${metric}`];
    if (options.description) userParts.push(`DESCRIPTION: ${options.description}`);
    if (options.expectedRange) {
      const parts: string[] = [];
      if (options.expectedRange.min !== undefined) parts.push(`min: ${options.expectedRange.min}`);
      if (options.expectedRange.max !== undefined) parts.push(`max: ${options.expectedRange.max}`);
      if (parts.length) userParts.push(`EXPECTED RANGE: ${parts.join(', ')}`);
    }
    userParts.push('', 'Analyze this screenshot and extract the current value for the specified metric.');
    userParts.push('Return ONLY valid JSON: { "value": "...", "numericValue": "...", "confidence": 0.0-1.0, "visualQuote": "..." }');

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } },
          { type: 'text', text: userParts.join('\n') },
        ],
      }],
    });

    const text = resp.content.find((b: any) => b.type === 'text');
    const raw = (text as any)?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'No JSON in Claude response', model: 'claude-sonnet' };

    const parsed = JSON.parse(jsonMatch[0]);
    const rawNumeric = parsed.numericValue ?? parsed.numeric_value;
    const numericValue = rawNumeric != null ? String(rawNumeric) : undefined;
    const value = parsed.value != null ? String(parsed.value) : undefined;
    if (!value && !numericValue) {
      return { success: false, error: 'Claude returned no value', model: 'claude-sonnet', confidence: 0 };
    }
    return {
      success: true,
      model: 'claude-sonnet',
      value,
      numericValue,
      confidence: typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5,
      visualQuote: parsed.visualQuote || parsed.visual_quote,
    };
  } catch (e: any) {
    return { success: false, error: `Claude vision failed: ${e?.message || e}`, model: 'claude-sonnet' };
  }
}

async function analyzeWithGemini(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions
): Promise<ModelVisionResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return { success: false, error: 'GOOGLE_AI_API_KEY not configured', model: 'gemini-flash' };

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const promptParts = [`METRIC TO FIND: ${metric}`];
    if (options.description) promptParts.push(`DESCRIPTION: ${options.description}`);
    if (options.expectedRange) {
      const parts: string[] = [];
      if (options.expectedRange.min !== undefined) parts.push(`min: ${options.expectedRange.min}`);
      if (options.expectedRange.max !== undefined) parts.push(`max: ${options.expectedRange.max}`);
      if (parts.length) promptParts.push(`EXPECTED RANGE: ${parts.join(', ')}`);
    }
    promptParts.push('', 'Analyze this screenshot and extract the current value for the specified metric.');
    promptParts.push('Return ONLY valid JSON: { "value": "...", "numericValue": "...", "confidence": 0.0-1.0, "visualQuote": "..." }');

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      { text: promptParts.join('\n') },
    ]);

    const raw = result.response.text();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'No JSON in Gemini response', model: 'gemini-flash' };

    const parsed = JSON.parse(jsonMatch[0]);
    const rawNumeric = parsed.numericValue ?? parsed.numeric_value;
    const numericValue = rawNumeric != null ? String(rawNumeric) : undefined;
    const value = parsed.value != null ? String(parsed.value) : undefined;
    if (!value && !numericValue) {
      return { success: false, error: 'Gemini returned no value', model: 'gemini-flash', confidence: 0 };
    }
    return {
      success: true,
      model: 'gemini-flash',
      value,
      numericValue,
      confidence: typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5,
      visualQuote: parsed.visualQuote || parsed.visual_quote,
    };
  } catch (e: any) {
    return { success: false, error: `Gemini vision failed: ${e?.message || e}`, model: 'gemini-flash' };
  }
}

/**
 * Run vision analysis with a cost-optimized 2-tier strategy:
 *
 * Tier 1: GPT-4o + Gemini Flash in parallel (cheap).
 *   - If both agree → return immediately, skip Claude entirely.
 *   - If one fails → use the surviving result at reduced confidence.
 *
 * Tier 2 (escalation): Claude Sonnet (expensive) — only called when:
 *   - Tier 1 models disagree on the value, OR
 *   - Both Tier 1 models have confidence < 0.6, OR
 *   - Both Tier 1 models failed.
 *
 * This avoids calling Claude on ~95% of requests where GPT-4o and
 * Gemini Flash already agree, saving significant API cost at scale.
 */
export async function analyzeWithConsensus(
  base64Image: string,
  metric: string,
  options: VisionAnalysisOptions = {}
): Promise<VisionConsensus> {
  const PER_MODEL_TIMEOUT_MS = 30_000;

  const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), PER_MODEL_TIMEOUT_MS))]);

  const gptFallback: ModelVisionResult = { success: false, error: 'timeout', model: 'gpt-4o' };
  const geminiFallback: ModelVisionResult = { success: false, error: 'timeout', model: 'gemini-flash' };

  // ── Tier 1: GPT-4o + Gemini Flash (cheap, parallel) ──────────────
  console.log('[VisionConsensus] Tier 1: GPT-4o + Gemini Flash...');
  const t0 = Date.now();

  const [gptResult, geminiResult] = await Promise.all([
    withTimeout(
      analyzeScreenshotWithVision(base64Image, metric, options).then(r => ({ ...r, model: 'gpt-4o' } as ModelVisionResult)),
      gptFallback
    ),
    withTimeout(analyzeWithGemini(base64Image, metric, options), geminiFallback),
  ]);

  const tier1Ms = Date.now() - t0;
  for (const m of [gptResult, geminiResult]) {
    const status = m.success
      ? `value=${m.numericValue}, conf=${m.confidence?.toFixed(2)}`
      : `FAILED: ${m.error?.slice(0, 120)}`;
    console.log(`[VisionConsensus] ${m.model}: ${status}`);
  }
  console.log(`[VisionConsensus] Tier 1 completed in ${tier1Ms}ms`);

  const tier1Models = [gptResult, geminiResult];
  const tier1OK = tier1Models.filter(m => m.success && (m.numericValue || m.value));
  const tier1Nums = tier1OK
    .map(m => ({ model: m.model, num: parseNumeric(m.numericValue) ?? parseNumeric(m.value) }))
    .filter((v): v is { model: string; num: number } => v.num !== undefined);

  const tier1Agree = tier1Nums.length === 2 &&
    withinTolerance(tier1Nums[0].num, tier1Nums[1].num, AGREEMENT_TOLERANCE);
  const tier1LowConf = tier1OK.every(m => (m.confidence || 0) < 0.6);

  // ── Early return: Tier 1 consensus reached ────────────────────────
  if (tier1Agree && !tier1LowConf) {
    const med = median(tier1Nums.map(v => v.num));
    const avgConf = tier1OK.reduce((s, m) => s + (m.confidence || 0.5), 0) / tier1OK.length;
    const boostedConf = Math.min(avgConf + 0.1, 1);
    const names = tier1Nums.map(v => v.model).join(', ');
    console.log(`[VisionConsensus] TIER 1 CONSENSUS: ${names} agree, median=${med}, conf=${boostedConf.toFixed(2)} — Claude skipped`);
    return {
      value: String(med),
      numericValue: med,
      confidence: boostedConf,
      agreement: 'full',
      models: tier1Models,
      summary: `VISION_CONSENSUS - 2/2 models agree (${names}): median=${med}, confidence boosted to ${boostedConf.toFixed(2)}. Claude skipped (cost optimization).`,
    };
  }

  // ── Tier 2: Escalate to Claude (tiebreaker / low-confidence) ──────
  const escalationReason = !tier1Agree && tier1Nums.length === 2
    ? 'disagreement' : tier1LowConf
    ? 'low_confidence' : 'insufficient_tier1';
  console.log(`[VisionConsensus] Escalating to Claude (reason: ${escalationReason})`);

  const claudeFallback: ModelVisionResult = { success: false, error: 'timeout', model: 'claude-sonnet' };
  const claudeResult = await withTimeout(analyzeWithClaude(base64Image, metric, options), claudeFallback);

  const claudeStatus = claudeResult.success
    ? `value=${claudeResult.numericValue}, conf=${claudeResult.confidence?.toFixed(2)}`
    : `FAILED: ${claudeResult.error?.slice(0, 120)}`;
  console.log(`[VisionConsensus] claude-sonnet: ${claudeStatus}`);
  console.log(`[VisionConsensus] All models completed in ${Date.now() - t0}ms`);

  const allModels = [gptResult, geminiResult, claudeResult];
  const allOK = allModels.filter(m => m.success && (m.numericValue || m.value));

  if (allOK.length === 0) {
    return {
      value: undefined, numericValue: undefined, confidence: 0,
      agreement: 'none', models: allModels,
      summary: 'All vision models failed or returned no value.',
    };
  }

  if (allOK.length === 1) {
    const m = allOK[0];
    const num = parseNumeric(m.numericValue);
    return {
      value: m.value, numericValue: num,
      confidence: (m.confidence || 0.5) * 0.8,
      agreement: 'single', models: allModels,
      summary: `Only ${m.model} returned a value: ${m.numericValue} (no cross-validation).`,
    };
  }

  const allNums = allOK
    .map(m => ({ model: m.model, num: parseNumeric(m.numericValue) ?? parseNumeric(m.value) }))
    .filter((v): v is { model: string; num: number } => v.num !== undefined);

  if (allNums.length < 2) {
    const best = allOK.reduce((a, b) => ((a.confidence || 0) >= (b.confidence || 0) ? a : b));
    return {
      value: best.value, numericValue: parseNumeric(best.numericValue),
      confidence: (best.confidence || 0.5) * 0.85,
      agreement: 'single', models: allModels,
      summary: `Only ${best.model} returned a parseable numeric value: ${best.numericValue}.`,
    };
  }

  // Pairwise agreement across all 3
  const agreeing: typeof allNums = [];
  for (let i = 0; i < allNums.length; i++) {
    for (let j = i + 1; j < allNums.length; j++) {
      if (withinTolerance(allNums[i].num, allNums[j].num, AGREEMENT_TOLERANCE)) {
        if (!agreeing.find(v => v.model === allNums[i].model)) agreeing.push(allNums[i]);
        if (!agreeing.find(v => v.model === allNums[j].model)) agreeing.push(allNums[j]);
      }
    }
  }

  if (agreeing.length >= 2) {
    const med = median(agreeing.map(v => v.num));
    const avgConf = allOK.reduce((s, m) => s + (m.confidence || 0.5), 0) / allOK.length;
    const boostedConf = Math.min(avgConf + 0.15, 1);
    const names = agreeing.map(v => v.model).join(', ');
    const agreement = agreeing.length >= 3 ? 'full' as const : 'partial' as const;
    console.log(`[VisionConsensus] CONSENSUS: ${agreement} — ${agreeing.length}/${allNums.length} agree, median=${med}, confidence=${boostedConf.toFixed(2)}`);
    return {
      value: String(med), numericValue: med, confidence: boostedConf,
      agreement, models: allModels,
      summary: `${agreeing.length}/${allNums.length} models agree (${names}): median=${med}, confidence boosted to ${boostedConf.toFixed(2)}.`,
    };
  }

  const best = allOK.reduce((a, b) => ((a.confidence || 0) >= (b.confidence || 0) ? a : b));
  const allVals = allNums.map(v => `${v.model}=${v.num}`).join(', ');
  return {
    value: best.value, numericValue: parseNumeric(best.numericValue),
    confidence: Math.max((best.confidence || 0.5) - 0.15, 0.1),
    agreement: 'partial', models: allModels,
    summary: `Models disagree (${allVals}). Using ${best.model}=${best.numericValue} (highest confidence), confidence reduced.`,
  };
}
