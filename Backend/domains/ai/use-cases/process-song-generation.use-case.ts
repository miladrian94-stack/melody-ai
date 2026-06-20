// domains/ai/use-cases/process-song-generation.use-case.ts
//
// Replaces SongGenerationService.processSongGeneration. Two real gaps closed:
//
// 1. The old version updated ONLY `Song.status/progress` during processing
//    and never touched `AIJob` at all — meaning AIJob rows sat at QUEUED
//    forever even after the song finished, racing uncoordinated against the
//    worker's own separate `prisma.aIJob.update(...)` calls in
//    enterprise/queue/ai-queue.ts. This use-case now updates both through
//    the repositories, and the worker entrypoint no longer touches Prisma
//    directly at all (see workers/ai-generation.worker.ts).
//
// 2. The old `failSong` refunded a flat 1 credit regardless of what was
//    actually charged (which could be 1, 2, or 3 depending on duration per
//    the tiered cost rule) — under- or over-refunding depending on the
//    original duration. This reads the actual charged amount back off the
//    AIJob's stored `input.cost` and refunds exactly that, via
//    `GenerationCost.of(chargedCost)`.

import { prisma } from '@/lib/prisma';
import { songRepository } from '../repositories/song.repository';
import { aiJobRepository } from '../repositories/ai-job.repository';
import { CreditsDomainService } from '../services/credits.domain-service';
import { GenerationCost } from '../domain/song-generation.entity';
import { AIProviderFactory } from '@/lib/providers/ai-provider';
import { s3Client } from '@/lib/storage/s3';
import { NotFoundError, InfrastructureError } from '@/Backend/domains/shared/errors/domain-errors';
import { domainEvents, DomainEventNames } from '@/Backend/domains/shared/events/event-bus';

export interface ProcessSongGenerationInput {
  aiJobId: string;
  songId: string;
  userId: string;
  organizationId?: string;
  generationInput: {
    lyrics?: string;
    hasReferenceAudio: boolean;
    referenceAudio?: Buffer;
    genre: string;
    mood: string;
    language: string;
    voiceType: string;
    duration: number;
  };
  /** Called by the BullMQ job wrapper to report progress upstream (websocket push, job.updateProgress, etc.) — kept as an injected callback so this use-case has no direct BullMQ dependency. */
  onProgress?: (progress: number) => Promise<void> | void;
}

export class ProcessSongGenerationUseCase {
  static async execute(input: ProcessSongGenerationInput): Promise<{ audioUrl: string }> {
    await aiJobRepository.markStarted(input.aiJobId);
    await songRepository.updateStatus(input.songId, { status: 'PROCESSING', progress: 5 });
    domainEvents.publish(DomainEventNames.SONG_GENERATION_STARTED, { songId: input.songId, aiJobId: input.aiJobId });

    let provider;
    try {
      provider = AIProviderFactory.getProvider();
    } catch (err) {
      await this.handleFailure(input, 'AI provider not configured');
      throw new InfrastructureError('AI generation provider', err);
    }

    const report = async (progress: number) => {
      await Promise.all([
        aiJobRepository.markProgress(input.aiJobId, progress),
        songRepository.updateStatus(input.songId, { status: 'PROCESSING', progress }),
      ]);
      domainEvents.publish(DomainEventNames.SONG_GENERATION_PROGRESS, { songId: input.songId, aiJobId: input.aiJobId, progress });
      await input.onProgress?.(progress);
    };

    try {
      const { lyrics, hasReferenceAudio, referenceAudio, genre, mood, language, voiceType } = input.generationInput;
      let finalAudio: Buffer;

      if (hasReferenceAudio && referenceAudio) {
        const cleanedAudio = await provider.removeNoise(referenceAudio);
        await report(25);

        const melody = await provider.generateMelody(lyrics || '', genre, mood);
        await report(50);

        const music = await provider.generateMusic(melody, genre);
        await report(70);

        const mixed = await provider.mixAudio({ vocals: cleanedAudio, music: music.audio, effects: [] });
        await report(85);

        finalAudio = await provider.masterAudio(mixed);
      } else {
        if (!lyrics) throw new Error('Lyrics are required when no reference audio is provided');

        const enhancedLyrics = await provider.enhanceLyrics(lyrics, language);
        await report(15);

        const melody = await provider.generateMelody(enhancedLyrics, genre, mood);
        await report(35);

        const music = await provider.generateMusic(melody, genre);
        await report(55);

        const voice = await provider.synthesizeVoice(enhancedLyrics, voiceType, language);
        await report(75);

        const mixed = await provider.mixAudio({ vocals: voice.audio, music: music.audio, effects: [] });
        await report(90);

        finalAudio = await provider.masterAudio(mixed);
      }

      const key = `songs/${input.songId}/final.mp3`;
      await s3Client.upload(key, finalAudio, 'audio/mpeg');

      const audioUrl = `${process.env.NEXT_PUBLIC_CDN_URL}/${key}`;

      await Promise.all([
        songRepository.updateStatus(input.songId, {
          status: 'COMPLETED',
          progress: 100,
          audioUrl,
          fileSize: finalAudio.length,
        }),
        aiJobRepository.markCompleted(input.aiJobId, { audioUrl, fileSizeBytes: finalAudio.length }),
        prisma.user.update({ where: { id: input.userId }, data: { totalSongsGenerated: { increment: 1 } } }).catch(() => {
          // Non-critical counter — never fail the whole generation over this.
        }),
      ]);

      domainEvents.publish(DomainEventNames.AI_JOB_COMPLETED, { songId: input.songId, aiJobId: input.aiJobId, audioUrl });

      return { audioUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generation error';
      await this.handleFailure(input, message);
      throw error;
    }
  }

  private static async handleFailure(input: ProcessSongGenerationInput, errorMessage: string): Promise<void> {
    const aiJob = await aiJobRepository.findById(input.aiJobId);
    if (!aiJob) throw new NotFoundError('AIJob');

    // ✅ FIX: refund exactly what was charged, read back from the stored
    // input.cost, not a hardcoded 1 credit regardless of actual
    // duration-tiered cost. Falls back to 1 only if the record predates
    // this field existing (defensive, shouldn't happen for new jobs).
    const chargedCost = (aiJob.input as { cost?: number } | null)?.cost ?? 1;
    const account = input.organizationId
      ? { type: 'organization' as const, id: input.organizationId }
      : { type: 'user' as const, id: input.userId };

    await prisma.$transaction(async (tx) => {
      await songRepository.updateStatus(input.songId, { status: 'FAILED', errorMessage }, tx);
      await CreditsDomainService.refund(
        tx,
        account,
        GenerationCost.of(chargedCost),
        'song_generation_failed_refund',
        { type: 'AIJob', id: input.aiJobId },
      );
    });

    await aiJobRepository.markFailed(input.aiJobId, errorMessage);
    domainEvents.publish(DomainEventNames.AI_JOB_FAILED, {
      songId: input.songId,
      aiJobId: input.aiJobId,
      error: errorMessage,
      refunded: chargedCost,
    });
  }
}
