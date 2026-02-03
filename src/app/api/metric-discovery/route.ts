import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { searchMetricSourcesCached } from '@/lib/serpApi';
import { MetricDiscoveryResponse, SearchResult } from '@/types/metricDiscovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

const InputSchema = z.object({
  description: z.string().min(3).max(1000),
  context: z.string().optional(),
  user_address: z.string().optional(),
  mode: z.enum(['full', 'define_only']).optional(),
});

const METRIC_DEFINE_ONLY_SYSTEM_PROMPT = `You are a Metric Definition Agent.

Users provide a free-form description of what they want their metric to be based on.

Your job is to:
1) Determine if the metric is objectively measurable using public data
2) Define the metric in a precise, machine-stable way
3) List assumptions required to interpret the metric

Return structured JSON only. No prose.

Return ONE JSON object with this shape:
{
  "measurable": boolean,
  "metric_definition": {
    "metric_name": string,
    "unit": string,
    "scope": string,
    "time_basis": string,
    "measurement_method": string
  } | null,
  "assumptions": string[],
  "sources": null,
  "rejection_reason": string | null
}

Rules:
- Be conservative. If unclear or subjective, set measurable=false and explain why in rejection_reason.
- Do NOT include or invent URLs in this mode.
- Treat this as settlement-critical.`;

function buildDefineOnlyUserMessage(description: string): string {
  return `METRIC DESCRIPTION:\n${description}\n\nReturn JSON only.`;
}

/**
 * Metric Discovery Agent System Prompt
 * This prompt validates metric measurability and ranks data sources
 */
const METRIC_DISCOVERY_SYSTEM_PROMPT = `You are a Metric Discovery Agent for a system that creates
publicly verifiable, long-lived metrics backed by authoritative data sources.

Users provide a free-form description of what they want their metric
to be based on. Your job is to:

1. Extract measurable intent
2. Determine if the metric is objectively measurable using public data
3. Define the metric in a precise, machine-stable way
4. Identify authoritative public URLs that can measure the metric
5. Reject the metric if it cannot be reliably measured

You MUST NOT hallucinate URLs or data sources.
You MUST ONLY reason over the information provided to you.
Return structured JSON only. No prose.`;

/**
 * Build user message with metric description and search results
 */
function buildUserMessage(description: string, searchResults: SearchResult[]): string {
  const formattedResults = searchResults
    .map((result, idx) => {
      return `${idx + 1}. Title: ${result.title}
   URL: ${result.url}
   Snippet: ${result.snippet}
   Domain: ${result.domain}`;
    })
    .join('\n\n');

  return `METRIC DESCRIPTION:
${description}

SEARCH RESULTS (candidate data sources):
${formattedResults}

---

STEP 1 — INTENT EXTRACTION

From the metric description, extract:
- measurable (boolean)
- subject (what is being measured)
- quantity (what aspect is measured, e.g. count, price, rate)
- scope (global, country, region, entity-level, etc.)
- time_basis (annual, monthly, real-time, snapshot, etc.)
- assumptions (list of implicit assumptions required)

If the metric is ambiguous, subjective, or not objectively measurable
using public data, set measurable = false.

---

STEP 2 — METRIC DEFINITION

If measurable = true, produce a canonical metric definition with:
- metric_name (concise, neutral)
- unit (count, USD, percentage, index value, etc.)
- scope
- time_basis
- measurement_method (high-level, neutral description)

This definition must be stable and suitable for long-term reference.

---

STEP 3 — SOURCE VALIDATION & RANKING

Analyze the provided search results and:
- Identify which URLs actually provide quantitative data that directly measure the metric
- Reject:
  - news articles
  - opinion pieces
  - blogs
  - commentary without data
  - sources that do not contain numeric measurements
- Prefer:
  - official institutions
  - government or intergovernmental bodies
  - well-known public data aggregators
- Rank sources by:
  - authority
  - relevance to the metric
  - long-term stability

Select:
- one primary_source
- zero or more secondary_sources (max 3)

Each source must include:
- url (from the search results)
- authority (organization name)
- confidence (0.0–1.0)

---

STEP 4 — FINAL OUTPUT

Return ONE JSON object with the following shape:

{
  "measurable": boolean,
  "metric_definition": {
    "metric_name": string,
    "unit": string,
    "scope": string,
    "time_basis": string,
    "measurement_method": string
  },
  "assumptions": string[],
  "sources": {
    "primary_source": {
      "url": string,
      "authority": string,
      "confidence": number
    },
    "secondary_sources": [
      {
        "url": string,
        "authority": string,
        "confidence": number
      }
    ]
  },
  "rejection_reason": string | null
}

If measurable = false:
- metric_definition MUST be null
- sources MUST be null
- rejection_reason MUST clearly explain why the metric cannot be
  objectively measured using public data

---

STRICT RULES:
- Do NOT invent sources not in the search results
- Do NOT assume data exists
- Do NOT output explanations outside JSON
- Be conservative: if unsure, reject
- Treat this as a settlement-critical system`;
}

