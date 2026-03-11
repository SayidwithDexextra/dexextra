import { NextRequest, NextResponse } from 'next/server'

// Same-origin JSON-RPC proxy to avoid browser CORS issues.
// Used primarily for embedded wallets (Magic) which run in-browser.

const UPSTREAM =
  process.env.ARBITRUM_RPC_URL ||
  process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL ||
  'https://arbitrum-one-rpc.publicnode.com'

function redactUpstream(url: string): string {
  try {
    const u = new URL(url)
    // Redact API-key-like last path segment (common for Alchemy/Infura).
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length > 0) {
      parts[parts.length - 1] = '***'
      u.pathname = '/' + parts.join('/')
    }
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return '***'
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: true, upstream: redactUpstream(UPSTREAM) },
    { headers: { 'cache-control': 'no-store' } }
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    )
  }

  const upstreamRes = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // Never cache JSON-RPC responses.
    cache: 'no-store',
  })

  const text = await upstreamRes.text()
  return new NextResponse(text, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  })
}

