import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.REDIS_URL || '',
  token: process.env.REDIS_TOKEN || '',
});

export async function GET() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      api: { status: 'healthy' },
      database: { status: 'unknown' },
      redis: { status: 'unknown' },
      storage: { status: 'unknown' },
    },
  };

  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = { status: 'healthy' };
  } catch (error) {
    health.services.database = {
      status: 'unhealthy',
      error: 'Database connection failed',
    };
    health.status = 'unhealthy';
  }

  try {
    // Check Redis
    if (process.env.REDIS_URL) {
      await redis.ping();
      health.services.redis = { status: 'healthy' };
    } else {
      health.services.redis = { status: 'not_configured' };
    }
  } catch (error) {
    health.services.redis = {
      status: 'unhealthy',
      error: 'Redis connection failed',
    };
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
