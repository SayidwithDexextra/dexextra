import OpenAI from 'openai';

export interface GenerateXPathInput {
  metric: string;
  html: string;
  url?: string;
  hintText?: string;
}

export interface GenerateXPathResult {
  xpath: string | null;
  css_selector?: string | null;
  numeric_value?: string | null;
  quote?: string | null;
  confidence?: number;
  reasoning?: string;
  context_snippet?: string | null;
}

export class XPathGeneratorService {
  private openai: OpenAI;
  private enabled: boolean;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.enabled = !!apiKey && String(process.env.METRIC_AI_DISABLED).toLowerCase() !== 'true';
    this.openai = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || 'gpt-4.1';
  }

  async generateFromHtml(input: GenerateXPathInput): Promise<GenerateXPathResult> {
    if (!this.enabled) {
      throw new Error('AI is disabled or not configured');
    }

    const { metric } = input;
    const originalHtml = String(input.html || '');
    const fullHtml = originalHtml; // Use the exact full HTML payload without truncation

    const system = `You are an expert at extracting numeric metrics from HTML. Your job is to choose a single, robust XPath that resolves directly to the numeric node representing the CURRENT value for the requested metric. Prefer stable anchors (ids, label text proximity, data-* attributes). Avoid brittle class chains.

Return STRICT JSON only with keys: xpath (string), css_selector (string or null), numeric_value (string), quote (string), confidence (0..1), reasoning (string).`;

    const user = [
      `METRIC: ${metric}`,
      input.url ? `SOURCE_URL: ${input.url}` : undefined,
      input.hintText ? `HINT: ${input.hintText}` : undefined,
      'HTML_FULL_START',
      fullHtml,
      'HTML_FULL_END'
    ].filter(Boolean).join('\n');

    const basePayload: any = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    };

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

    let resp;
    try {
      resp = await this.openai.chat.completions.create({ ...basePayload, max_completion_tokens: 800 } as any);
    } catch (e1: any) {
      if (isUnsupportedTokens(e1)) {
        // Legacy param fallback
        resp = await this.openai.chat.completions.create({ ...basePayload, max_tokens: 800 } as any);
      } else if (isUnsupportedTemp(e1)) {
        const { temperature, ...noTemp } = basePayload;
        try {
          resp = await this.openai.chat.completions.create({ ...noTemp, max_completion_tokens: 800 } as any);
        } catch (e2: any) {
          if (isUnsupportedTokens(e2)) {
            resp = await this.openai.chat.completions.create({ ...noTemp, max_tokens: 800 } as any);
          } else {
            throw e2;
          }
        }
      } else {
        throw e1;
      }
    }

    const raw = resp.choices[0]?.message?.content?.trim() || '';
    if (!raw) throw new Error('Empty AI response');

    const data = this.safeParseJson(raw);
    return {
      xpath: data?.xpath ?? null,
      css_selector: data?.css_selector ?? null,
      numeric_value: data?.numeric_value ?? null,
      quote: data?.quote ?? null,
      confidence: typeof data?.confidence === 'number' ? data.confidence : undefined,
      reasoning: data?.reasoning ?? undefined,
      context_snippet: null
    };
  }

  private sanitizeHtml(html: string): string {
    try {
      // Strip script/style to reduce noise
      return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');
    } catch {
      return String(html || '');
    }
  }

  private truncateHtml(html: string, maxChars: number): string {
    if (!html || html.length <= maxChars) return html;
    const head = Math.floor(maxChars * 0.6);
    const tail = maxChars - head;
    return html.slice(0, head) + '\n<!-- truncated -->\n' + html.slice(-tail);
  }

  private safeParseJson(raw: string): any {
    const attempts = [
      (s: string) => s,
      (s: string) => s.replace(/```json[\r\n]?|```/g, ''),
      (s: string) => s.replace(/,\s*(\}|\])/g, '$1')
    ];
    for (const fix of attempts) {
      try {
        return JSON.parse(fix(raw));
      } catch {}
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1).replace(/,\s*(\}|\])/g, '$1'));
      } catch {}
    }
    throw new Error('Failed to parse AI JSON');
  }

  private reduceForMetric(html: string, metric: string, hintText?: string): { snippetHtml: string | null; snippetText: string | null; jsonldSnippet: string | null } {
    const loweredMetric = (metric || '').toLowerCase();
    const tokens = this.buildSearchTokens(loweredMetric, hintText);

    // 1) Strip noise
    let reduced = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '');

    // Remove obvious ad blocks by class/id hints
    try {
      reduced = reduced.replace(/<([a-z0-9:-]+)[^>]*(class|id)=["'][^"']*(ad|ads|advert)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, '');
    } catch {}

    // 2) Extract JSON-LD that might include metric terms
    const jsonldMatches = Array.from(reduced.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
    let jsonldSnippet: string | null = null;
    for (const m of jsonldMatches) {
      const body = (m[1] || '').trim();
      const lc = body.toLowerCase();
      if (tokens.some(t => lc.includes(t))) {
        jsonldSnippet = body.slice(0, 4000);
        break;
      }
    }

    // 3) Find metric occurrence region in HTML text
    const textOnly = reduced.replace(/<[^>]+>/g, ' ');
    const lowerText = textOnly.toLowerCase();
    let hitIndex = -1;
    for (const t of tokens) {
      hitIndex = lowerText.indexOf(t);
      if (hitIndex !== -1) break;
    }

    // 4) Build snippet around the hit; prefer nearby container tags
    const windowSize = 2400; // ~2.4 KB
    if (hitIndex !== -1) {
      // Map text index to HTML index by scanning; approximate by searching the same token in HTML
      let htmlIndex = -1;
      for (const t of tokens) {
        htmlIndex = reduced.toLowerCase().indexOf(t);
        if (htmlIndex !== -1) break;
      }
      if (htmlIndex === -1) htmlIndex = Math.max(0, hitIndex);

      // Try to find a nearby container start before the hit
      const startSearchFrom = Math.max(0, htmlIndex - 2000);
      const containerStartMatch = Array.from(reduced
        .slice(startSearchFrom, htmlIndex)
        .matchAll(/<(div|section|article|table|tbody|ul|ol)[^>]*>/gi)).pop();
      const containerStart = containerStartMatch
        ? startSearchFrom + containerStartMatch.index!
        : Math.max(0, htmlIndex - windowSize);

      // End boundary after the hit
      const endSearchTo = Math.min(reduced.length, htmlIndex + 4000);
      const containerEndMatch = reduced
        .slice(htmlIndex, endSearchTo)
        .match(/<\/(div|section|article|table|tbody|ul|ol)>/i);
      const containerEnd = containerEndMatch
        ? htmlIndex + (containerEndMatch.index || 0) + (containerEndMatch[0]?.length || 0)
        : Math.min(reduced.length, htmlIndex + windowSize);

      const snippetHtml = reduced.slice(containerStart, containerEnd);
      const snippetText = textOnly.slice(Math.max(0, hitIndex - windowSize / 2), Math.min(textOnly.length, hitIndex + windowSize / 2));
      return { snippetHtml, snippetText, jsonldSnippet };
    }

    // 5) Multi-pass: chunk and look for tokens
    const chunkSize = 10000;
    for (let i = 0; i < reduced.length; i += chunkSize) {
      const chunk = reduced.slice(i, i + chunkSize);
      const lc = chunk.toLowerCase();
      if (tokens.some(t => lc.includes(t))) {
        return { snippetHtml: chunk.slice(0, 5000), snippetText: chunk.replace(/<[^>]+>/g, ' ').slice(0, 5000), jsonldSnippet };
      }
    }

    // 6) Fallback: head of document only
    return { snippetHtml: reduced.slice(0, 5000), snippetText: textOnly.slice(0, 5000), jsonldSnippet };
  }

  private buildSearchTokens(metricLower: string, hintText?: string): string[] {
    const tokens = new Set<string>();
    const add = (s?: string) => {
      if (!s) return;
      const t = s.trim().toLowerCase();
      if (t) tokens.add(t);
    };
    add(metricLower);
    if (hintText) {
      // Add key words of 3+ chars from hint as additional anchors
      hintText
        .toLowerCase()
        .split(/[^a-z0-9%\.\-]+/)
        .filter(w => w.length >= 4)
        .slice(0, 8)
        .forEach(w => add(w));
    }
    return Array.from(tokens);
  }
}


