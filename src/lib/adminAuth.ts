import type { NextRequest } from 'next/server'

/**
 * Shared-secret admin auth for ops endpoints (e.g. /api/admin/withdrawals/*).
 *
 * Caller must send `Authorization: Bearer <ADMIN_API_KEY>` (or `x-admin-key`).
 * Set ADMIN_API_KEY in Vercel + .env.local; rotate independently from
 * trade/relayer secrets.
 */
export function requireAdmin(req: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const expected = String(process.env.ADMIN_API_KEY || '').trim()
  if (!expected) {
    return { ok: false, status: 500, error: 'admin_disabled: ADMIN_API_KEY not configured' }
  }
  const fromHeader = String(req.headers.get('x-admin-key') || '').trim()
  const fromBearer = (() => {
    const auth = String(req.headers.get('authorization') || '').trim()
    if (!auth.toLowerCase().startsWith('bearer ')) return ''
    return auth.slice(7).trim()
  })()
  const presented = fromHeader || fromBearer
  if (!presented) return { ok: false, status: 401, error: 'missing_admin_credential' }
  if (presented.length !== expected.length) return { ok: false, status: 401, error: 'unauthorized' }
  let diff = 0
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (diff !== 0) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true }
}
