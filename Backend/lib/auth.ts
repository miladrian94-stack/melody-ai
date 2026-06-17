import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

const isBuildTime =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build';

const jwtSecretValue =
  process.env.JWT_SECRET ||
  (isBuildTime ? 'build-time-secret-change-after-build-min-32-chars!!' : undefined);

const jwtRefreshSecretValue =
  process.env.JWT_REFRESH_SECRET ||
  (isBuildTime ? 'build-time-refresh-secret-change-after-build-min-32-chars!!' : undefined);

if (process.env.NODE_ENV === 'production' && !isBuildTime) {
  if (!jwtSecretValue || !jwtRefreshSecretValue) {
    throw new Error('FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be set in production');
  }
}

const JWT_SECRET = new TextEncoder().encode(
  jwtSecretValue || 'dev-only-secret-change-in-production-min-32-chars!!'
);

const JWT_REFRESH_SECRET = new TextEncoder().encode(
  jwtRefreshSecretValue || 'dev-only-refresh-secret-change-in-production!!'
);

const BCRYPT_ROUNDS = 12;

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // ✅ FIX #2: Validate password strength before hashing
  static validatePasswordStrength(password: string): { valid: boolean; message?: string } {
    if (password.length < 8) return { valid: false, message: 'Password must be at least 8 characters' };
    if (!/[A-Z]/.test(password)) return { valid: false, message: 'Password must contain at least one uppercase letter' };
    if (!/[0-9]/.test(password)) return { valid: false, message: 'Password must contain at least one number' };
    return { valid: true };
  }

  static async generateTokens(payload: JWTPayload) {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt(now)
      .setNotBefore(now)
      .sign(JWT_SECRET);

    const refreshToken = await new SignJWT({ userId: payload.userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .setIssuedAt(now)
      .setNotBefore(now)
      .sign(JWT_REFRESH_SECRET);

    await prisma.session.create({
      data: {
        userId: payload.userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  static async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      });
      return payload as unknown as JWTPayload;
    } catch {
      // ✅ FIX #3: Don't leak error details — generic message only
      throw new Error('Invalid or expired token');
    }
  }

  static async refreshAccessToken(refreshToken: string) {
    try {
      await jwtVerify(refreshToken, JWT_REFRESH_SECRET, {
        algorithms: ['HS256'],
      });

      const session = await prisma.session.findFirst({
        where: {
          token: refreshToken,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!session || !session.user.isActive) {
        throw new Error('Invalid refresh token');
      }

      const tokens = await this.generateTokens({
        userId: session.user.id,
        email: session.user.email,
        role: session.user.role,
      });

      // ✅ FIX #4: Token rotation — delete old session to prevent reuse
      await prisma.session.delete({ where: { id: session.id } });

      return tokens;
    } catch {
      throw new Error('Invalid refresh token');
    }
  }

  static async getCurrentUser() {
    const cookieStore = cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) return null;

    try {
      const payload = await this.verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          tier: true,
          credits: true,
          totalSongsGenerated: true,
          isActive: true,
          createdAt: true,
        },
      });

      // ✅ FIX #5: Validate user is still active on every request
      if (!user || !user.isActive) return null;

      return user;
    } catch {
      return null;
    }
  }

  static setAuthCookie(name: string, value: string, maxAge: number) {
    const cookieStore = cookies();
    cookieStore.set(name, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', // ✅ FIX #6: 'strict' instead of 'lax' for better CSRF protection
      maxAge,
      path: '/',
    });
  }

  static clearAuthCookie(name: string) {
    const cookieStore = cookies();
    cookieStore.delete(name);
  }

  // ✅ FIX #7: New — cleanup expired sessions periodically
  static async cleanupExpiredSessions() {
    await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
