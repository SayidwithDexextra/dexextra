import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getSupabaseServer } from '@/lib/supabase-server';

type SimilarityReason =
  | { type: 'identifier_exact' }
  | { type: 'symbol_exact' }
  | { type: 'name_exact' }
  | { type: 'identifier_substring' }
  | { type: 'symbol_substring' }
  | { type: 'name_substring' }
  | { type: 'description_substring' }
  | { type: 'token_overlap'; value: number; common: string[] };

type SimilarMarket = {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description: string;
  category: string | string[];
  market_status: string;
  is_active?: boolean;
  total_volume: number | string | null;
  total_trades: number | null;
  last_trade_price: number | string | null;
  settlement_date: string | null;
  created_at: string | null;
  icon_image_url?: string | null;
  initial_order?: { metricUrl?: string; [key: string]: unknown } | null;
};

const BodySchema = z
  .object({
    intent: z.string().trim().max(2000).optional(),
    name: z.string().trim().max(2000).optional(),
    description: z.string().trim().max(4000).optional(),
    category: z.string().trim().max(120).optional(),
    status: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    metric_url: z.string().trim().url().max(2000).optional(),
  })
  .strict();

function getClientIdentifier(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'anonymous'
  );
}

function normalizeMetricUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    const normalized = u.toString().replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return (raw || '').trim().replace(/\/$/, '').toLowerCase();
  }
}

function normalizeText(input: string) {
  // Lowercase, replace most punctuation with spaces, collapse whitespace.
  const cleaned = input
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function tokenizeNormalized(normalized: string) {
  if (!normalized) return [];
  const toks = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2);
  // De-dupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of toks) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'is', 'it',
  'and', 'or', 'not', 'from', 'with', 'as', 'be', 'are', 'was', 'per', 'vs',
  'average', 'price', 'prices', 'retail', 'spot', 'daily', 'monthly', 'weekly',
  'annual', 'yearly', 'quarterly', 'settlement', 'futures', 'market', 'markets',
  'rate', 'rates', 'index', 'value', 'total', 'global', 'current', 'official',
  'real', 'nominal', 'us', 'usa', 'usd', 'eur', 'gbp', 'city', 'national',
  'front', 'month', 'closing', 'opening', 'tracking', 'tracked', 'measured',
  'based', 'using', 'data', 'source', 'kg', 'lb', 'oz', 'ton', 'metric',
  'unit', 'units', 'cost', 'sale', 'sales', 'buy', 'sell', 'trade',
]);

function isSubjectToken(token: string): boolean {
  return token.length >= 2 && !STOP_WORDS.has(token) && !STOP_WORDS.has(stemSimple(token));
}

function extractSubjectTokens(tokens: string[]): string[] {
  return tokens.filter(isSubjectToken);
}

function stemSimple(word: string): string {
  return word
    .replace(/ies$/, 'y')
    .replace(/sses$/, 'ss')
    .replace(/([^s])s$/, '$1');
}

function fuzzyTokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (stemSimple(a) === stemSimple(b)) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

function jaccardFuzzy(a: string[], b: string[]) {
  if (!a.length || !b.length) return { score: 0, common: [] as string[] };
  const matched = new Set<number>();
  const common: string[] = [];
  for (const ta of a) {
    for (let i = 0; i < b.length; i++) {
      if (matched.has(i)) continue;
      if (fuzzyTokenMatch(ta, b[i])) {
        matched.add(i);
        common.push(ta);
        break;
      }
    }
  }
  const inter = matched.size;
  const union = new Set([...a.map(stemSimple), ...b.map(stemSimple)]).size;
  return { score: union <= 0 ? 0 : inter / union, common };
}

