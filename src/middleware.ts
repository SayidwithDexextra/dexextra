import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

// IP addresses that bypass geo-restrictions (comma-separated in env var)
const IP_WHITELIST = process.env.GEO_BYPASS_IP_WHITELIST?.split(',').map(ip => ip.trim()).filter(Boolean) || []

// Paths that should always be accessible regardless of geo location
const GEO_EXEMPT_PATHS = [
  '/terms',
  '/privacy',
  '/support',
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/static',
  '/Dexicon',
  '/charting_library',
]

// API routes that should be BLOCKED for geo-restricted users (action endpoints only)
// Read-only data APIs (markets, prices, charts) remain accessible
const GEO_RESTRICTED_API_ROUTES = [
  '/api/orders',           // Order placement
  '/api/gasless',          // Gasless trading sessions
  '/api/withdraw',         // Withdrawals
  '/api/deposit',          // Deposits (if exists)
  '/api/settlements',      // Settlement actions
  '/api/resolve-market',   // Market resolution
]

// Blocked countries (ISO 3166-1 alpha-2 codes)
const BLOCKED_COUNTRIES = ['US']

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  
  // Always allow exempt paths (legal pages, static assets, health checks)
  if (GEO_EXEMPT_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Check if IP is whitelisted to bypass geo-restrictions
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || request.ip 
    || ''
  
  if (IP_WHITELIST.length > 0 && IP_WHITELIST.includes(clientIp)) {
    // Whitelisted IP - bypass all geo-restrictions
    const response = NextResponse.next()
    response.cookies.delete('geo-blocked')
    response.cookies.delete('geo-country')
    return response
  }

  // Get country from Vercel's geo headers (available on Vercel Edge)
  // Priority: request.geo (Edge Runtime) > x-vercel-ip-country header
  const country = request.geo?.country || request.headers.get('x-vercel-ip-country') || ''
  const isBlockedCountry = BLOCKED_COUNTRIES.includes(country)
  
  // For API routes: only block specific action endpoints, allow read-only data APIs
  if (pathname.startsWith('/api/')) {
    const isRestrictedEndpoint = GEO_RESTRICTED_API_ROUTES.some(route => pathname.startsWith(route))
    
    if (isBlockedCountry && isRestrictedEndpoint) {
      return new NextResponse(
        JSON.stringify({ 
          error: 'Access denied', 
          message: 'This action is not available in your region.',
          code: 'GEO_RESTRICTED' 
        }),
        { 
          status: 403, 
          headers: { 
            'Content-Type': 'application/json',
            'X-Geo-Blocked': 'true',
            'X-Geo-Country': country,
          } 
        }
      )
    }
    return NextResponse.next()
  }

  // For page routes: set header flag so client can show warning modal
  const response = NextResponse.next()
  
  if (isBlockedCountry) {
    // Set headers that the client can read to show the geo-block warning
    response.headers.set('X-Geo-Blocked', 'true')
    response.headers.set('X-Geo-Country', country)
    
    // Also set a cookie so client-side JS can detect blocked status
    response.cookies.set('geo-blocked', 'true', {
      httpOnly: false, // Allow client-side access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 5, // 5 minutes - short-lived for VPN switching
    })
    response.cookies.set('geo-country', country, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 5,
    })
  } else {
    // Clear geo-block cookies if user is not from blocked country
    response.cookies.delete('geo-blocked')
    response.cookies.delete('geo-country')
  }
  
  return response
}

export const config = {
  // Match all routes except static files
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
} 