import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manually resolve a stuck withdrawal job. Two outcomes are supported:
 *
 *   resolution = "completed"   → Operator verified delivery on-chain (e.g.
 *                                manually sent the spoke tx, or refunded the
 *                                user out-of-band). Sets status=completed.
 *
 *   resolution = "abandoned"   → Operator decided not to recover (e.g.
 *                                permanent failure handled separately). The
 *                                row is moved to `requires_manual` with a
 *                                terminal `last_error` so it never re-enters
 *                                the worker queue.
 *
 * Body: { resolution, note?, spoke_deliver_tx?, spoke_deliver_block? }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await ctx.params
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}

  const resolution = String(body?.resolution || '').toLowerCase()
  const note = String(body?.note || '').slice(0, 500)
  const operator = String(body?.operator || '').slice(0, 200)

  if (resolution !== 'completed' && resolution !== 'abandoned') {
    return NextResponse.json(
      { error: 'invalid_resolution', expected: ['completed', 'abandoned'] },
      { status: 400 }
    )
  }

  const { data: job, error: getErr } = await supabaseAdmin
    .from('withdrawal_jobs')
    .select('id, metadata, status')
    .eq('id', id)
    .maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const audit = {
    ...(job.metadata || {}),
    admin_resolution: {
      resolution,
      note,
      operator,
      at: new Date().toISOString(),
      previous_status: job.status,
    },
  }

  if (resolution === 'completed') {
    const tx = body?.spoke_deliver_tx ? String(body.spoke_deliver_tx) : null
    const block = body?.spoke_deliver_block != null ? Number(body.spoke_deliver_block) : null
    const { error: updErr } = await supabaseAdmin
      .from('withdrawal_jobs')
      .update({
        status: 'completed',
        spoke_deliver_tx: tx,
        spoke_deliver_block: block,
        completed_at: new Date().toISOString(),
        last_error: null,
        metadata: audit,
      })
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, resolution: 'completed' })
  }

  // abandoned
  const { error: updErr } = await supabaseAdmin
    .from('withdrawal_jobs')
    .update({
      status: 'requires_manual',
      last_error: `abandoned_by_admin: ${note || 'no_note'} (operator=${operator || 'unknown'})`,
      metadata: audit,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, resolution: 'abandoned' })
}
