import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { searchMetricSourcesCached } from '@/lib/serpApi';
import type { SearchResult } from '@/types/metricDiscovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

// We only want to generate the Market Summary Block at the *true* end of the workflow.
// For now, keep it disabled until the remaining creation steps are implemented.
const ENABLE_MARKET_SUMMARY_BLOCK = false;

const StepSchema = z.enum([
  'idle',
  'discovering',
  'clarify_metric',
  'name',
  'description',
  'select_source',
  'icon',
  'complete',
]);

const OutputSchema = z.object({
  message: z.string().min(1),
  suggestions: z
    .object({
      marketName: z.string().optional(),
      marketDescription: z.string().optional(),
    })
    .optional(),
});

const STEP_ASSISTANT_SYSTEM_PROMPT = `You are Market Picker running inside a multi-step market creation UI.

Your job is to guide the user through the current UI step with a short, helpful message.

Rules:
- Be concise (1-2 sentences).
- Use the provided context.
- If the current step is clarify_metric and the metric is not measurable, ask exactly ONE clarifying question (no more than one question mark).
- If the current step is name, include suggestions.marketName (one concise suggested market name).
- If the current step is description, include suggestions.marketDescription (1-2 sentences describing the continuously evolving metric).
- Do NOT output the final Market Summary Block yet.
- Do NOT invent URLs.
- Return JSON only with shape: { "message": string, "suggestions"?: { "marketName"?: string, "marketDescription"?: string } }.

CRITICAL - NO BINARY OUTCOMES:
- NEVER suggest titles or descriptions that imply a binary yes/no outcome.
- NEVER frame metrics as prediction market style questions (e.g., "Will X happen?", "Price of X at daily close").
- Markets track CONTINUOUSLY EVOLVING METRICS that can increase or decrease over time.
- Good examples: "Bitcoin Price (USD)", "S&P 500 Index", "Ethereum Gas Price (Gwei)"
- Bad examples: "Bitcoin price at daily close" (implies binary snapshot), "Will Bitcoin reach $100k?" (yes/no question)
- The metric value should always be a live, evolving number - not a point-in-time snapshot for binary settlement.
`;

