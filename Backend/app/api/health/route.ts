import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Redis } from '@upstash/redis';

type ServiceHealth = {
  status: string;
  error?: string;
};

type HealthResponse = {
  status: string;
  timestamp: string;
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    redis: ServiceHealth;
    storage: ServiceHealth;
  };
};

const redis = new Redis({
  url: process.env.REDIS_URL || 'https://example.com',
  token: process.env.REDIS_TOKEN || 'placeholder',
});

export async function GET() {
  const health: HealthResponse = {
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
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = { status: 'healthy' };
  } catch {
    health.services.database = {
      status: 'unhealthy',
      error: 'Database connection failed',
    };
    health.status = 'unhealthy';
  }

  try {
    if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
      await redis.ping();
      health.services.redis = { status: 'healthy' };
    } else {
      health.services.redis = { status: 'not_configured' };
    }
  } catch {
    health.services.redis = {
      status: 'unhealthy',
      error: 'Redis connection failed',
    };
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
