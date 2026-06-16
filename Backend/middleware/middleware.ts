import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Paths that don't require authentication
const publicPaths = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/pricing',
  '/features',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google',
  '/api/auth/forgot-password',
  '/api/webhooks/stripe',
  '/api/webhooks/lemonsqueezy',
  '/api/health',
];

// Admin-only paths
const adminPaths = ['/admin', '/api/admin'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Allow static files and public assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/public') ||
    pathname.includes('.') // files like favicon.ico
  ) {
    return NextResponse.next();
  }

  // Check for auth token
  const authToken = request.cookies.get('auth-token')?.value;

  if (!authToken) {
    // Redirect to login for page requests
    if (!pathname.startsWith('/api')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin access
  if (adminPaths.some(path => pathname.startsWith(path))) {
    const userRole = request.cookies.get('user-role')?.value;
    if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      if (!pathname.startsWith('/api')) {
        return NextResponse.redirect(new URL('/', request.url));
      }
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Add security headers
  const response = NextResponse.next();
  
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:;"
  );
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  );

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
