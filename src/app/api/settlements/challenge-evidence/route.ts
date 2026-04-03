import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 4 * 1024 * 1024;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function extForMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
    }

    const form = await request.formData();
    const marketId = String(form.get('market_id') || '').trim();
    const file = form.get('file');

    if (!marketId) {
      return NextResponse.json({ error: 'market_id is required' }, { status: 400 });
    }
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: 'Invalid image type. Use JPEG, PNG, WebP, or GIF.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 4MB or smaller' }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extForMime(file.type)}`;
    const path = `settlement-challenges/${marketId}/${name}`;

    const { error: upErr } = await supabase.storage
      .from('market-images')
      .upload(path, buf, {
        contentType: file.type,
        upsert: false,
        cacheControl: '3600',
      });

    if (upErr) {
      console.error('[challenge-evidence] upload:', upErr);
      return NextResponse.json({ error: upErr.message || 'Upload failed' }, { status: 500 });
    }

    const { data } = supabase.storage.from('market-images').getPublicUrl(path);
    const publicUrl = data?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json({ error: 'Failed to resolve public URL' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, publicUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
