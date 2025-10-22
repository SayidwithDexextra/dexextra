import { NextRequest, NextResponse } from 'next/server'
import { startOrderbookWsWatchers } from '@/services/realtime/orderbookWsWatcher'

let activeUnsubs: Array<() => void> = []

export async function POST(_req: NextRequest) {
  try {
    if (process.env.ENABLE_WS_ORDERBOOK !== 'true') {
      return NextResponse.json({ ok: false, message: 'WS orderbook disabled' }, { status: 403 })
    }

    // If already running, no-op
    if (activeUnsubs.length > 0) {
      return NextResponse.json({ ok: true, message: 'Already running' })
    }

    activeUnsubs = startOrderbookWsWatchers()
    return NextResponse.json({ ok: true, message: `Started ${activeUnsubs.length} watchers` })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest) {
  try {
    activeUnsubs.forEach((u) => { try { u() } catch {} })
    activeUnsubs = []
    return NextResponse.json({ ok: true, message: 'Stopped watchers' })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'failed' }, { status: 500 })
  }
}
