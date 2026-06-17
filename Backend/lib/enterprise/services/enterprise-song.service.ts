import { prisma } from '@/lib/prisma';
import type { Genre, Language, Mood, VoiceType } from '@prisma/client';
import { CreditsService } from './credits.service';
import { enqueueAIJob } from '../queue/ai-queue';

export class EnterpriseSongService {
  static costForDuration(duration: number) {
    if (duration <= 60) return 1;
    if (duration <= 180) return 2;
    return 3;
  }

  static async createQueuedSong(input: {
    userId: string;
    organizationId?: string;
    title: string;
    lyrics?: string;
    genre: Genre;
    mood: Mood;
    language: Language;
    voiceType: VoiceType;
    duration: number;
  }) {
    const cost = this.costForDuration(input.duration);

    const { song, aiJob } = await prisma.$transaction(async (tx) => {
      if (input.organizationId) {
        const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { credits: true, isActive: true } });
        if (!org || !org.isActive) throw new Error('Organization not found or inactive');
        if (org.credits < cost) throw new Error('Insufficient credits');
      } else {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { credits: true, isActive: true } });
        if (!user || !user.isActive) throw new Error('User not found or inactive');
        if (user.credits < cost) throw new Error('Insufficient credits');
      }

      const song = await tx.song.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          title: input.title,
          lyrics: input.lyrics,
          genre: input.genre,
          mood: input.mood,
          language: input.language,
          voiceType: input.voiceType,
          duration: input.duration,
          status: 'PENDING',
          progress: 0,
        },
      });

      const aiJob = await tx.aIJob.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          songId: song.id,
          type: 'song_generation',
          status: 'QUEUED',
          progress: 0,
          prompt: input.lyrics || input.title,
          input: { ...input, cost },
        },
      });

      return { song, aiJob };
    });

    await CreditsService.deduct({
      userId: input.userId,
      organizationId: input.organizationId,
      amount: cost,
      reason: 'song_generation_queued',
      referenceType: 'AIJob',
      referenceId: aiJob.id,
      metadata: { songId: song.id, duration: input.duration },
    });

    await enqueueAIJob({ aiJobId: aiJob.id, songId: song.id, userId: input.userId, organizationId: input.organizationId, generationInput: { lyrics: input.lyrics, hasAudio: false, genre: input.genre, mood: input.mood, language: input.language, voiceType: input.voiceType, duration: input.duration } });

    return { song, aiJob, cost };
  }
}
