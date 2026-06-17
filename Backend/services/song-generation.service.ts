import { Queue } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { AIProviderFactory } from '@/lib/providers/ai-provider';
import { s3Client } from '@/lib/storage/s3';
import { redis } from '@/lib/redis';
import type { Song, Genre, Mood, Language, VoiceType } from '@prisma/client';

interface SongGenerationInput {
  userId: string;
  lyrics?: string;
  audioBuffer?: Buffer;
  genre: Genre;
  mood: Mood;
  language: Language;
  voiceType: VoiceType;
  duration: number;
}

export class SongGenerationService {
  private queue: Queue;

  constructor() {
    this.queue = new Queue('song-generation', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  async createSong(input: SongGenerationInput): Promise<Song> {
    // ✅ FIX: Use transaction to atomically check credits & deduct
    //    Old code had a TOCTOU race — user could spam requests before deduction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { credits: true, isActive: true },
      });

      if (!user || !user.isActive) throw new Error('User not found or inactive');
      if (user.credits <= 0) throw new Error('Insufficient credits');

      // Deduct credits atomically in the same transaction
      await tx.user.update({
        where: { id: input.userId, credits: { gt: 0 } }, // optimistic lock
        data: { credits: { decrement: 1 } },
      });

      const song = await tx.song.create({
        data: {
          userId: input.userId,
          // ✅ FIX: Better default title
          title: `Song - ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
          lyrics: input.lyrics,
          genre: input.genre,
          mood: input.mood,
          language: input.language,
          voiceType: input.voiceType,
          duration: input.duration,
          status: 'PENDING',
        },
      });

      return song;
    });

    await this.queue.add('generate-song', {
      songId: result.id,
      userId: input.userId,
      input: {
        lyrics: input.lyrics,
        hasAudio: !!input.audioBuffer,
        genre: input.genre,
        mood: input.mood,
        language: input.language,
        voiceType: input.voiceType,
        duration: input.duration,
      },
    });

    return result;
  }

  async processSongGeneration(job: any) {
    const { songId, userId, input } = job.data;

    // ✅ FIX: Validate provider is registered before processing
    let provider;
    try {
      provider = AIProviderFactory.getProvider();
    } catch {
      await this.failSong(songId, userId, 'AI provider not configured');
      throw new Error('AI provider not configured');
    }

    try {
      await job.updateProgress(10);
      await this.updateSongStatus(songId, 'PROCESSING', 10);

      let finalAudio: Buffer;

      if (input.hasAudio) {
        const cleanedAudio = await provider.removeNoise(input.audioBuffer);
        await job.updateProgress(25);
        await this.updateSongStatus(songId, 'PROCESSING', 25);

        const melody = await provider.generateMelody(input.lyrics || '', input.genre, input.mood);
        await job.updateProgress(50);
        await this.updateSongStatus(songId, 'PROCESSING', 50);

        const music = await provider.generateMusic(melody, input.genre);
        await job.updateProgress(70);
        await this.updateSongStatus(songId, 'PROCESSING', 70);

        const mixed = await provider.mixAudio({ vocals: cleanedAudio, music: music.audio, effects: [] });
        await job.updateProgress(85);

        finalAudio = await provider.masterAudio(mixed);
      } else {
        if (!input.lyrics) throw new Error('Lyrics are required when no audio is provided');

        const enhancedLyrics = await provider.enhanceLyrics(input.lyrics, input.language);
        await job.updateProgress(15);

        const melody = await provider.generateMelody(enhancedLyrics, input.genre, input.mood);
        await job.updateProgress(35);

        const music = await provider.generateMusic(melody, input.genre);
        await job.updateProgress(55);

        const voice = await provider.synthesizeVoice(enhancedLyrics, input.voiceType, input.language);
        await job.updateProgress(75);

        const mixed = await provider.mixAudio({ vocals: voice.audio, music: music.audio, effects: [] });
        await job.updateProgress(90);

        finalAudio = await provider.masterAudio(mixed);
      }

      const key = `songs/${songId}/final.mp3`;
      await s3Client.upload(key, finalAudio, 'audio/mpeg');
      await job.updateProgress(100);

      const audioUrl = `${process.env.NEXT_PUBLIC_CDN_URL}/${key}`;
      await prisma.song.update({
        where: { id: songId },
        data: { status: 'COMPLETED', progress: 100, audioUrl, fileSize: finalAudio.length },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { totalSongsGenerated: { increment: 1 } },
      });

      return { success: true, audioUrl };
    } catch (error) {
      // ✅ FIX: Type-safe error handling
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.failSong(songId, userId, message);
      throw error;
    }
  }

  private async failSong(songId: string, userId: string, errorMessage: string) {
    await prisma.$transaction([
      prisma.song.update({
        where: { id: songId },
        data: { status: 'FAILED', errorMessage },
      }),
      // ✅ FIX: Refund credits on failure
      prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: 1 } },
      }),
    ]);
  }

  private async updateSongStatus(songId: string, status: string, progress: number) {
    await prisma.song.update({
      where: { id: songId },
      data: { status: status as any, progress },
    });
  }
}
