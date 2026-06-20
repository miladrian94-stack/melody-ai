import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh-token')?.value;

    if (refreshToken) {
      // Remove refresh token from database
      await prisma.session.deleteMany({
        where: { token: refreshToken },
      });
    }

    // Clear cookies
    AuthService.clearAuthCookie('auth-token');
    AuthService.clearAuthCookie('refresh-token');
    AuthService.clearAuthCookie('user-role');

    return NextResponse.json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
