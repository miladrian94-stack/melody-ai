import { NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';

// ✅ FIX: Warn clearly in development if Redis is not configured
if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  console.warn('[rate-limit] WARNING: REDIS_URL not set. Rate limiting is using in-memory store — NOT suitable for production with multiple instances.');
}

let redis: Redis | null = null;
if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
  redis = new Redis({
    url: process.env.REDIS_URL,
    token: process.env.REDIS_TOKEN,
  });
}

interface RateLimitOptions {
  max: number;
  window: number; // seconds
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

// ✅ FIX: Add TTL-based cleanup for memory store to prevent memory leaks
class MemoryStore {
  private store = new Map<string, { count: number; reset: number }>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (now > value.reset) this.store.delete(key);
      }
    }, 5 * 60 * 1000);
  }

  get(key: string) { return this.store.get(key); }
  set(key: string, value: { count: number; reset: number }) { this.store.set(key, value); }
  delete(key: string) { this.store.delete(key); }
}

const memoryStore = new MemoryStore();

// ✅ FIX: Use X-Real-IP as fallback chain and hash it to avoid storing raw IPs
function getClientKey(req: NextRequest, pathname: string): string {
  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  // Don't log raw IPs — use a hash for privacy
  const { createHash } = require('crypto');
  const ipHash = createHash('sha256').update(ip + (process.env.JWT_SECRET || '')).digest('hex').slice(0, 16);
  return `rl:${ipHash}:${pathname}`;
}

export async function rateLimit(
  req: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = getClientKey(req, req.nextUrl.pathname);
  const now = Date.now();
  const windowMs = options.window * 1000;

  try {
    if (redis) {
      // Redis-backed rate limiting (production)
      const current = await redis.get<{ count: number; reset: number }>(key);

      if (!current || now > current.reset) {
        const entry = { count: 1, reset: now + windowMs };
        await redis.set(key, entry, { ex: options.window });
        return { success: true, remaining: options.max - 1, reset: entry.reset };
      }

      if (current.count >= options.max) {
        return { success: false, remaining: 0, reset: current.reset };
      }

      const updated = { count: current.count + 1, reset: current.reset };
      await redis.set(key, updated, { ex: Math.ceil((updated.reset - now) / 1000) });
      return { success: true, remaining: options.max - updated.count, reset: updated.reset };
    }

    // In-memory fallback (development only)
    const current = memoryStore.get(key);

    if (!current || now > current.reset) {
      const entry = { count: 1, reset: now + windowMs };
      memoryStore.set(key, entry);
      return { success: true, remaining: options.max - 1, reset: entry.reset };
    }

    if (current.count >= options.max) {
      return { success: false, remaining: 0, reset: current.reset };
    }

    current.count++;
    return { success: true, remaining: options.max - current.count, reset: current.reset };
  } catch (error) {
    // ✅ FIX: On Redis failure, BLOCK requests rather than silently allow (fail-secure)
    //    Change to 'allow' in development if this causes issues during local testing
    console.error('[rate-limit] Error:', error);
    if (process.env.NODE_ENV === 'development') {
      return { success: true, remaining: options.max, reset: now + windowMs };
    }
    return { success: false, remaining: 0, reset: now + windowMs };
  }
}