function computeSimilarity({
  queryNormalized,
  queryTokens,
  market,
}: {
  queryNormalized: string;
  queryTokens: string[];
  market: SimilarMarket;
}): { score: number; reasons: SimilarityReason[] } {
  const reasons: SimilarityReason[] = [];

  const identifier = (market.market_identifier || '').toString();
  const symbol = (market.symbol || '').toString();
  const name = (market.name || '').toString();
  const description = (market.description || '').toString();

  const identifierN = normalizeText(identifier);
  const symbolN = normalizeText(symbol);
  const nameN = normalizeText(name);
  const descriptionN = normalizeText(description);

  const queryN = queryNormalized;

  let score = 0;

  const querySubjects = extractSubjectTokens(queryTokens);
  const marketAllTokens = tokenizeNormalized([identifierN, symbolN, nameN, descriptionN].join(' '));
  const marketSubjects = extractSubjectTokens(marketAllTokens);
  const nameTokens = tokenizeNormalized(nameN);
  const nameSubjects = extractSubjectTokens(nameTokens);

  // Exact matches (strong)
  if (queryN && identifierN === queryN) {
    score += 0.55;
    reasons.push({ type: 'identifier_exact' });
  }
  if (queryN && symbolN === queryN) {
    score += 0.35;
    reasons.push({ type: 'symbol_exact' });
  }
  if (queryN && nameN === queryN) {
    score += 0.25;
    reasons.push({ type: 'name_exact' });
  }

  // Subject-focused matching: does the market contain the query's subject words?
  if (querySubjects.length > 0 && marketSubjects.length > 0) {
    let subjectHits = 0;
    const matchedSubjects: string[] = [];
    for (const qs of querySubjects) {
      for (const ms of marketSubjects) {
        if (fuzzyTokenMatch(qs, ms)) {
          subjectHits++;
          matchedSubjects.push(qs);
          break;
        }
      }
    }
    const subjectRatio = subjectHits / querySubjects.length;
    // Subject match is the primary signal — weight it heavily
    score += subjectRatio * 0.50;
    if (matchedSubjects.length > 0) {
      reasons.push({ type: 'token_overlap', value: subjectRatio, common: matchedSubjects });
    }

    // Bonus: subject appears in the market's name specifically
    if (nameSubjects.length > 0) {
      let nameSubjectHits = 0;
      for (const qs of querySubjects) {
        for (const ns of nameSubjects) {
          if (fuzzyTokenMatch(qs, ns)) { nameSubjectHits++; break; }
        }
      }
      const nameSubjectRatio = nameSubjectHits / querySubjects.length;
      score += nameSubjectRatio * 0.20;
    }
  }

  // Substring matches on subject words against identifier/symbol
  for (const subj of querySubjects) {
    if (subj.length >= 3) {
      if (identifierN.includes(subj)) {
        score += 0.10;
        reasons.push({ type: 'identifier_substring' });
        break;
      }
    }
  }
  for (const subj of querySubjects) {
    if (subj.length >= 3) {
      if (symbolN.includes(subj)) {
        score += 0.08;
        reasons.push({ type: 'symbol_substring' });
        break;
      }
    }
  }

  // Minor boost for generic token overlap (de-emphasized)
  const { score: overlap, common } = jaccardFuzzy(queryTokens, marketAllTokens);
  if (overlap > 0) {
    score += Math.min(0.08, overlap * 0.10);
    if (reasons.length === 0 && common.length > 0) {
      reasons.push({ type: 'token_overlap', value: overlap, common: common.slice(0, 12) });
    }
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));
  return { score, reasons };
}

