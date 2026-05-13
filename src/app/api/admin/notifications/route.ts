import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getPusherServer } from '@/lib/pusher-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_SEVERITIES = ['info', 'success', 'warning', 'critical'] as const
const ALLOWED_KINDS = ['announcement', 'maintenance', 'release', 'incident'] as const

type Severity = (typeof ALLOWED_SEVERITIES)[number]
type Kind = (typeof ALLOWED_KINDS)[number]

interface PublishBody {
  title?: unknown
  body?: unknown
  severity?: unknown
  kind?: unknown
  cta_label?: unknown
  cta_href?: unknown
  expires_at?: unknown
  audience?: unknown
  created_by?: unknown
}

interface NotificationRow {
  id: string
  kind: Kind
  severity: Severity
  title: string
  body: string
  cta_label: string | null
  cta_href: string | null
  audience: Record<string, unknown>
  published_at: string
  expires_at: string | null
  created_by: string
  created_at: string
}

function pickString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.length > max ? s.slice(0, max) : s
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase() as T
  return allowed.includes(s) ? s : null
}

/**
 * POST /api/admin/notifications
 *
 * Publish a platform-wide notification. Authenticated via the shared-secret
 * admin pattern (see src/lib/adminAuth.ts).
 *
 * After the insert succeeds we fan out on Pusher's public
 * `platform-notifications` channel for instant client toasts/badges. The
 * Pusher trigger is best-effort: even if it fails, every open browser still
 * picks the row up via the Supabase Realtime subscription on
 * `public.notifications` (added to the publication in the migration).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: PublishBody = {}
  try {
    body = (await req.json()) as PublishBody
  } catch {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }

  const title = pickString(body.title, 140)
  const message = pickString(body.body, 2000)
  if (!title || !message) {
    return NextResponse.json(
      { error: 'title_and_body_required' },
      { status: 400 },
    )
  }

  const severity: Severity = pickEnum(body.severity, ALLOWED_SEVERITIES) ?? 'info'
  const kind: Kind = pickEnum(body.kind, ALLOWED_KINDS) ?? 'announcement'

  const ctaLabel = pickString(body.cta_label, 40)
  const ctaHref = pickString(body.cta_href, 500)
  // We don't let admins publish a CTA label without an href — the panel would
  // render a button that did nothing.
  if (ctaLabel && !ctaHref) {
    return NextResponse.json(
      { error: 'cta_label_requires_cta_href' },
      { status: 400 },
    )
  }

  let expiresAt: string | null = null
  if (body.expires_at != null) {
    if (typeof body.expires_at !== 'string') {
      return NextResponse.json({ error: 'invalid_expires_at' }, { status: 400 })
    }
    const t = Date.parse(body.expires_at)
    if (!Number.isFinite(t)) {
      return NextResponse.json({ error: 'invalid_expires_at' }, { status: 400 })
    }
    expiresAt = new Date(t).toISOString()
  }

  // v1 only supports {"scope":"all"}, but we accept arbitrary jsonb so admins
  // can start tagging notifications today and we can grow filters later.
  const audience =
    body.audience && typeof body.audience === 'object'
      ? (body.audience as Record<string, unknown>)
      : { scope: 'all' }

  const createdBy = pickString(body.created_by, 80) ?? 'admin-api'

  const { data: inserted, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      kind,
      severity,
      title,
      body: message,
      cta_label: ctaLabel,
      cta_href: ctaHref,
      audience,
      expires_at: expiresAt,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error || !inserted) {
    console.error('[admin/notifications] insert failed:', error?.message)
    return NextResponse.json(
      { error: 'insert_failed', detail: error?.message ?? null },
      { status: 500 },
    )
  }

  const row = inserted as NotificationRow

  // Pusher fan-out. Failures here are non-fatal because Supabase Realtime
  // is the durable channel — log loudly and return the row anyway.
  try {
    const pusher = getPusherServer() as unknown as {
      pusher: { trigger: (c: string, e: string, d: unknown) => Promise<unknown> }
    }
    await pusher.pusher.trigger('platform-notifications', 'new', row)
  } catch (e) {
    console.error(
      '[admin/notifications] pusher fan-out failed (durable channel still active):',
      e,
    )
  }

  return NextResponse.json({ notification: row }, { status: 201 })
}

/**
 * GET /api/admin/notifications?limit=50&includeExpired=true
 *
 * Admin-only listing for the (future) authoring UI.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50),
  )
  const includeExpired = url.searchParams.get('includeExpired') === 'true'

  let q = supabaseAdmin
    .from('notifications')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (!includeExpired) {
    q = q.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ notifications: data ?? [], limit, includeExpired })
}
