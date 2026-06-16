import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
);
const JWT_REFRESH_SECRET = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key'
);

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static async generateTokens(payload: JWTPayload) {
    const accessToken = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(JWT_SECRET);

    const refreshToken = await new SignJWT({ userId: payload.userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .setIssuedAt()
      .sign(JWT_REFRESH_SECRET);

    // Store refresh token in database
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
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return payload as unknown as JWTPayload;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  static async refreshAccessToken(refreshToken: string) {
    try {
      const { payload } = await jwtVerify(refreshToken, JWT_REFRESH_SECRET);
      
      // Check if refresh token exists in database
      const session = await prisma.session.findFirst({
        where: {
          token: refreshToken,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!session) {
        throw new Error('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = await this.generateTokens({
        userId: session.user.id,
        email: session.user.email,
        role: session.user.role,
      });

      // Delete old session
      await prisma.session.delete({ where: { id: session.id } });

      return tokens;
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  static async getCurrentUser() {
    const cookieStore = cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return null;
    }

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

      return user;
    } catch (error) {
      return null;
    }
  }

  static setAuthCookie(name: string, value: string, maxAge: number) {
    const cookieStore = cookies();
    cookieStore.set(name, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    });
  }

  static clearAuthCookie(name: string) {
    const cookieStore = cookies();
    cookieStore.delete(name);
  }
}
