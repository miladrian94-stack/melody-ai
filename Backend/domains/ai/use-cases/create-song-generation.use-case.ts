// domains/ai/use-cases/create-song-generation.use-case.ts
//
// Replaces EnterpriseSongService.createQueuedSong. The key fix: credit
// deduction now happens INSIDE the same transaction as Song+AIJob creation
// (via CreditsDomainService.deduct(tx, ...)), not as a separate call after
// the transaction commits. If the process crashes between "transaction
// committed" and "credits deducted" in the old code, the result is a queued
// job with no credit ever charged — a real revenue leak under load or
// during a deploy. Here, either the whole thing commits together or none of
// it does.

import { prisma } from '@/lib/prisma';
import type { Genre, Mood, Language, VoiceType } from '@prisma/client';
import { GenerationRequest } from '../domain/song-generation.entity';
import { songRepository } from '../repositories/song.repository';
import { aiJobRepository } from '../repositories/ai-job.repository';
import { CreditsDomainService } from '../services/credits.domain-service';
import { generationQueue } from '@/Backend/infrastructure/queue/generation-queue';
import { domainEvents, DomainEventNames } from '@/Backend/domains/shared/events/event-bus';

export interface CreateSongGenerationInput {
  userId: string;
  organizationId?: string;
  title?: string;
  lyrics?: string;
  genre: Genre;
  mood: Mood;
  language: Language;
  voiceType: VoiceType;
  durationSeconds: number;
  hasReferenceAudio?: boolean;
}

export interface CreateSongGenerationResult {
  songId: string;
  aiJobId: string;
  status: 'QUEUED';
  cost: number;
}

export class CreateSongGenerationUseCase {
  static async execute(input: CreateSongGenerationInput): Promise<CreateSongGenerationResult> {
    const request = GenerationRequest.create({
      lyrics: input.lyrics,
      genre: input.genre,
      mood: input.mood,
      language: input.language,
      voiceType: input.voiceType,
      durationSeconds: input.durationSeconds,
      hasReferenceAudio: input.hasReferenceAudio ?? false,
    });

    const account = input.organizationId
      ? { type: 'organization' as const, id: input.organizationId }
      : { type: 'user' as const, id: input.userId };

    // Single transaction: Song create → AIJob create → credit deduct.
    // All three succeed together or none do.
    const { song, aiJob } = await prisma.$transaction(async (tx) => {
      const song = await songRepository.create(
        {
          userId: input.userId,
          organizationId: input.organizationId,
          title: input.title || request.defaultTitle(),
          lyrics: request.lyrics,
          genre: request.genre,
          mood: request.mood,
          language: request.language,
          voiceType: request.voiceType,
          duration: request.durationSeconds,
        },
        tx,
      );

      const aiJob = await aiJobRepository.create(
        {
          userId: input.userId,
          organizationId: input.organizationId,
          songId: song.id,
          prompt: request.lyrics || input.title,
          input: {
            lyrics: request.lyrics,
            hasReferenceAudio: request.hasReferenceAudio,
            genre: request.genre,
            mood: request.mood,
            language: request.language,
            voiceType: request.voiceType,
            duration: request.durationSeconds,
            cost: request.cost.credits,
          },
        },
        tx,
      );

      // ✅ THE FIX: deduction happens in the SAME transaction, not after it.
      await CreditsDomainService.deduct(
        tx,
        account,
        request.cost,
        'song_generation_queued',
        { type: 'AIJob', id: aiJob.id },
      );

      return { song, aiJob };
    });

    // Enqueueing happens AFTER the transaction commits (correct ordering —
    // we never want a worker to pick up a job for a Song/AIJob/credit-debit
    // that might still get rolled back). If the process crashes between
    // commit and enqueue, the job exists in QUEUED state with credits
    // already charged but nothing in the BullMQ queue — see
    // infrastructure/queue/generation-queue.ts's `reconcileOrphanedJobs()`
    // for how this edge case is swept up rather than silently lost.
    await generationQueue.enqueue({
      aiJobId: aiJob.id,
      songId: song.id,
      userId: input.userId,
      organizationId: input.organizationId,
      generationInput: {
        lyrics: request.lyrics,
        hasReferenceAudio: request.hasReferenceAudio,
        genre: request.genre,
        mood: request.mood,
        language: request.language,
        voiceType: request.voiceType,
        duration: request.durationSeconds,
      },
    });

    domainEvents.publish(DomainEventNames.SONG_QUEUED, {
      songId: song.id,
      aiJobId: aiJob.id,
      userId: input.userId,
      organizationId: input.organizationId,
      cost: request.cost.credits,
    });

    return { songId: song.id, aiJobId: aiJob.id, status: 'QUEUED', cost: request.cost.credits };
  }
}