function uniqStrings(xs: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const v = String(x || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function escapeForSupabaseOr(term: string) {
  // Supabase `.or()` strings are comma-delimited; remove commas to avoid breaking the filter.
  return term.replace(/,/g, ' ').trim();
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting (same pattern as other API routes)
    const identifier = getClientIdentifier(request);
    try {
      const { success } = await rateLimit.limit(identifier);
      if (!success) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
    } catch (e) {
      // Local dev often runs without Upstash; don't fail similarity checks just because rate limiting
      // isn't configured. Other sensitive endpoints can keep strict enforcement.
      console.warn('rateLimit.limit failed; skipping rate limit for this request:', (e as Error)?.message || e);
    }

    const body = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { intent, name, description, category, status, metric_url } = parsed.data;
    const limit = parsed.data.limit ?? 5;

    const combined = [intent, name, description].filter(Boolean).join(' ').trim();
    if (!combined && !metric_url) {
      return NextResponse.json(
        { error: 'Provide at least one of intent, name, description, or metric_url' },
        { status: 400 }
      );
    }

    const capped = combined.slice(0, 1000).trim();
    const queryNormalized = capped ? normalizeText(capped) : '';
    const queryTokens = queryNormalized ? tokenizeNormalized(queryNormalized) : [];

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase server client not configured' },
        { status: 500 }
      );
    }

    const pLimit = Math.max(limit * 6, 30);

    let candidates: SimilarMarket[] = [];

    if (combined) {
      const terms = uniqStrings([capped, queryNormalized]);
      let rpcSucceeded = false;
      try {
        const all: SimilarMarket[] = [];
        const seenIds = new Set<string>();

        for (const t of terms) {
          const res = await supabase.rpc('search_markets', {
            search_term: t,
            p_category: category ?? null,
            p_status: status ?? null,
            p_limit: pLimit,
          });
          if (res.error) {
            console.warn('search_markets RPC error for term', t, res.error.message);
            continue;
          }
          rpcSucceeded = true;
          const rows: SimilarMarket[] = Array.isArray(res.data) ? (res.data as SimilarMarket[]) : [];
          for (const r of rows) {
            if (!r?.id) continue;
            if (seenIds.has(r.id)) continue;
            seenIds.add(r.id);
            all.push(r);
          }
        }

        candidates = all;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('search_markets RPC threw:', msg);
      }

      // Fallback: if RPC failed or returned nothing, query per-token with ilike.
      // Prioritize subject tokens (the actual topic) over generic words.
      if (candidates.length === 0) {
        const subjectTokens = extractSubjectTokens(queryTokens).filter((t) => t.length >= 3);
        const searchTokens = subjectTokens.length > 0
          ? subjectTokens
          : queryTokens.filter((t) => t.length >= 3);

        if (searchTokens.length > 0) {
          const orClauses = searchTokens
            .slice(0, 6)
            .flatMap((t) => {
              const escaped = escapeForSupabaseOr(t);
              return [
                `market_identifier.ilike.%${escaped}%`,
                `symbol.ilike.%${escaped}%`,
                `name.ilike.%${escaped}%`,
              ];
            })
            .join(',');

          let q = supabase
            .from('markets')
            .select(
              'id, market_identifier, symbol, name, description, category, market_status, is_active, total_volume, total_trades, last_trade_price, settlement_date, created_at, icon_image_url'
            )
            .order('created_at', { ascending: false })
            .limit(pLimit);

          if (category) q = q.contains('category', [category]);
          if (status) q = q.eq('market_status', status);

          q = q.or(orClauses);

          const { data: rows, error } = await q;
          if (error) {
            console.warn('Direct markets fallback query failed:', error.message);
          } else {
            candidates = Array.isArray(rows) ? (rows as SimilarMarket[]) : [];
          }
        }
      }
    }

    // Check for exact metric URL matches when a metric_url is provided.
    // Two-pass: first try exact JSONB containment, then normalize + filter in-memory as fallback
    // (handles trailing slashes, case differences, etc.).
    let metricUrlMatches: SimilarMarket[] = [];
    if (metric_url) {
      try {
        const normalizedMetricUrl = normalizeMetricUrl(metric_url);

        // Pass 1: exact JSONB containment (fast, indexed).
        const { data: exactRows, error: exactErr } = await supabase
          .from('markets')
          .select(
            'id, market_identifier, symbol, name, description, category, market_status, is_active, total_volume, total_trades, last_trade_price, settlement_date, created_at, icon_image_url, initial_order'
          )
          .contains('initial_order', { metricUrl: metric_url.trim() })
          .limit(10);

        if (!exactErr && Array.isArray(exactRows) && exactRows.length > 0) {
          metricUrlMatches = exactRows as SimilarMarket[];
        } else {
          // Pass 2: broader fetch + normalize in-memory.
          const { data: urlRows, error: urlErr } = await supabase
            .from('markets')
            .select(
              'id, market_identifier, symbol, name, description, category, market_status, is_active, total_volume, total_trades, last_trade_price, settlement_date, created_at, icon_image_url, initial_order'
            )
            .not('initial_order', 'is', null)
            .limit(200);

          if (!urlErr && Array.isArray(urlRows)) {
            metricUrlMatches = (urlRows as SimilarMarket[]).filter((row) => {
              const stored = (row.initial_order as any)?.metricUrl;
              if (typeof stored !== 'string') return false;
              return normalizeMetricUrl(stored) === normalizedMetricUrl;
            });
          }
        }
      } catch (e) {
        console.warn('Metric URL duplicate check failed:', e);
      }
    }

    const scored = combined
      ? candidates
          .map((m) => {
            const { score, reasons } = computeSimilarity({ queryNormalized, queryTokens, market: m });
            return { market: m, score, reasons };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const av = Number(a.market.total_volume ?? 0);
            const bv = Number(b.market.total_volume ?? 0);
            if (bv !== av) return bv - av;
            const at = a.market.created_at ? Date.parse(a.market.created_at) : 0;
            const bt = b.market.created_at ? Date.parse(b.market.created_at) : 0;
            return bt - at;
          })
          .slice(0, limit)
      : [];

    const subjectTokens = extractSubjectTokens(queryTokens);

    return NextResponse.json({
      query: {
        input: { intent: intent ?? null, name: name ?? null, description: description ?? null },
        normalized: queryNormalized,
        tokens: queryTokens,
        subject_tokens: subjectTokens,
        category: category ?? null,
        status: status ?? null,
        limit,
        metric_url: metric_url ?? null,
      },
      matches: scored.map((x) => ({
        ...x.market,
        score: x.score,
        reasons: x.reasons,
      })),
      metric_url_duplicates: metricUrlMatches.map((m) => ({
        id: m.id,
        market_identifier: m.market_identifier,
        symbol: m.symbol,
        name: m.name,
        description: m.description,
        category: m.category,
        market_status: m.market_status,
        metric_url: (m.initial_order as any)?.metricUrl ?? null,
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

