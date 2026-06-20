// workers/ai-generation.worker.ts — Worker Entrypoint (rewritten)
//
// Replaces workers/enterprise-ai-worker.ts + enterprise/queue/ai-queue.ts's
// createEnterpriseAIWorker(). BEFORE: the worker callback did its OWN
// `prisma.aIJob.update(...)` calls for PROCESSING/COMPLETED/FAILED directly,
// while ALSO calling `songService.processSongGeneration(...)`, which did
// its own separate `prisma.song.update(...)` calls — two independent
// update paths for what's conceptually one state machine, with no
// guarantee they'd agree (e.g. if processSongGeneration threw partway
// through, the worker's own catch block still marked AIJob FAILED, but
// Song might be left at whatever the last successful progress update was,
// never explicitly set to FAILED).
//
// AFTER: this worker is a thin BullMQ adapter. ALL state transitions for
// both Song and AIJob happen inside ProcessSongGenerationUseCase, which is
// the single place that updates either of them during generation.

import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { GENERATION_QUEUE_NAME } from '@/Backend/infrastructure/queue/generation-queue';
import { ProcessSongGenerationUseCase } from '@/Backend/domains/ai/use-cases/process-song-generation.use-case';
// ✅ ADDED: registers the three AI providers (Replicate/FAL/Suno) into
// AIProviderFactory under 'default' before any job runs. Without this,
// ProcessSongGenerationUseCase's `AIProviderFactory.getProvider()` call
// (no provider was ever registered under 'default' anywhere in the prior
// code) throws "AI provider 'default' not found" on every single job —
// see lib/providers/index.ts's header comment for the full explanation.
// Must run before the Worker below starts pulling jobs.
import { registerAIProviders } from '@/Backend/lib/providers';

if (!redis) {
  throw new Error('FATAL: REDIS_URL is not configured — the worker requires Redis to start.');
}

registerAIProviders();

interface GenerationJobData {
  aiJobId: string;
  songId: string;
  userId: string;
  organizationId?: string;
  generationInput: {
    lyrics?: string;
    hasReferenceAudio: boolean;
    genre: string;
    mood: string;
    language: string;
    voiceType: string;
    duration: number;
  };
}

const worker = new Worker<GenerationJobData>(
  GENERATION_QUEUE_NAME,
  async (job) => {
    const { aiJobId, songId, userId, organizationId, generationInput } = job.data;

    await ProcessSongGenerationUseCase.execute({
      aiJobId,
      songId,
      userId,
      organizationId,
      generationInput,
      onProgress: async (progress) => {
        await job.updateProgress(progress);
      },
    });
  },
  {
    connection: redis,
    concurrency: Number(process.env.AI_WORKER_CONCURRENCY || 3),
  },
);

worker.on('completed', (job) => {
  console.log(`[ai-generation-worker] completed job ${job.id} (aiJobId=${job.data.aiJobId})`);
});

worker.on('failed', (job, error) => {
  console.error(`[ai-generation-worker] failed job ${job?.id} (aiJobId=${job?.data?.aiJobId}):`, error);
});

worker.on('error', (error) => {
  // Worker-level errors (e.g. Redis connection drop) are distinct from
  // job-level failures — these previously had NO handler at all, meaning
  // an infra-level error would only ever surface as an unhandled
  // rejection in process logs with no structured signal.
  console.error('[ai-generation-worker] worker-level error:', error);
});

console.log(`[ai-generation-worker] running — queue="${GENERATION_QUEUE_NAME}" concurrency=${process.env.AI_WORKER_CONCURRENCY || 3}`);

process.on('SIGTERM', async () => {
  console.log('[ai-generation-worker] SIGTERM received, closing gracefully...');
  await worker.close();
  process.exit(0);
});
