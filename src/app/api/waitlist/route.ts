import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { strictRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// Pragmatic email check — good enough to reject obvious junk without rejecting
// valid-but-unusual addresses. Real verification happens at send time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);

  // Throttle abuse per IP (shared 10/min strict limiter).
  try {
    const { success } = await strictRateLimit.limit(`waitlist:${ip}`);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Try again in a minute.' },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
  } catch (e) {
    console.warn('[waitlist] rate-limit check failed:', e);
  }

  let body: { email?: unknown; source?: unknown } = {};
  try {
    body = (await req.json()) as { email?: unknown; source?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!rawEmail || rawEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const source = typeof body.source === 'string' ? body.source.slice(0, 64) : 'coming-soon';

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Signups are temporarily unavailable. Please try again later.' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const { error } = await supabase.from('waitlist').insert({
    email: rawEmail,
    source,
    ip,
    user_agent: req.headers.get('user-agent')?.slice(0, 512) ?? null,
    referrer: req.headers.get('referer')?.slice(0, 512) ?? null,
  });

  if (error) {
    // Unique violation → already subscribed. Treat as success for a clean UX.
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: true, alreadySubscribed: true },
        { headers: NO_STORE_HEADERS },
      );
    }
    console.error('[waitlist] insert error:', error.message);
    return NextResponse.json(
      { error: 'Could not save your email. Please try again.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
