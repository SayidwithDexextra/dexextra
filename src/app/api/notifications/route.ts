import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  )
}

function isLikelyAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(value)
}

/**
 * GET /api/notifications?wallet=0x...&limit=50
 *
 * Returns the recent (non-expired) notifications, plus per-wallet read state.
 * `wallet` is optional — when omitted (e.g. disconnected visitor) we return
 * the same list with `is_read: false` for everything and `unreadCount` based
 * on the full list. The client treats anon as "all unread but cannot mark".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50),
  )
  const walletRaw = (url.searchParams.get('wallet') || '').trim().toLowerCase()
  const wallet = isLikelyAddress(walletRaw) ? walletRaw : ''

  // Cheap per-IP throttle. The feed is publicly cacheable shape-wise, but
  // we don't want a single client hammering Supabase.
  try {
    const { success } = await rateLimit.limit(`notifications:feed:${clientIp(req)}`)
    if (!success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: NO_STORE_HEADERS },
      )
    }
  } catch {
    // best-effort — never block on the limiter
  }

  const nowIso = new Date().toISOString()
  const { data: notifs, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[notifications/feed] read error:', error.message)
    return NextResponse.json(
      { error: 'read_failed' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const list = notifs ?? []
  const ids = list.map((n) => n.id as string)

  let readIds = new Set<string>()
  if (wallet && ids.length > 0) {
    const { data: reads, error: readsErr } = await supabaseAdmin
      .from('notification_reads')
      .select('notification_id')
      .eq('wallet_address', wallet)
      .in('notification_id', ids)
    if (readsErr) {
      console.error('[notifications/feed] reads error:', readsErr.message)
    } else if (reads) {
      readIds = new Set(reads.map((r) => r.notification_id as string))
    }
  }

  const items = list.map((n) => ({
    ...n,
    is_read: readIds.has(n.id as string),
  }))
  const unreadCount = items.reduce((acc, n) => (n.is_read ? acc : acc + 1), 0)

  return NextResponse.json(
    { items, unreadCount, wallet: wallet || null },
    { headers: NO_STORE_HEADERS },
  )
}
