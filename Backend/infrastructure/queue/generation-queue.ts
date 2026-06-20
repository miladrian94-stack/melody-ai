// infrastructure/queue/generation-queue.ts — Queue Abstraction for AI Generation
//
// Two real things this fixes vs. the existing enterprise/queue/ai-queue.ts:
//
// 1. BUG: `lib/redis.ts` exports `redis: Redis | null` (null when
//    REDIS_URL isn't set), but the existing `new Queue('...', { connection:
//    redis })` passes that possibly-null value straight into BullMQ's
//    constructor, which expects a real connection. If REDIS_URL is unset at
//    boot, this throws at import time with a confusing BullMQ-internal
//    error rather than a clear "Redis is required" message. This wrapper
//    asserts non-null with a clear error at the point of use.
//
// 2. GAP: nothing previously reconciled a Song/AIJob that committed to the
//    database with credits already deducted, but where the subsequent
//    `queue.add(...)` call never happened (process crash between the two
//    steps — see create-song-generation.use-case.ts's comment). This adds
//    `reconcileOrphanedJobs()`, intended to run on a schedule (e.g. via the
//    existing `node-cron` dependency already in package.json) to find and
//    re-enqueue any QUEUED AIJob older than a threshold with no
//    corresponding BullMQ job.

import { Queue, type JobsOptions } from 'bullmq';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

// ✅ SINGLE SOURCE OF TRUTH for the queue name. Before this refactor, THREE
// different queue name strings existed across the codebase for what was
// supposed to be the same logical queue:
//   - 'enterprise-ai-generation' (enterprise/queue/ai-queue.ts — the one
//     the worker actually listened to)
//   - 'song-generation' (the old retry route — had NO consumer at all)
//   - 'ai-generation' (used informally in code comments / the security
//     addendum's queue-security.ts written in an earlier session, which
//     was never wired to this specific BullMQ setup)
// Exporting this constant and having every producer/consumer import it is
// what prevents this from drifting apart again.
export const GENERATION_QUEUE_NAME = 'enterprise-ai-generation';

// Job name is metadata BullMQ's Worker doesn't filter on by default (any job
// added to this queue reaches the same processor callback regardless of
// name) — so 'process-generation' vs the original 'process-ai-job' was
// never actually a functional break. Standardized as a constant anyway so
// logs/dashboards show one consistent job name rather than two.
export const GENERATION_JOB_NAME = 'process-ai-job';

function requireRedis() {
  if (!redis) {
    throw new Error(
      'FATAL: REDIS_URL is not configured — the generation queue requires Redis. ' +
      'Set REDIS_URL before starting the app or worker process.',
    );
  }
  return redis;
}

export interface EnqueueGenerationJobInput {
  aiJobId: string;
  songId: string;
  userId: string;
  organizationId?: string;
  generationInput: Record<string, unknown>;
}

class GenerationQueue {
  private queue: Queue | null = null;

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(GENERATION_QUEUE_NAME, {
        connection: requireRedis(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2500 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      });
    }
    return this.queue;
  }

  async enqueue(input: EnqueueGenerationJobInput, options?: JobsOptions): Promise<void> {
    await this.getQueue().add(GENERATION_JOB_NAME, input, options);
  }

  /**
   * Finds AIJobs stuck in QUEUED for longer than `olderThanMs` and have no
   * matching active/waiting BullMQ job, then re-enqueues them. Run this on
   * a schedule (every few minutes) rather than on every request — it's a
   * safety net for the crash-between-commit-and-enqueue edge case, not the
   * primary enqueue path.
   */
  async reconcileOrphanedJobs(olderThanMs = 5 * 60 * 1000): Promise<{ reconciled: number }> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleQueuedJobs = await prisma.aIJob.findMany({
      where: { status: 'QUEUED', createdAt: { lt: cutoff } },
      select: { id: true, songId: true, userId: true, organizationId: true, input: true },
      take: 100, // bounded batch — avoid one reconciliation pass trying to re-enqueue thousands at once
    });

    const queue = this.getQueue();
    const activeAndWaiting = await queue.getJobs(['active', 'waiting', 'delayed']);
    const queuedAiJobIds = new Set(
      activeAndWaiting.map((j) => (j.data as { aiJobId?: string }).aiJobId).filter(Boolean),
    );

    let reconciled = 0;
    for (const job of staleQueuedJobs) {
      if (queuedAiJobIds.has(job.id)) continue; // already in the queue, just slow — leave it alone
      if (!job.songId) continue; // shouldn't happen for song_generation jobs, but guard anyway

      await queue.add(GENERATION_JOB_NAME, {
        aiJobId: job.id,
        songId: job.songId,
        userId: job.userId,
        organizationId: job.organizationId ?? undefined,
        generationInput: job.input as Record<string, unknown>,
      });
      reconciled++;
    }

    return { reconciled };
  }
}

export const generationQueue = new GenerationQueue();
