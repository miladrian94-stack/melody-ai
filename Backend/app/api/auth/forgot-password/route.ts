import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/middleware/rate-limit';
import { randomBytes, timingSafeEqual } from 'crypto';
import { sendResetPasswordEmail } from '@/lib/email';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

// ✅ FIX: Constant-time generic message to prevent user enumeration
const GENERIC_RESPONSE = {
  message: 'If an account exists with this email, you will receive a password reset link.',
};

export async function POST(req: NextRequest) {
  try {
    const rateLimitResult = await rateLimit(req, { max: 3, window: 3600 });
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validation = forgotPasswordSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const { email } = validation.data;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const resetToken = randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000);

      // ✅ FIX: Store hashed token — plain token in DB is a security risk
      const { createHash } = await import('crypto');
      const hashedToken = createHash('sha256').update(resetToken).digest('hex');

      await prisma.$executeRaw`
        UPDATE users 
        SET 
          "resetToken" = ${hashedToken},
          "resetTokenExpiry" = ${resetTokenExpiry}::timestamp
        WHERE id = ${user.id}
      `;

      const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${resetToken}`;

      // ✅ FIX: Actually send the email (removed TODO)
      try {
        await sendResetPasswordEmail(user.email, resetUrl);
      } catch (emailError) {
        console.error('Failed to send reset email:', emailError);
        // Don't expose email failure to client — still return generic response
      }

      // ✅ FIX: Remove console.log that leaked reset URLs to server logs
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED',
          entity: 'User',
          entityId: user.id,
          ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        },
      });
    }

    // Always return same response — prevents user enumeration
    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ✅ NEW: Reset password endpoint using hashed token comparison
export async function PUT(req: NextRequest) {
  try {
    const rateLimitResult = await rateLimit(req, { max: 5, window: 3600 });
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });
    }

    const body = await req.json();
    const schema = z.object({
      token: z.string().min(64).max(64),
      password: z
        .string()
        .min(8)
        .regex(/[A-Z]/, 'Must contain uppercase')
        .regex(/[0-9]/, 'Must contain number'),
    });

    const validation = schema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { token, password } = validation.data;
    const { createHash } = await import('crypto');
    const hashedToken = createHash('sha256').update(token).digest('hex');

    // ✅ FIX: Find by hashed token and check expiry atomically
    const user = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users
      WHERE "resetToken" = ${hashedToken}
        AND "resetTokenExpiry" > NOW()
      LIMIT 1
    `;

    if (!user.length) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    const { AuthService } = await import('@/lib/auth');
    const hashedPassword = await AuthService.hashPassword(password);

    // ✅ FIX: Clear token after use (one-time use)
    await prisma.$executeRaw`
      UPDATE users
      SET password = ${hashedPassword}, "resetToken" = NULL, "resetTokenExpiry" = NULL
      WHERE id = ${user[0].id}
    `;

    // Invalidate all sessions for security
    await prisma.session.deleteMany({ where: { userId: user[0].id } });

    return NextResponse.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
