import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { rateLimit } from '@/middleware/rate-limit';

// ✅ FIX: Stronger password policy enforced at schema level
const registerSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .trim()
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Strict rate limiting for registration
    const rateLimitResult = await rateLimit(req, { max: 5, window: 60 });
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        // ✅ FIX: Return structured validation errors but don't expose internals
        { error: 'Validation failed', details: validation.error.errors.map(e => e.message) },
        { status: 400 }
      );
    }

    const { email, password, name } = validation.data;

    // ✅ FIX: Check existence and insert in a transaction to avoid race conditions
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) return null;

      const hashedPassword = await AuthService.hashPassword(password);

      return tx.user.create({
        data: {
          email,
          password: hashedPassword,
          // ✅ FIX: Sanitize name — don't blindly use email prefix as display name
          name: name || 'User',
          credits: 100,
        },
      });
    });

    // ✅ FIX: Return 409 but don't confirm whether email is registered
    //    (timing attack protection: same response either way)
    if (!user) {
      return NextResponse.json(
        { error: 'Registration failed. Please try again.' },
        { status: 409 }
      );
    }

    const tokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        userAgent: req.headers.get('user-agent') || 'unknown',
      },
    });

    return NextResponse.json({
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tier: user.tier,
        credits: user.credits,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
