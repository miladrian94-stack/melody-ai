import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=no_code', req.url)
      );
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Google token exchange failed:', await tokenResponse.text());
      return NextResponse.redirect(
        new URL('/login?error=google_auth_failed', req.url)
      );
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    if (!userInfoResponse.ok) {
      return NextResponse.redirect(
        new URL('/login?error=user_info_failed', req.url)
      );
    }

    const googleUser = await userInfoResponse.json();

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.id },
          { email: googleUser.email },
        ],
      },
    });

    if (user) {
      // Update existing user with Google info
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.id,
          avatar: user.avatar || googleUser.picture,
          emailVerified: user.emailVerified || new Date(),
          name: user.name || googleUser.name,
          lastLoginAt: new Date(),
        },
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture,
          googleId: googleUser.id,
          emailVerified: new Date(),
          credits: 100, // Free tier credits
          lastLoginAt: new Date(),
        },
      });
    }

    // Generate JWT tokens
    const authTokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set cookies
    AuthService.setAuthCookie('auth-token', authTokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', authTokens.refreshToken, 7 * 24 * 60 * 60);
    AuthService.setAuthCookie('user-role', user.role, 7 * 24 * 60 * 60);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'GOOGLE_LOGIN_SUCCESS',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        userAgent: req.headers.get('user-agent') || 'unknown',
      },
    });

    // Redirect to dashboard
    const redirectUrl = state 
      ? decodeURIComponent(state) 
      : '/dashboard';

    return NextResponse.redirect(new URL(redirectUrl, req.url));
  } catch (error) {
    console.error('Google OAuth error:', error);
    return NextResponse.redirect(
      new URL('/login?error=oauth_error', req.url)
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { idToken } = body;

    if (!idToken) {
      return NextResponse.json(
        { error: 'ID token is required' },
        { status: 400 }
      );
    }

    // Verify Google ID token
    const ticket = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );
    
    if (!ticket.ok) {
      return NextResponse.json(
        { error: 'Invalid ID token' },
        { status: 401 }
      );
    }

    const googleUser = await ticket.json();

    // Verify audience
    if (googleUser.aud !== process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Invalid token audience' },
        { status: 401 }
      );
    }

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.sub },
          { email: googleUser.email },
        ],
      },
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.sub,
          avatar: user.avatar || googleUser.picture,
          emailVerified: user.emailVerified || new Date(),
          name: user.name || googleUser.name,
          lastLoginAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture,
          googleId: googleUser.sub,
          emailVerified: new Date(),
          credits: 100,
          lastLoginAt: new Date(),
        },
      });
    }

    const tokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        tier: user.tier,
        credits: user.credits,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
