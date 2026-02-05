import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 30;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function safeExtFromContentType(ct: string | null) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('image/png')) return 'png';
  if (t.includes('image/jpeg') || t.includes('image/jpg')) return 'jpg';
  if (t.includes('image/webp')) return 'webp';
  if (t.includes('image/gif')) return 'gif';
  if (t.includes('image/svg+xml')) return 'svg';
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const urlRaw = String(body?.url || '').trim();
    const kind = String(body?.kind || 'icon').trim() || 'icon';
    if (!urlRaw) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    let u: URL;
    try {
      u = new URL(urlRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return NextResponse.json({ error: 'Unsupported url protocol' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });

    // Fetch with a hard timeout and a conservative size cap.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(u.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        // Some CDNs require a UA; keep generic.
        'User-Agent': 'Dexextra/1.0',
        Accept: 'image/*',
      },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return NextResponse.json(
        { error: `Fetch failed (${res.status})` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type');
    const ext = safeExtFromContentType(contentType);
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported content-type: ${contentType || 'unknown'}` },
        { status: 415 }
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const MAX_BYTES = 2 * 1024 * 1024; // 2MB (icons/logos should be small)
    if (!buf.length) {
      return NextResponse.json({ error: 'Empty image' }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${buf.length} bytes)` },
        { status: 413 }
      );
    }

    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const prefix = kind === 'banner' ? 'markets/banner' : kind === 'supporting' ? 'markets/supporting' : 'markets/icon';
    const filePath = `${prefix}/${fileName}`;

    const { error: upErr } = await supabase.storage
      .from('market-images')
      .upload(filePath, buf, { contentType: contentType || `image/${ext}`, upsert: false, cacheControl: '3600' });
    if (upErr) {
      return NextResponse.json({ error: upErr.message || 'Upload failed' }, { status: 500 });
    }

    const { data } = supabase.storage.from('market-images').getPublicUrl(filePath);
    const publicUrl = data?.publicUrl || null;
    if (!publicUrl) return NextResponse.json({ error: 'Failed to compute public URL' }, { status: 500 });

    return NextResponse.json({ ok: true, publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Import failed' }, { status: 500 });
  }
}

