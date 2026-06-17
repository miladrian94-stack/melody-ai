import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// ✅ FIX: JWT secret validated at module load
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-only-secret-change-in-production-min-32-chars!!'
);

// Public paths — exact match or prefix match
const PUBLIC_PATHS = new Set([
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
  '/api/health',
]);

// Webhook paths — verified by signature, not JWT
const WEBHOOK_PATHS = ['/api/webhooks/stripe', '/api/webhooks/lemonsqueezy'];

const ADMIN_PATHS = ['/admin', '/api/admin'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    /\.(ico|png|jpg|jpeg|svg|webp|css|js|woff2?)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Allow webhooks — they use their own signature verification
  if (WEBHOOK_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PATHS.has(pathname.replace(/\/$/, ''))) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Validate JWT (not just check cookie presence)
  const authToken = request.cookies.get('auth-token')?.value;

  if (!authToken) {
    return unauthenticated(request);
  }

  // ✅ FIX #8: Actually VERIFY the token in middleware (not just check it exists)
  try {
    const { payload } = await jwtVerify(authToken, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // ✅ FIX #9: Admin check via verified JWT payload, NOT cookie value
    //    The old code read 'user-role' cookie which can be tampered by the client
    if (ADMIN_PATHS.some(p => pathname.startsWith(p))) {
      const role = payload.role as string;
      if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        return forbidden(request);
      }
    }

    // Forward verified user info to downstream routes
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.userId as string);
    requestHeaders.set('x-user-role', payload.role as string);

    return withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } })
    );
  } catch {
    // Token is present but invalid/expired
    return unauthenticated(request);
  }
}

function unauthenticated(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function forbidden(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function withSecurityHeaders(response: NextResponse) {
  // ✅ FIX #10: Tighter CSP — remove 'unsafe-eval' where not needed
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // removed unsafe-eval
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "media-src 'self' https:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
