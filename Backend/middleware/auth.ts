import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

// ✅ FIX: Use same secret key as auth.ts (was different before — 'your-secret-key' vs actual secret)
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-only-secret-change-in-production-min-32-chars!!'
);

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  tier: string;
  isActive: boolean;
}

export async function authMiddleware(req: NextRequest): Promise<
  { user: AuthenticatedUser; response?: never } |
  { user?: never; response: NextResponse }
> {
  const token = req.cookies.get('auth-token')?.value;

  if (!token) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // ✅ FIX: Always verify user still exists and is active (not just trust the JWT)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
      select: { id: true, email: true, role: true, tier: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return {
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }

    return { user };
  } catch {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
}

export function requireRole(allowedRoles: string[]) {
  return async (req: NextRequest): Promise<NextResponse | null> => {
    const result = await authMiddleware(req);

    if (result.response) return result.response;

    if (!allowedRoles.includes(result.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return null; // OK to proceed
  };
}
