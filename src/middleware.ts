import { NextResponse } from 'next/server'

export async function middleware() {
  // Just pass through the request
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
} 