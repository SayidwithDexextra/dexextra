import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { strictRateLimit } from '@/lib/rate-limit';

const SETTINGS_KEY = 'coming_soon_unlocked';

// Always evaluate fresh — once the gate is unlocked, we want every browser to
// see it on the very next request, not minutes later from a CDN edge.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ComingSoonValue {
  unlocked: boolean;
  unlocked_at: string | null;
  unlocked_by_ip?: string | null;
}

interface ComingSoonResponse {
  unlocked: boolean;
  unlocked_at: string | null;
}

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

// Default access code preserved from the previous client-side implementation
// so existing deployments keep working without any env changes. Operators can
// override with COMING_SOON_PASSWORD (preferred) or NEXT_PUBLIC_COMING_SOON_PASSWORD.
const DEFAULT_PASSWORD = 'dexetera2026';

function getServerPassword(): string {
  const pw = (
    process.env.COMING_SOON_PASSWORD ||
    process.env.NEXT_PUBLIC_COMING_SOON_PASSWORD ||
    DEFAULT_PASSWORD
  ).trim();
  return pw.length ? pw : DEFAULT_PASSWORD;
}

async function readUnlockState(): Promise<ComingSoonResponse> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    // Without Supabase we can't track global state. Fail open ONLY in dev so
    // local devs aren't permanently locked out; in prod we keep the gate up.
    return { unlocked: process.env.NODE_ENV !== 'production', unlocked_at: null };
  }

  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    console.error('[coming-soon] read error:', error.message);
    return { unlocked: false, unlocked_at: null };
  }

  const value = (data?.value as ComingSoonValue | null) || null;
  return {
    unlocked: Boolean(value?.unlocked),
    unlocked_at: value?.unlocked_at ?? null,
  };
}

export async function GET(): Promise<NextResponse<ComingSoonResponse>> {
  const state = await readUnlockState();
  return NextResponse.json(state, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);

  // Throttle brute-force attempts per IP.
  try {
    const { success } = await strictRateLimit.limit(`coming-soon:${ip}`);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in a minute.' },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
  } catch (e) {
    // Rate limiter failures shouldn't block legitimate users.
    console.warn('[coming-soon] rate-limit check failed:', e);
  }

  let body: { code?: unknown } = {};
  try {
    body = (await req.json()) as { code?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const submitted = typeof body.code === 'string' ? body.code.trim() : '';
  const expected = getServerPassword();

  // If somebody already unlocked it, treat any POST as success — saves a Supabase
  // round-trip turning into a confusing "invalid code" UX after the fact.
  const current = await readUnlockState();
  if (current.unlocked) {
    return NextResponse.json(
      { unlocked: true, unlocked_at: current.unlocked_at },
      { headers: NO_STORE_HEADERS },
    );
  }

  if (submitted !== expected) {
    return NextResponse.json(
      { error: 'Invalid access code.' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Database not configured. Cannot persist unlock.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const unlockedAt = new Date().toISOString();
  const newValue: ComingSoonValue = {
    unlocked: true,
    unlocked_at: unlockedAt,
    unlocked_by_ip: ip,
  };

  const { error: upsertError } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value: newValue }, { onConflict: 'key' });

  if (upsertError) {
    console.error('[coming-soon] upsert error:', upsertError.message);
    return NextResponse.json(
      { error: 'Failed to persist unlock.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { unlocked: true, unlocked_at: unlockedAt },
    { headers: NO_STORE_HEADERS },
  );
}
