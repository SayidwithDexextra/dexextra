import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NON_TERMINAL = [
  'pending',
  'hub_debiting',
  'hub_debited',
  'hub_sending',
  'hub_sent',
  'spoke_pending',
  'spoke_delivering',
  'outbox_failed',
  'spoke_failed',
  'requires_manual',
] as const

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const filter = String(url.searchParams.get('filter') || 'stuck').toLowerCase()
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const stuckSeconds = Math.max(60, parseInt(url.searchParams.get('stuckSeconds') || '600', 10) || 600)

  let q = supabaseAdmin
    .from('withdrawal_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filter === 'requires_manual') {
    q = q.eq('status', 'requires_manual')
  } else if (filter === 'stuck') {
    const cutoff = new Date(Date.now() - stuckSeconds * 1000).toISOString()
    q = q.in('status', NON_TERMINAL as unknown as string[]).lt('updated_at', cutoff)
  } else if (filter === 'all_open') {
    q = q.in('status', NON_TERMINAL as unknown as string[])
  } else if (filter === 'completed') {
    q = q.eq('status', 'completed')
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [], filter, limit })
}
