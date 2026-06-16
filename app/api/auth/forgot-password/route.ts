import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/middleware/rate-limit';
import { randomBytes } from 'crypto';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export async function POST(req: NextRequest) {
  try {
    // Strict rate limiting for password reset
    const rateLimitResult = await rateLimit(req, { max: 3, window: 3600 }); // 3 attempts per hour
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validation = forgotPasswordSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const { email } = validation.data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      return NextResponse.json({
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    // Store reset token
    await prisma.$executeRaw`
      UPDATE users 
      SET 
        "resetToken" = ${resetToken},
        "resetTokenExpiry" = ${resetTokenExpiry}::timestamp
      WHERE id = ${user.id}
    `;

    // Send email (implement your email service)
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${resetToken}`;
    
    // TODO: Implement email sending
    // await sendResetPasswordEmail(user.email, resetUrl);

    // Log for development
    console.log('Password reset URL:', resetUrl);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    return NextResponse.json({
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
