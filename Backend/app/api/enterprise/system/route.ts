import { prisma } from '@/lib/prisma';
import { ok } from '@/Backend/enterprise/core/api-response';
import { redis } from '@/lib/redis';

export async function GET() {
  const services: Record<string, { status: 'healthy' | 'warning' | 'critical' | 'not_configured'; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
  } catch (error) {
    services.database = { status: 'critical', error: error instanceof Error ? error.message : 'Database failed' };
  }

  if (!redis) {
    services.redis = { status: 'not_configured' };
  } else {
    const redisStart = Date.now();
    try {
      await redis.ping();
      services.redis = { status: 'healthy', latencyMs: Date.now() - redisStart };
    } catch (error) {
      services.redis = { status: 'warning', error: error instanceof Error ? error.message : 'Redis failed' };
    }
  }

  services.storage = process.env.S3_BUCKET_NAME ? { status: 'healthy' } : { status: 'not_configured' };
  services.webhooks = process.env.STRIPE_WEBHOOK_SECRET ? { status: 'healthy' } : { status: 'warning', error: 'Stripe webhook secret missing' };

  const critical = Object.values(services).some((s) => s.status === 'critical');
  return ok({ status: critical ? 'critical' : 'healthy', timestamp: new Date().toISOString(), services });
}