/**
 * POST /api/metric-discovery
 * Discovers and validates metrics using AI and web search
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse and validate input
    const body = await req.json();
    const input = InputSchema.parse(body);

    // Default to define_only so SERP is only used when explicitly requested (mode: 'full').
    // In Create Market V2, we only request 'full' at Step 3 (URL discovery).
    const mode = input.mode || 'define_only';

    // Mode: define only (no SERP)
    if (mode === 'define_only') {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: METRIC_DEFINE_ONLY_SYSTEM_PROMPT },
          { role: 'user', content: buildDefineOnlyUserMessage(input.description) },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      });

      let aiContent = response.choices[0]?.message?.content?.trim() || '{}';
      aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const aiResponse = JSON.parse(aiContent);

      const result: MetricDiscoveryResponse = {
        measurable: Boolean(aiResponse.measurable),
        metric_definition: aiResponse.metric_definition || null,
        assumptions: Array.isArray(aiResponse.assumptions) ? aiResponse.assumptions : [],
        sources: null,
        rejection_reason: aiResponse.rejection_reason || null,
        search_results: [],
        processing_time_ms: Date.now() - startTime,
      };

      return NextResponse.json(result, { status: 200 });
    }

    // Step 1: Search for candidate data sources
    console.log('[MetricDiscovery] SerpApi search starting:', {
      description_preview: input.description.slice(0, 200),
      max_results: 10,
    });
    
    let searchResults: SearchResult[];
    try {
      searchResults = await searchMetricSourcesCached(input.description, 10);
    } catch (searchError) {
      console.error('[MetricDiscovery] Search failed:', searchError);
      return NextResponse.json(
        {
          error: 'Search failed',
          message: searchError instanceof Error ? searchError.message : 'Failed to search for data sources',
        },
        { status: 503 }
      );
    }

    console.log('[MetricDiscovery] SerpApi search complete:', {
      result_count: searchResults.length,
      sample: searchResults.slice(0, 3).map((r) => ({
        title: (r.title || '').slice(0, 120),
        url: r.url,
        domain: r.domain,
        source: r.source,
      })),
    });

    if (searchResults.length === 0) {
      return NextResponse.json(
        {
          measurable: false,
          metric_definition: null,
          assumptions: [],
          sources: null,
          rejection_reason: 'No data sources found. The metric may be too specific or use uncommon terminology.',
          search_results: [],
          processing_time_ms: Date.now() - startTime,
        } as MetricDiscoveryResponse,
        { status: 200 }
      );
    }

    // Step 2: Call OpenAI to validate and rank sources
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userMessage = buildUserMessage(input.description, searchResults);

    console.log('[MetricDiscovery] Calling OpenAI for validation...');

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: METRIC_DISCOVERY_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1, // Low temperature for consistent, conservative responses
      max_tokens: 2000,
    });

    // Step 3: Parse AI response
    let aiContent = response.choices[0]?.message?.content?.trim() || '{}';
    
    // Clean up any markdown formatting
    aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const aiResponse = JSON.parse(aiContent);

    // Step 4: Validate response structure
    const result: MetricDiscoveryResponse = {
      measurable: Boolean(aiResponse.measurable),
      metric_definition: aiResponse.metric_definition || null,
      assumptions: Array.isArray(aiResponse.assumptions) ? aiResponse.assumptions : [],
      sources: aiResponse.sources || null,
      rejection_reason: aiResponse.rejection_reason || null,
      search_results: searchResults,
      processing_time_ms: Date.now() - startTime,
    };

    console.log('[MetricDiscovery] Complete:', {
      measurable: result.measurable,
      metric_name: result.metric_definition?.metric_name,
      processing_time_ms: result.processing_time_ms,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[MetricDiscovery] Error:', error);

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          message: 'Metric description is required and must be between 3-1000 characters',
          issues: error.issues,
        },
        { status: 400 }
      );
    }

    // Handle OpenAI errors
    if (error instanceof Error && error.message.includes('OpenAI')) {
      return NextResponse.json(
        {
          error: 'AI validation failed',
          message: 'Failed to validate metric with AI service',
        },
        { status: 503 }
      );
    }

    // Generic error
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
