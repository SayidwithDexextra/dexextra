import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Force a stuck or requires_manual withdrawal job back into the worker queue.
 *
 * Decides which retryable state to drop the row into based on what we know
 * was already on-chain:
 *   - withdraw_id present, no hub_send_tx → outbox_failed   (worker retries step 2)
 *   - hub_send_tx present, no spoke_deliver_tx → spoke_failed (worker retries step 3)
 *   - withdraw_id missing → cannot recover automatically; reject.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await ctx.params
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  const { data: job, error: getErr } = await supabaseAdmin
    .from('withdrawal_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (job.status === 'completed') {
    return NextResponse.json({ ok: true, alreadyCompleted: true, job })
  }
  if (!job.withdraw_id) {
    return NextResponse.json(
      { error: 'no_withdraw_id', message: 'Cannot auto-retry — hub debit never produced a withdrawId. Manual chain inspection required.' },
      { status: 409 }
    )
  }

  const requeueTo = job.spoke_deliver_tx ? 'completed'
    : job.hub_send_tx ? 'spoke_failed'
    : 'outbox_failed'

  if (requeueTo === 'completed') {
    return NextResponse.json({ ok: true, alreadyCompleted: true, job })
  }

  const { error: updErr } = await supabaseAdmin
    .from('withdrawal_jobs')
    .update({
      status: requeueTo,
      attempts: 0,
      earliest_run_at: new Date().toISOString(),
      last_error: `manual_retry_by_admin: ${new Date().toISOString()}`,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, requeuedTo: requeueTo, jobId: id })
}
