import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getSupabaseServer } from '@/lib/supabase-server'

function requireDebugAuth(req: Request): string | null {
  const token = String(process.env.DEBUG_API_TOKEN || '').trim()
  if (!token) return 'DEBUG_API_TOKEN is not configured on the server'
  const got = req.headers.get('x-debug-token') || req.headers.get('authorization') || ''
  // Allow either: `x-debug-token: <token>` OR `Authorization: Bearer <token>`
  const bearer = got.toLowerCase().startsWith('bearer ') ? got.slice(7).trim() : got.trim()
  if (bearer !== token) return 'unauthorized'
  return null
}

function parseAddressMaybe(v: string | null): string | null {
  try {
    if (!v) return null
    return ethers.getAddress(v.trim())
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const authErr = requireDebugAuth(req)
  if (authErr) {
    // Keep response vague in prod
    return NextResponse.json({ error: 'forbidden', details: authErr }, { status: 403 })
  }

  const sb = getSupabaseServer()
  if (!sb) {
    return NextResponse.json(
      {
        ok: false,
        allocator: 'disabled_or_misconfigured',
        needs: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      },
      { status: 500 }
    )
  }

  const url = new URL(req.url)
  const relayer = parseAddressMaybe(url.searchParams.get('relayer'))
  const chainIdRaw = url.searchParams.get('chainId')
  const chainId = chainIdRaw ? Number(chainIdRaw) : null

  // Health check: can we read the tables?
  const health: any = { ok: true }
  try {
    const q = sb
      .from('relayer_keys')
      .select('relayer_address, chain_id, next_nonce, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5)
    const { data, error } = await q
    if (error) throw error
    health.relayer_keys_recent = data || []
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, allocator: 'error', error: String(e?.message || e) },
      { status: 500 }
    )
  }

  // Recent txs (optionally filtered)
  let txs: any[] = []
  try {
    let q: any = sb
      .from('relayer_txs')
      .select('id, relayer_address, chain_id, nonce, status, tx_hash, label, created_at, updated_at')
      .order('id', { ascending: false })
      .limit(50)

    if (relayer) q = q.eq('relayer_address', relayer.toLowerCase())
    if (chainId !== null && Number.isFinite(chainId)) q = q.eq('chain_id', chainId)

    const { data, error } = await q
    if (error) throw error
    txs = data || []
  } catch (e: any) {
    // Non-fatal; still return health
    txs = [{ error: String(e?.message || e) }] as any
  }

  // Pending count per relayer (allocated/broadcasted in last 30m)
  let pending: any[] = []
  try {
    const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    let q: any = sb
      .from('relayer_txs')
      .select('relayer_address, chain_id, status, created_at')
      .in('status', ['allocated', 'broadcasted'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(500)
    if (relayer) q = q.eq('relayer_address', relayer.toLowerCase())
    if (chainId !== null && Number.isFinite(chainId)) q = q.eq('chain_id', chainId)
    const { data, error } = await q
    if (error) throw error

    const map = new Map<string, number>()
    for (const r of data || []) {
      const k = `${r.relayer_address}:${r.chain_id}`
      map.set(k, (map.get(k) || 0) + 1)
    }
    pending = Array.from(map.entries()).map(([key, count]) => {
      const [relayer_address, chain_id] = key.split(':')
      return { relayer_address, chain_id: Number(chain_id), pending_count: count }
    })
  } catch (e: any) {
    pending = [{ error: String(e?.message || e) }] as any
  }

  return NextResponse.json({
    ok: true,
    allocator: 'supabase',
    filters: { relayer, chainId },
    health,
    pending,
    recent: txs,
  })
}




