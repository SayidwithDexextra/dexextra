import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
}

interface ReadBody {
  wallet?: unknown
  ids?: unknown
  all?: unknown
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

/**
 * POST /api/notifications/read
 *
 * Body:
 *   { wallet: "0x...", ids: ["uuid", ...] }   — mark specific notifications read
 *   { wallet: "0x...", all: true }            — mark every active notification read
 *
 * The wallet is the canonical user identity in this codebase (see
 * src/lib/userProfileService.ts). We require it to come from the body rather
 * than inferring from auth because the rest of the app does the same
 * (the user-profile API, the portfolio endpoints, etc).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ReadBody = {}
  try {
    body = (await req.json()) as ReadBody
  } catch {
    return NextResponse.json(
      { error: 'invalid_json_body' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const walletRaw = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
  if (!walletRaw || !isLikelyAddress(walletRaw)) {
    return NextResponse.json(
      { error: 'wallet_required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const { success } = await rateLimit.limit(
      `notifications:read:${walletRaw}:${clientIp(req)}`,
    )
    if (!success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: NO_STORE_HEADERS },
      )
    }
  } catch {
    // best-effort
  }

  let targetIds: string[] = []

  if (body.all === true) {
    const nowIso = new Date().toISOString()
    const { data: active, error } = await supabaseAdmin
      .from('notifications')
      .select('id')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    if (error) {
      console.error('[notifications/read] list active failed:', error.message)
      return NextResponse.json(
        { error: 'read_failed' },
        { status: 500, headers: NO_STORE_HEADERS },
      )
    }
    targetIds = (active ?? []).map((r) => r.id as string)
  } else if (Array.isArray(body.ids)) {
    targetIds = body.ids
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(isUuid)
    // Hard cap: prevent abuse via huge id lists.
    if (targetIds.length > 200) targetIds = targetIds.slice(0, 200)
  } else {
    return NextResponse.json(
      { error: 'ids_or_all_required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ marked: 0 }, { headers: NO_STORE_HEADERS })
  }

  const rows = targetIds.map((id) => ({
    wallet_address: walletRaw,
    notification_id: id,
  }))

  const { error: upsertErr } = await supabaseAdmin
    .from('notification_reads')
    .upsert(rows, { onConflict: 'wallet_address,notification_id', ignoreDuplicates: true })

  if (upsertErr) {
    console.error('[notifications/read] upsert failed:', upsertErr.message)
    return NextResponse.json(
      { error: 'upsert_failed', detail: upsertErr.message },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  return NextResponse.json(
    { marked: rows.length },
    { headers: NO_STORE_HEADERS },
  )
}
