import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { rateLimit } from '@/middleware/rate-limit';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export async function POST(req: NextRequest) {
  try {
    const rateLimitResult = await rateLimit(req, { max: 5, window: 3600 });
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validation = resetPasswordSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          }))
        },
        { status: 400 }
      );
    }

    const { token, password } = validation.data;

    // Find user with valid reset token
    const users = await prisma.$queryRaw<Array<{ id: string; email: string; resetTokenExpiry: Date }>>`
      SELECT id, email, "resetTokenExpiry" 
      FROM users 
      WHERE "resetToken" = ${token}
        AND "resetTokenExpiry" > NOW()
    `;

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    const user = users[0];

    // Hash new password
    const hashedPassword = await AuthService.hashPassword(password);

    // Update user
    await prisma.$executeRaw`
      UPDATE users 
      SET 
        password = ${hashedPassword},
        "resetToken" = NULL,
        "resetTokenExpiry" = NULL,
        "updatedAt" = NOW()
      WHERE id = ${user.id}
    `;

    // Invalidate all existing sessions for security
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        userAgent: req.headers.get('user-agent') || 'unknown',
      },
    });

    return NextResponse.json({
      message: 'Password has been reset successfully. Please login with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
