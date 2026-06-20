// domains/ai/repositories/ai-job.repository.ts — AIJob Repository

import type { AIJob, AIJobStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PrismaTransactionClient } from './song.repository';

export interface CreateAIJobInput {
  userId: string;
  organizationId?: string;
  songId: string;
  prompt?: string;
  input: Record<string, unknown>;
}

export interface AIJobRepository {
  findById(id: string): Promise<AIJob | null>;
  create(input: CreateAIJobInput, tx?: PrismaTransactionClient): Promise<AIJob>;
  markStarted(id: string): Promise<AIJob>;
  markProgress(id: string, progress: number): Promise<AIJob>;
  markCompleted(id: string, output: Record<string, unknown>): Promise<AIJob>;
  markFailed(id: string, error: string): Promise<AIJob>;
  /** Atomically increments attempts and resets to QUEUED — used by the retry use-case so two concurrent retry requests can't both succeed. */
  requeueForRetry(id: string): Promise<AIJob | null>;
  countActiveForUser(userId: string): Promise<number>;
}

export class PrismaAIJobRepository implements AIJobRepository {
  async findById(id: string): Promise<AIJob | null> {
    return prisma.aIJob.findUnique({ where: { id } });
  }

  async create(input: CreateAIJobInput, tx?: PrismaTransactionClient): Promise<AIJob> {
    const client = tx ?? prisma;
    return client.aIJob.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        songId: input.songId,
        type: 'song_generation',
        status: 'QUEUED',
        progress: 0,
        prompt: input.prompt,
        input: input.input as any,
      },
    });
  }

  async markStarted(id: string): Promise<AIJob> {
    return prisma.aIJob.update({
      where: { id },
      data: { status: 'PROCESSING', progress: 5, startedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  async markProgress(id: string, progress: number): Promise<AIJob> {
    return prisma.aIJob.update({ where: { id }, data: { progress } });
  }

  async markCompleted(id: string, output: Record<string, unknown>): Promise<AIJob> {
    return prisma.aIJob.update({
      where: { id },
      data: { status: 'COMPLETED', progress: 100, completedAt: new Date(), output: output as any },
    });
  }

  async markFailed(id: string, error: string): Promise<AIJob> {
    return prisma.aIJob.update({ where: { id }, data: { status: 'FAILED', error } });
  }

  async requeueForRetry(id: string): Promise<AIJob | null> {
    // ✅ Conditional update — only succeeds if the job is still FAILED and
    // under its attempt limit at the moment of the write. Without this
    // condition, two concurrent retry requests racing against the same job
    // (e.g. a double-click) could both pass an earlier `canRetry()` read
    // check and both re-queue the same job, duplicating downstream work.
    //
    // Note: Prisma does not support comparing one column to another column's
    // value in a `where` filter (no `attempts < maxAttempts` in a single
    // query) — that requires a raw query. Rather than reach for raw SQL for
    // this one check, we read maxAttempts first (immutable after job
    // creation in this domain, so reading it outside the atomic step is
    // safe) and bake the concrete number into the conditional update's
    // `where`, which Prisma DOES support and which is still atomic with
    // respect to the actual state-changing write.
    const current = await prisma.aIJob.findUnique({ where: { id }, select: { maxAttempts: true } });
    if (!current) return null;

    const result = await prisma.aIJob.updateMany({
      where: { id, status: 'FAILED', attempts: { lt: current.maxAttempts } },
      data: { status: 'QUEUED', progress: 0, error: null },
    });

    if (result.count === 0) return null;
    return prisma.aIJob.findUnique({ where: { id } });
  }

  async countActiveForUser(userId: string): Promise<number> {
    return prisma.aIJob.count({ where: { userId, status: { in: ['QUEUED', 'PROCESSING'] } } });
  }
}

export const aiJobRepository: AIJobRepository = new PrismaAIJobRepository();
