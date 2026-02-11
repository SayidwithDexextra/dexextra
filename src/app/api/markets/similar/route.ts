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
  category: string;
  market_status: string;
  is_active?: boolean;
  total_volume: number | string | null;
  total_trades: number | null;
  last_trade_price: number | string | null;
  settlement_date: string | null;
  created_at: string | null;
};

const BodySchema = z
  .object({
    intent: z.string().trim().max(2000).optional(),
    name: z.string().trim().max(2000).optional(),
    description: z.string().trim().max(4000).optional(),
    category: z.string().trim().max(120).optional(),
    status: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(20).optional(),
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

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union <= 0 ? 0 : inter / union;
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

  // Substring matches (medium)
  if (queryN && queryN.length >= 3) {
    if (identifierN.includes(queryN)) {
      score += 0.15;
      reasons.push({ type: 'identifier_substring' });
    }
    if (symbolN.includes(queryN)) {
      score += 0.12;
      reasons.push({ type: 'symbol_substring' });
    }
    if (nameN.includes(queryN)) {
      score += 0.10;
      reasons.push({ type: 'name_substring' });
    }
    if (descriptionN.includes(queryN)) {
      score += 0.06;
      reasons.push({ type: 'description_substring' });
    }
  }

  // Token overlap (broad)
  const marketTokens = tokenizeNormalized([identifierN, symbolN, nameN, descriptionN].join(' '));
  const overlap = jaccard(queryTokens, marketTokens);
  if (overlap > 0) {
    const common = queryTokens.filter((t) => marketTokens.includes(t)).slice(0, 12);
    score += Math.min(0.25, overlap * 0.25);
    reasons.push({ type: 'token_overlap', value: overlap, common });
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

    const { intent, name, description, category, status } = parsed.data;
    const limit = parsed.data.limit ?? 5;

    const combined = [intent, name, description].filter(Boolean).join(' ').trim();
    if (!combined) {
      return NextResponse.json(
        { error: 'Provide at least one of intent, name, or description' },
        { status: 400 }
      );
    }

    // Cap combined length to avoid abuse / huge queries
    const capped = combined.slice(0, 1000).trim();
    const queryNormalized = normalizeText(capped);
    const queryTokens = tokenizeNormalized(queryNormalized);

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase server client not configured' },
        { status: 500 }
      );
    }

    const pLimit = Math.max(limit * 6, 30);

    // Candidate generation: use indexed `search_markets` RPC (active markets).
    // Important: call with both the RAW query and the normalized variant, then union results.
    const terms = uniqStrings([capped, queryNormalized]);
    let data: unknown = null;
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
          // If one term errors, keep going; we'll fall back to direct table search if needed.
          console.warn('search_markets RPC error for term', t, res.error.message);
          continue;
        }
        const rows: SimilarMarket[] = Array.isArray(res.data) ? (res.data as SimilarMarket[]) : [];
        for (const r of rows) {
          if (!r?.id) continue;
          if (seenIds.has(r.id)) continue;
          seenIds.add(r.id);
          all.push(r);
        }
      }

      data = all;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
      let hint: string | null = null;
      try {
        if (url) {
          const u = new URL(url);
          if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            hint = `Supabase URL points to ${u.hostname}:${u.port || '(default)'} — is your local Supabase running?`;
          }
        }
      } catch {
        // ignore URL parse errors; we still return a safe message
      }
      return NextResponse.json(
        {
          error: 'Failed to query Supabase',
          message: msg,
          hint,
        },
        { status: 500 }
      );
    }

    let candidates: SimilarMarket[] = Array.isArray(data) ? (data as SimilarMarket[]) : [];

    // Fallback: if the RPC returned nothing (or is unavailable), query the `markets` table directly.
    // This catches cases where RPC isn't deployed or when strict `is_active` filtering hides results.
    if (candidates.length === 0) {
      const t = escapeForSupabaseOr(capped || queryNormalized);
      let q = supabase
        .from('markets')
        .select(
          'id, market_identifier, symbol, name, description, category, market_status, is_active, total_volume, total_trades, last_trade_price, settlement_date, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(pLimit);

      if (category) q = q.eq('category', category);
      if (status) q = q.eq('market_status', status);

      if (t) {
        q = q.or(
          `market_identifier.ilike.%${t}%,symbol.ilike.%${t}%,name.ilike.%${t}%,description.ilike.%${t}%`
        );
      }

      const { data: rows, error } = await q;
      if (error) {
        console.warn('Direct markets fallback query failed:', error.message);
      } else {
        candidates = Array.isArray(rows) ? (rows as SimilarMarket[]) : [];
      }
    }

    const scored = candidates
      .map((m) => {
        const { score, reasons } = computeSimilarity({ queryNormalized, queryTokens, market: m });
        return { market: m, score, reasons };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Tie-break by volume then recency if present
        const av = Number(a.market.total_volume ?? 0);
        const bv = Number(b.market.total_volume ?? 0);
        if (bv !== av) return bv - av;
        const at = a.market.created_at ? Date.parse(a.market.created_at) : 0;
        const bt = b.market.created_at ? Date.parse(b.market.created_at) : 0;
        return bt - at;
      })
      .slice(0, limit);

    return NextResponse.json({
      query: {
        input: { intent: intent ?? null, name: name ?? null, description: description ?? null },
        normalized: queryNormalized,
        tokens: queryTokens,
        category: category ?? null,
        status: status ?? null,
        limit,
      },
      matches: scored.map((x) => ({
        ...x.market,
        score: x.score,
        reasons: x.reasons,
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

