import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { PITCH_COOKIE, expectedPitchToken, hashPitchPassword } from '@/lib/pitchAuth';

export const runtime = 'nodejs';

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  let password = '';
  try {
    const body = await request.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!tokensMatch(hashPitchPassword(password), expectedPitchToken())) {
    return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PITCH_COOKIE, expectedPitchToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PITCH_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
