import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8888',
  'https://preeminent-trifle-447f6d.netlify.app',
];

function getAllowedOrigins() {
  const fromEnv = process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '';
  return [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...fromEnv.split(',').map((item) => item.trim()).filter(Boolean),
  ];
}

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigins = getAllowedOrigins();
  const allowOrigin =
    allowedOrigins.includes(origin) || origin.endsWith('.netlify.app') || origin.endsWith('.vercel.app')
      ? origin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Organization-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(req),
    });
  }

  const res = NextResponse.next();
  const headers = corsHeaders(req);
  Object.entries(headers).forEach(([key, value]) => res.headers.set(key, value));
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
