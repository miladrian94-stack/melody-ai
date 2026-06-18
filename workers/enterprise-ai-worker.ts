import { createEnterpriseAIWorker } from '../Backend/enterprise/queue/ai-queue';

const worker = createEnterpriseAIWorker();

worker.on('completed', (job) => {
  console.log(`[enterprise-ai-worker] completed job ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.error(`[enterprise-ai-worker] failed job ${job?.id}:`, error);
});

console.log('[enterprise-ai-worker] running');
