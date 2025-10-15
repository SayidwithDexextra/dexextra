import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Don't block the request - let services initialize in background
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
} 