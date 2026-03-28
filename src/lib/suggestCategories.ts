import OpenAI from 'openai';

export const VALID_CATEGORIES = [
  // Existing DB categories (confirmed in production markets table)
  'Agriculture',
  'Automotive',
  'Commodities',
  'Consumer Goods',
  'Cryptocurrency',
  'Demographics',
  'Development',
  'Digital Assets',
  'Energy',
  'Equities',
  'Financial',
  'Food & Beverages',
  'Futures',
  'Indices',
  'Industrial Metals',
  'Natural Gas',
  'Precious Metals',
  'Soft Commodities',
  'Stocks',
  'Technology',
  'Top Picks',

  // Original wizard categories
  'Economics',
  'Environment',
  'Health',
  'Social',
  'Sports',
  'Weather',

  // Expanded coverage
  'Education',
  'Entertainment',
  'Forex',
  'Gaming',
  'Governance',
  'Infrastructure',
  'Labor & Employment',
  'Politics',
  'Real Estate',
  'Science',
  'Transportation',

  // Fallback
  'Custom',
] as const;

type ValidCategory = typeof VALID_CATEGORIES[number];

const SYSTEM_PROMPT = `You are a market categorization engine. Given a market's name and description, select the 1–3 most relevant categories from this list:

${VALID_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Rules:
- Return a JSON array of strings, e.g. ["Financial", "Economics"]
- Pick 1 to 3 categories that best describe the market
- Only use values from the list above — no synonyms, no new categories
- If nothing fits well, return ["Custom"]
- Do NOT include any explanation, just the JSON array`;

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Uses AI to suggest categories for a market based on its name and description.
 * Returns the suggested categories or the provided fallback on any failure.
 * Designed to be non-blocking-safe: callers can await or fire-and-forget.
 */
export async function suggestCategories(
  name: string,
  description: string,
  opts?: { timeoutMs?: number; fallback?: string[] },
): Promise<string[]> {
  const fallback = opts?.fallback ?? ['Custom'];
  const timeoutMs = opts?.timeoutMs ?? 5000;

  if (!name && !description) return fallback;

  const client = getClient();
  if (!client) return fallback;

  const model = process.env.OPENAI_CREATE_MARKET_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const result = await Promise.race([
      client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 100,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Market name: ${name}\nMarket description: ${description}` },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('suggestCategories timeout')), timeoutMs),
      ),
    ]);

    const raw = result.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;

    const validated = parsed
      .map((v: unknown) => String(v))
      .filter((v: string) => (VALID_CATEGORIES as readonly string[]).includes(v));

    return validated.length > 0 ? validated : fallback;
  } catch (e: any) {
    console.warn('[suggestCategories] failed, using fallback', e?.message || String(e));
    return fallback;
  }
}
