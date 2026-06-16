import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh-token')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Refresh token not found' },
        { status: 401 }
      );
    }

    const tokens = await AuthService.refreshAccessToken(refreshToken);

    // Set new cookies
    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    return NextResponse.json({
      message: 'Tokens refreshed successfully',
    });
  } catch (error) {
    // Clear invalid tokens
    AuthService.clearAuthCookie('auth-token');
    AuthService.clearAuthCookie('refresh-token');

    return NextResponse.json(
      { error: 'Invalid refresh token' },
      { status: 401 }
    );
  }
}
