// domains/ai/use-cases/retry-song-generation.use-case.ts
//
// Replaces the retry logic inline in app/api/songs/[id]/retry/route.ts.
// Three real bugs fixed here, found while tracing the existing code:
//
// 1. The old route pushed to a BullMQ queue named 'song-generation', but
//    workers/enterprise-ai-worker.ts only ever instantiates a Worker for
//    'ai-generation' (see enterprise/queue/ai-queue.ts's
//    `createEnterpriseAIWorker`). Retries went into a queue with NO
//    consumer — every retry request silently did nothing past the credit
//    charge. This use-case enqueues onto the same `generationQueue`
//    (infrastructure/queue/generation-queue.ts) that initial generation
//    uses, which the worker actually listens to.
//
// 2. Credit deduction (`prisma.user.update({ credits: { decrement: 1 } })`)
//    happened with NO transaction wrapping the song-status reset — a crash
//    between the two leaves a song reset to PENDING with no credit charged,
//    or a credit charged with the song never reset.
//
// 3. The retry always charged a flat 1 credit, ignoring what the song's
//    original generation actually cost (1/2/3 depending on duration). A
//    long song's retry was undercharged relative to its real cost.
//
// It also fixes the race that aiJobRepository.requeueForRetry's
// conditional update was built for: only a job that is actually FAILED and
// under its attempt limit at the moment of the write can be retried.

import { prisma } from '@/lib/prisma';
import { songRepository } from '../repositories/song.repository';
import { aiJobRepository } from '../repositories/ai-job.repository';
import { CreditsDomainService } from '../services/credits.domain-service';
import { GenerationCost } from '../domain/song-generation.entity';
import { generationQueue } from '@/Backend/infrastructure/queue/generation-queue';
import { NotFoundError, ForbiddenError, InvalidJobStateError, InsufficientCreditsError } from '@/Backend/domains/shared/errors/domain-errors';

export interface RetrySongGenerationInput {
  songId: string;
  userId: string;
  organizationId?: string;
}

export class RetrySongGenerationUseCase {
  static async execute(input: RetrySongGenerationInput): Promise<{ songId: string; aiJobId: string; status: 'QUEUED' }> {
    const song = await songRepository.findById(input.songId);
    if (!song) throw new NotFoundError('Song');

    const ownsResource = input.organizationId
      ? song.organizationId === input.organizationId
      : song.userId === input.userId;
    if (!ownsResource) throw new ForbiddenError('You do not have access to this song');

    if (song.status !== 'FAILED' && song.status !== 'CANCELLED') {
      throw new InvalidJobStateError(song.status, 'retry');
    }

    const aiJob = await prisma.aIJob.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } });
    if (!aiJob) throw new NotFoundError('AIJob for this song');

    const requeued = await aiJobRepository.requeueForRetry(aiJob.id);
    if (!requeued) {
      throw new InvalidJobStateError(aiJob.status, 'retry');
    }

    // ✅ FIX: charge the SAME cost as the original generation (read from
    // the job's stored input.cost), not a flat 1 credit regardless of
    // duration.
    const originalCost = (aiJob.input as { cost?: number } | null)?.cost ?? 1;
    const account = input.organizationId
      ? { type: 'organization' as const, id: input.organizationId }
      : { type: 'user' as const, id: input.userId };

    // ✅ FIX: status reset + credit charge in ONE transaction.
    try {
      await prisma.$transaction(async (tx) => {
        await songRepository.updateStatus(song.id, { status: 'PENDING', progress: 0, errorMessage: null }, tx);
        await CreditsDomainService.deduct(
          tx,
          account,
          GenerationCost.of(originalCost),
          'song_generation_retry',
          { type: 'AIJob', id: aiJob.id },
        );
      });
    } catch (err) {
      // Roll the job back to FAILED if the credit charge didn't go through
      // — requeueForRetry already flipped it to QUEUED, and we don't want
      // a QUEUED job sitting with no credits behind it.
      await prisma.aIJob.update({ where: { id: aiJob.id }, data: { status: 'FAILED' } }).catch(() => {});
      if (err instanceof InsufficientCreditsError) throw err;
      throw err;
    }

    await prisma.auditLog.create({
      data: { userId: input.userId, action: 'SONG_RETRY', entity: 'Song', entityId: song.id },
    });

    // ✅ FIX: enqueue onto the queue the worker actually consumes, with
    // higher priority — matches the original intent ("Higher priority for
    // retries") but now actually reaches a live consumer.
    await generationQueue.enqueue(
      {
        aiJobId: aiJob.id,
        songId: song.id,
        userId: input.userId,
        organizationId: input.organizationId,
        generationInput: {
          lyrics: song.lyrics ?? undefined,
          hasReferenceAudio: false,
          genre: song.genre,
          mood: song.mood,
          language: song.language,
          voiceType: song.voiceType,
          duration: song.duration,
        },
      },
      { priority: 1 },
    );

    return { songId: song.id, aiJobId: aiJob.id, status: 'QUEUED' };
  }
}
