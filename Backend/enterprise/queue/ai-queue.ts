import { Queue, Worker, JobsOptions } from 'bullmq';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { SongGenerationService } from '@/services/song-generation.service';

export const aiQueue = new Queue('enterprise-ai-generation', {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2500 }, removeOnComplete: 500, removeOnFail: 1000 },
});

export async function enqueueAIJob(input: { aiJobId: string; songId?: string; userId: string; organizationId?: string; generationInput?: Record<string, unknown> }, options?: JobsOptions) {
  return aiQueue.add('process-ai-job', input, options);
}

export function createEnterpriseAIWorker() {
  const songService = new SongGenerationService();
  return new Worker('enterprise-ai-generation', async (job) => {
    const { aiJobId, songId, generationInput } = job.data as { aiJobId: string; songId?: string; generationInput?: Record<string, unknown> };
    await prisma.aIJob.update({ where: { id: aiJobId }, data: { status: 'PROCESSING', progress: 5, startedAt: new Date(), attempts: { increment: 1 } } });
    try {
      if (songId) {
        await songService.processSongGeneration({ ...job, data: { songId, input: generationInput || {} } });
      }
      await prisma.aIJob.update({ where: { id: aiJobId }, data: { status: 'COMPLETED', progress: 100, completedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown AI processing error';
      await prisma.aIJob.update({ where: { id: aiJobId }, data: { status: 'FAILED', error: message } });
      throw error;
    }
  }, { connection: redis, concurrency: Number(process.env.AI_WORKER_CONCURRENCY || 3) });
}
