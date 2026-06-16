import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { randomBytes, createHash } from 'crypto';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100, 'Name must be between 1 and 100 characters'),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        // Don't return the actual key for security
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Get API keys error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has API access (Pro plan or higher)
    const allowedTiers = ['PRO', 'BUSINESS', 'ENTERPRISE'];
    if (!allowedTiers.includes(user.tier)) {
      return NextResponse.json(
        { error: 'API access requires Pro plan or higher' },
        { status: 403 }
      );
    }

    // Limit number of API keys
    const keyCount = await prisma.apiKey.count({
      where: { userId: user.id, isActive: true },
    });

    const maxKeys = user.tier === 'PRO' ? 3 : user.tier === 'BUSINESS' ? 10 : 50;
    if (keyCount >= maxKeys) {
      return NextResponse.json(
        { error: `Maximum ${maxKeys} API keys allowed for your plan` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const validation = createApiKeySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { name, expiresAt } = validation.data;

    // Generate API key
    const prefix = 'ml_';
    const rawKey = randomBytes(32).toString('hex');
    const apiKey = `${prefix}${rawKey}`;

    // Hash the key for storage
    const hashedKey = createHash('sha256').update(apiKey).digest('hex');

    // Store hashed key
    const keyRecord = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name,
        key: hashedKey,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'API_KEY_CREATED',
        entity: 'ApiKey',
        entityId: keyRecord.id,
        details: { name },
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    // Return the raw key only once
    return NextResponse.json({
      apiKey: {
        id: keyRecord.id,
        name: keyRecord.name,
        key: apiKey, // Only time the raw key is returned
        expiresAt: keyRecord.expiresAt,
        createdAt: keyRecord.createdAt,
      },
      message: 'API key created. Store it safely - you won\'t be able to see it again.',
    }, { status: 201 });
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