const InputSchema = z.object({
  step: StepSchema,
  context: z
    .object({
      metricPrompt: z.string().optional(),
      discovery: z
        .object({
          measurable: z.boolean().optional(),
          rejection_reason: z.string().nullable().optional(),
          metric_definition: z
            .object({
              metric_name: z.string().optional(),
              unit: z.string().optional(),
              scope: z.string().optional(),
              time_basis: z.string().optional(),
              measurement_method: z.string().optional(),
            })
            .nullable()
            .optional(),
          assumptions: z.array(z.string()).optional(),
          sources: z
            .object({
              primary_source: z
                .object({
                  url: z.string(),
                  authority: z.string(),
                  confidence: z.number(),
                })
                .nullable()
                .optional(),
              secondary_sources: z
                .array(
                  z.object({
                    url: z.string(),
                    authority: z.string(),
                    confidence: z.number(),
                  })
                )
                .optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
      marketName: z.string().optional(),
      marketDescription: z.string().optional(),
      selectedSource: z
        .object({
          url: z.string(),
          label: z.string().optional(),
          authority: z.string().optional(),
          confidence: z.number().optional(),
        })
        .nullable()
        .optional(),
    })
    .default({}),
  history: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(8000),
      })
    )
    .optional(),
});

const MARKET_PICKER_SYSTEM_PROMPT = `You are **Market Picker**, a specialized GPT whose sole purpose is to convert a user's vague idea into a **clean, tradable market** defined by **one public, verifiable, continuously evolving metric**.

You do **not** give investment advice.
You do **not** optimize for persuasion or hype.
You optimize for **measurability, volatility, and clarity**.

---

## CRITICAL: NO BINARY OUTCOMES

This platform is NOT a prediction market. You must NEVER:
- Suggest titles or descriptions that imply a binary yes/no outcome
- Frame metrics as point-in-time snapshots for binary settlement (e.g., "Bitcoin price at daily close", "ETH at end of month")
- Use prediction market language like "Will X happen?" or "X by [date]?"
- Create markets that resolve to a single yes/no or pass/fail determination
- Use language like "at close", "at settlement", or "on [specific date]" that implies a snapshot

Instead, markets track **continuously evolving metrics** where:
- The value can increase OR decrease over time indefinitely
- Traders speculate on the direction and magnitude of change
- There is no binary "correct" or "incorrect" outcome - just an ever-changing value
- The metric is always live and updating

**Good examples:** "Bitcoin Price (USD)", "ETH/BTC Ratio", "S&P 500 Index Level", "US Unemployment Rate (%)", "Gold Spot Price"
**Bad examples:** "Bitcoin price at daily close" (snapshot), "Will BTC hit $100k?" (binary), "ETH above $5000 on Dec 31" (binary), "Price of oil at settlement" (snapshot)

---

## Core Objective

Given a user idea (e.g. "real estate in Miami", "AI adoption", "oil prices"), you must:

1. Select the **best single numeric metric** that represents the idea.
2. Ensure the metric is **public, free, stable, and continuously updating**.
3. Transform the idea if necessary so the resulting market tracks a **live, evolving value** (not a point-in-time snapshot).
4. Output a **standardized market summary block** every time.

You **always end** your response with the **four-line Market Summary Block** defined below.

---

## Mandatory Final Output (ALWAYS REQUIRED)

You must always end with exactly this structure, once:

\`\`\`
Market title: <short, concrete - NO binary framing or point-in-time language>
Market description: <1-2 lines explaining the continuously evolving metric being tracked>
Underlying metric (URL): <metric name & exact field/label> - https://...
Interest rating (0-5): <digit + one-phrase justification>
\`\`\`

No extra commentary after this block.

---

## Operating Constraints

### 1. Follow-ups: Strict Limit

* You may ask **at most one** clarifying question **OR** offer **one** nearby alternative.
* Only do this if the idea is:
  * unmeasurable,
  * monotonic / one-sided,
  * extremely range-bound,
  * or so niche that no one would trade it.
* If a good metric is obvious, **do not ask questions**.

---

## Viability Screening (Do Silently)

### A. Monotonic / One-Sided Metrics

Examples:
* Population
* Cumulative revenue
* Installed capacity
* Total users

These produce one-directional markets.

**Action:**
Warn briefly (one line), then apply **one** nearby transformation:
* Year-over-year % change
* First difference (delta)
* Spread (A - B)
* Ratio (A / B)
* Rank / position

Never propose more than one fix.

---

### B. Narrow or Range-Bound Metrics

Examples:
* Daily temperature in one city
* Small local counts
* Highly stable indices

**Action:**
Offer **one** nearby alternative:
* City A - City B spread
* Anomaly vs baseline
* Threshold count (e.g. number of days >= X)

---

### C. Popularity Check

If the topic is obscure or hyper-local:
* Proceed if a clean metric exists
* Assign a **lower Interest rating**
* Do not exaggerate appeal

---

## Metric Selection Rules

Choose **one number only**.

### Preferred Sources (in order)

1. Official statistical agencies (gov / edu / int)
2. Large aggregators (FRED, World Bank, UN, EIA, NOAA)
3. Well-known industry dashboards
4. Avoid paywalls, logins, private blogs, or mutable dashboards

### Good Metric Traits

* Clearly labeled value
* Visible without interaction
* Obvious units
* Known update frequency
* Public URL that can be archived
* Continuously updating (not just periodic snapshots)

---

## Description Guidelines

When writing market descriptions:
- Focus on what the metric measures and how it evolves
- Mention the data source and update frequency
- Do NOT use settlement language or point-in-time references
- Do NOT say "settles to" or "at close" or similar phrases
- The description should convey that this is a live, continuously tracked value

Example good description: "Tracks the current Bitcoin price in USD as reported by CoinGecko. Updated in real-time."
Example bad description: "Settles to the Bitcoin price at 23:59:59 UTC on the settlement date."

---

## Units & Precision

* Mention units when relevant (%, USD, index level).
* Only specify rounding if it meaningfully matters.

---

## Interest Rating (0-5)

Score reflects:
* **Volatility (approx 70%)**
* **Likely trader interest (approx 30%)**

Use these heuristics:
* **0** - monotonic, untradeable
* **1** - extremely slow or niche
* **2** - modest movement, annual only
* **3** - cyclical, quarterly/monthly
* **4** - weekly/monthly with strong interest
* **5** - highly volatile + mainstream

Never overstate interest.

---

## Style Rules

* Be concise.
* Neutral, factual tone.
* No marketing language.
* No investment advice.
* No emojis.
* Minimal prose outside the final block.

---

## Pattern Preferences

When possible, convert:
* Levels -> **rates of change**
* Totals -> **differences or spreads**
* Local metrics -> **relative comparisons**
* Static values -> **anomalies or deviations**

---

## What NOT To Do

* Do not propose multiple metrics.
* Do not ask more than one question.
* Do not use settlement or snapshot language.
* Do not omit the URL.
* Do not end without the summary block.
* Do not recommend trades or positions.
* Do not frame as binary yes/no outcomes.
* Do not use "at close", "at settlement", or similar point-in-time language.

---

## Identity Reminder

You are **not** a general assistant.
You are a **market-definition engine** for continuously evolving metrics.

Your success is judged entirely by whether the output defines a **continuously updating, publicly verifiable metric** that traders can speculate on directionally.
`;

function formatSearchResults(searchResults: SearchResult[]) {
  if (!searchResults.length) return '';
  return searchResults
    .map((result, idx) => {
      return `${idx + 1}. Title: ${result.title}
URL: ${result.url}
Snippet: ${result.snippet}
Domain: ${result.domain}`;
    })
    .join('\n\n');
}

function extractSummaryFields(text: string) {
  const titleMatch = text.match(/^Market title:\s*(.+)$/m);
  const descMatch = text.match(/^Market description:\s*(.+)$/m);
  const underlyingMatch = text.match(
    /^Underlying metric \(URL\):\s*(.+?)\s+[-—]\s+(https?:\/\/\S+)\s*$/m
  );
  const ratingMatch = text.match(/^Interest rating \(0-5\):\s*([0-5])\b.*$/m);

  return {
    marketTitle: titleMatch?.[1]?.trim(),
    marketDescription: descMatch?.[1]?.trim(),
    metricUrl: underlyingMatch?.[2]?.trim(),
    interestRating: ratingMatch ? Number(ratingMatch[1]) : undefined,
  };
}

function buildUserMessage(input: z.infer<typeof InputSchema>, searchResults: SearchResult[]) {
  const ctx = input.context || {};

  const sources: Array<{ url: string; authority?: string; confidence?: number; label?: string }> = [];

  if (ctx.selectedSource?.url) {
    sources.push({
      url: ctx.selectedSource.url,
      label: ctx.selectedSource.label,
      authority: ctx.selectedSource.authority,
      confidence: ctx.selectedSource.confidence,
    });
  }

  const primary = ctx.discovery?.sources?.primary_source;
  if (primary?.url) sources.push({ url: primary.url, authority: primary.authority, confidence: primary.confidence });
  const secondary = ctx.discovery?.sources?.secondary_sources || [];
  for (const s of secondary) sources.push({ url: s.url, authority: s.authority, confidence: s.confidence });

  const uniqueSources = Array.from(new Map(sources.map((s) => [s.url, s])).values()).slice(0, 10);
  const formattedSources = uniqueSources.length
    ? uniqueSources
        .map((s) => {
          const parts = [s.url];
          const meta: string[] = [];
          if (s.label) meta.push(s.label);
          if (s.authority) meta.push(s.authority);
          if (typeof s.confidence === 'number') meta.push(`confidence=${s.confidence}`);
          return meta.length ? `- ${parts.join(' ')} (${meta.join(', ')})` : `- ${parts.join(' ')}`;
        })
        .join('\n')
    : '';

  const idea =
    ctx.metricPrompt ||
    ctx.marketName ||
    ctx.discovery?.metric_definition?.metric_name ||
    ctx.marketDescription ||
    '';

  return `CURRENT UI STEP: ${input.step}

USER IDEA:
${idea || '(missing)'}

KNOWN CANDIDATE PUBLIC URLs (you MUST pick one of these if present; DO NOT invent URLs):
${formattedSources || '(none)'}

SERP SEARCH RESULTS (additional candidates; prefer authoritative sources; DO NOT invent URLs):
${formatSearchResults(searchResults) || '(none)'}

CONTEXT (JSON):
${JSON.stringify(
    {
      discovery: ctx.discovery ?? null,
      marketName: ctx.marketName ?? '',
      marketDescription: ctx.marketDescription ?? '',
      selectedSource: ctx.selectedSource ?? null,
    },
    null,
    2
  )}

INSTRUCTIONS:
- Produce the assistant message for this step.
- You may add 1 short guiding sentence BEFORE the Market Summary Block.
- You MUST end with the exact 4-line Market Summary Block required by the system prompt.
- Remember: NO binary outcomes, NO settlement language, NO point-in-time snapshots.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = InputSchema.parse(body);

    const apiKey = process.env.OPENAI_API_KEY;
    const model =
      process.env.OPENAI_CREATE_MARKET_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // If OpenAI isn't configured yet, return a deterministic placeholder.
    if (!apiKey) {
      return NextResponse.json(
        {
          message:
            input.step === 'select_source'
              ? 'Now pick a data source for this market.'
              : 'AI assistant is not configured yet (missing OPENAI_API_KEY).',
          suggestions: {},
          meta: { model: 'unconfigured' },
        },
        { status: 200 }
      );
    }

    const ctx = input.context || {};
    const idea =
      ctx.metricPrompt ||
      ctx.marketName ||
      ctx.discovery?.metric_definition?.metric_name ||
      ctx.marketDescription ||
      '';

    // Prefer already-discovered URLs; only call SERP if we don't have candidate URLs.
    const hasKnownUrls =
      Boolean(ctx.selectedSource?.url) ||
      Boolean(ctx.discovery?.sources?.primary_source?.url) ||
      Boolean(ctx.discovery?.sources?.secondary_sources?.length);

    const shouldGenerateSummary =
      ENABLE_MARKET_SUMMARY_BLOCK &&
      input.step === 'complete' &&
      Boolean(String(ctx.marketName || '').trim()) &&
      Boolean(String(ctx.marketDescription || '').trim()) &&
      Boolean(hasKnownUrls);

    let searchResults: SearchResult[] = [];
    if (shouldGenerateSummary && !hasKnownUrls && idea) {
      try {
        searchResults = await searchMetricSourcesCached(idea, 10);
      } catch (e) {
        // Keep going; the model may still be able to pick from known context.
        searchResults = [];
      }
    }

    const openai = new OpenAI({ apiKey });

    // Default mode (for now): step guidance only, no Market Summary Block.
    if (!shouldGenerateSummary) {
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: STEP_ASSISTANT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `CURRENT UI STEP: ${input.step}\n\nCONTEXT (JSON):\n${JSON.stringify(ctx, null, 2)}\n`,
          },
        ],
        max_tokens: 300,
      });

      const raw = completion.choices?.[0]?.message?.content || '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { message: String(raw || '').trim() || 'Continue to the next step.' };
      }
      const output = OutputSchema.parse(parsed);

      // Ensure name/description suggestions populate the left input fields even if the model omits them.
      const metricName = ctx.discovery?.metric_definition?.metric_name;
      const measurementMethod = ctx.discovery?.metric_definition?.measurement_method;

      const suggestions = { ...(output.suggestions || {}) } as {
        marketName?: string;
        marketDescription?: string;
      };

      if (input.step === 'name' && !suggestions.marketName && metricName) {
        suggestions.marketName = String(metricName);
      }

      if (input.step === 'description' && !suggestions.marketDescription) {
        if (measurementMethod && metricName) {
          suggestions.marketDescription = `Tracks the current value of ${metricName}. ${measurementMethod}.`;
        } else if (metricName) {
          suggestions.marketDescription = `Tracks the current value of ${metricName}. Updated continuously from the data source.`;
        }
      }

      return NextResponse.json(
        { ...output, suggestions, meta: { model } },
        { status: 200 }
      );
    }

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: MARKET_PICKER_SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input, searchResults) },
      ],
      max_tokens: 900,
    });

    const message = String(completion.choices?.[0]?.message?.content || '').trim();
    if (!message) {
      return NextResponse.json(
        { message: 'Sorry - I had trouble generating a response.', suggestions: {}, meta: { model } },
        { status: 200 }
      );
    }

    const fields = extractSummaryFields(message);
    return NextResponse.json(
      {
        message,
        suggestions: {
          marketName: fields.marketTitle,
          marketDescription: fields.marketDescription,
        },
        meta: {
          model,
          metricUrl: fields.metricUrl,
          interestRating: fields.interestRating,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'create-market-assistant_failed', message: msg }, { status: 400 });
  }
}
