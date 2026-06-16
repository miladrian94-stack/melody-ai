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
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  async createSong(input: SongGenerationInput): Promise<Song> {
    // Validate user credits
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      include: { subscription: true },
    });

    if (!user || user.credits <= 0) {
      throw new Error('Insufficient credits');
    }

    // Create song record
    const song = await prisma.song.create({
      data: {
        userId: input.userId,
        title: `Song ${new Date().toISOString()}`,
        lyrics: input.lyrics,
        genre: input.genre,
        mood: input.mood,
        language: input.language,
        voiceType: input.voiceType,
        duration: input.duration,
        status: 'PENDING',
      },
    });

    // Deduct credits
    await prisma.user.update({
      where: { id: input.userId },
      data: { credits: { decrement: 1 } },
    });

    // Add to processing queue
    await this.queue.add('generate-song', {
      songId: song.id,
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

    return song;
  }

  async processSongGeneration(job: any) {
    const { songId, userId, input } = job.data;
    const provider = AIProviderFactory.getProvider();

    try {
      // Update job progress
      await job.updateProgress(10);
      await this.updateSongStatus(songId, 'PROCESSING', 10);

      let finalAudio: Buffer;

      if (input.hasAudio) {
        // Audio pipeline
        const cleanedAudio = await provider.removeNoise(input.audioBuffer);
        await job.updateProgress(20);
        await this.updateSongStatus(songId, 'PROCESSING', 20);

        const pitchData = await provider.detectPitch(cleanedAudio);
        await job.updateProgress(30);
        await this.updateSongStatus(songId, 'PROCESSING', 30);

        const melody = await provider.generateMelody(
          input.lyrics || '',
          input.genre,
          input.mood
        );
        await job.updateProgress(50);
        await this.updateSongStatus(songId, 'PROCESSING', 50);

        const music = await provider.generateMusic(melody, input.genre);
        await job.updateProgress(70);
        await this.updateSongStatus(songId, 'PROCESSING', 70);

        const mixed = await provider.mixAudio({
          vocals: cleanedAudio,
          music: music.audio,
          effects: [],
        });
        await job.updateProgress(85);
        await this.updateSongStatus(songId, 'PROCESSING', 85);

        finalAudio = await provider.masterAudio(mixed);
      } else {
        // Lyrics pipeline
        const enhancedLyrics = await provider.enhanceLyrics(
          input.lyrics,
          input.language
        );
        await job.updateProgress(15);
        await this.updateSongStatus(songId, 'PROCESSING', 15);

        const melody = await provider.generateMelody(
          enhancedLyrics,
          input.genre,
          input.mood
        );
        await job.updateProgress(35);
        await this.updateSongStatus(songId, 'PROCESSING', 35);

        const music = await provider.generateMusic(melody, input.genre);
        await job.updateProgress(55);
        await this.updateSongStatus(songId, 'PROCESSING', 55);

        const voice = await provider.synthesizeVoice(
          enhancedLyrics,
          input.voiceType,
          input.language
        );
        await job.updateProgress(75);
        await this.updateSongStatus(songId, 'PROCESSING', 75);

        const mixed = await provider.mixAudio({
          vocals: voice.audio,
          music: music.audio,
          effects: [],
        });
        await job.updateProgress(90);
        await this.updateSongStatus(songId, 'PROCESSING', 90);

        finalAudio = await provider.masterAudio(mixed);
      }

      // Upload to S3
      const key = `songs/${songId}/final.mp3`;
      await s3Client.upload(key, finalAudio, 'audio/mpeg');

      await job.updateProgress(100);

      // Update song with final URL
      const audioUrl = `${process.env.NEXT_PUBLIC_CDN_URL}/${key}`;
      await prisma.song.update({
        where: { id: songId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          audioUrl,
          fileSize: finalAudio.length,
        },
      });

      // Increment user's total songs
      await prisma.user.update({
        where: { id: userId },
        data: { totalSongsGenerated: { increment: 1 } },
      });

      return { success: true, audioUrl };
    } catch (error) {
      // Handle failure
      await prisma.song.update({
        where: { id: songId },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
        },
      });

      // Refund credits on failure
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: 1 } },
      });

      throw error;
    }
  }

  private async updateSongStatus(
    songId: string,
    status: string,
    progress: number
  ) {
    await prisma.song.update({
      where: { id: songId },
      data: { status: status as any, progress },
    });
  }
}
