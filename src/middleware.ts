import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

// Import server startup services
let serverStartupPromise: Promise<void> | null = null;

export async function middleware(request: NextRequest) {
  // Initialize server services on first API request
  if (request.nextUrl.pathname.startsWith('/api/') && !serverStartupPromise) {
    console.log('🔄 First API request detected, initializing server services...');
    
    // Use dynamic import to avoid circular dependencies and ensure it runs server-side
    serverStartupPromise = (async () => {
      try {
        const { initializeServerServices } = await import('@/lib/server-startup');
        await initializeServerServices();
      } catch (error) {
        console.error('❌ Server startup failed:', error);
      }
    })();
  }
  
  // Don't block the request - let services initialize in background
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
} 