import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  // Service removed; no-op for compatibility
  return NextResponse.json({ success: true, started: false });
}

export async function GET(_request: NextRequest) {
  // Service removed; report inert status
  return NextResponse.json({ success: true, status: { running: false } });
}