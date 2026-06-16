import { NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';

// Use Upstash Redis for rate limiting in production
// For development, we'll use an in-memory store
const redis = new Redis({
  url: process.env.REDIS_URL || '',
  token: process.env.REDIS_TOKEN || '',
});

interface RateLimitOptions {
  max: number;
  window: number; // in seconds
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

const memoryStore = new Map<string, { count: number; reset: number }>();

export async function rateLimit(
  req: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = `rate-limit:${req.ip || 'unknown'}:${req.nextUrl.pathname}`;
  const now = Date.now();
  const windowMs = options.window * 1000;

  try {
    // Try Redis first, fallback to memory
    if (process.env.REDIS_URL) {
      const current = await redis.get<{ count: number; reset: number }>(key);
      
      if (!current || now > current.reset) {
        const newEntry = { count: 1, reset: now + windowMs };
        await redis.set(key, newEntry, { ex: options.window });
        return { success: true, remaining: options.max - 1, reset: newEntry.reset };
      }

      if (current.count >= options.max) {
        return { success: false, remaining: 0, reset: current.reset };
      }

      const updated = { count: current.count + 1, reset: current.reset };
      await redis.set(key, updated, { ex: Math.ceil((updated.reset - now) / 1000) });
      return { success: true, remaining: options.max - updated.count, reset: updated.reset };
    }

    // In-memory fallback
    const current = memoryStore.get(key);

    if (!current || now > current.reset) {
      const newEntry = { count: 1, reset: now + windowMs };
      memoryStore.set(key, newEntry);
      setTimeout(() => memoryStore.delete(key), windowMs);
      return { success: true, remaining: options.max - 1, reset: newEntry.reset };
    }

    if (current.count >= options.max) {
      return { success: false, remaining: 0, reset: current.reset };
    }

    current.count++;
    return { success: true, remaining: options.max - current.count, reset: current.reset };
  } catch (error) {
    // If rate limiting fails, allow the request
    console.error('Rate limit error:', error);
    return { success: true, remaining: options.max, reset: now + windowMs };
  }
}
