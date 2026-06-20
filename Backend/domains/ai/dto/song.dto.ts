// domains/ai/dto/song.dto.ts — Request/Response Contracts for the AI Domain
//
// The original createSongSchema lived inline inside app/api/songs/route.ts.
// Centralizing it here means the SAME schema can be reused by
// app/api/studio/generate/route.ts (which previously had no validation at
// all, since it had no body) without copy-pasting the enum lists and risking
// them drifting out of sync with each other or with the Prisma enums.

import { z } from 'zod';

export const createSongRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  lyrics: z.string().min(1).max(5000).optional(),
  genre: z.enum(['POP', 'RAP', 'ROCK', 'EDM', 'ARABIC', 'KHALEEJI', 'YEMENI', 'LOFI', 'CINEMATIC', 'ACOUSTIC']),
  mood: z.enum(['HAPPY', 'SAD', 'EPIC', 'ROMANTIC', 'EMOTIONAL', 'MOTIVATIONAL']),
  language: z.enum(['ARABIC', 'ENGLISH']),
  voiceType: z.enum(['MALE', 'FEMALE']),
  duration: z.number().int().min(15).max(300),
  hasReferenceAudio: z.boolean().optional().default(false),
}).refine(
  (data) => data.hasReferenceAudio || (data.lyrics && data.lyrics.length > 0),
  { message: 'Lyrics are required when no reference audio is provided', path: ['lyrics'] },
);

export type CreateSongRequest = z.infer<typeof createSongRequestSchema>;

export const listSongsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10), // ✅ max(100) — see note in list-songs use-case
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  genre: z.enum(['POP', 'RAP', 'ROCK', 'EDM', 'ARABIC', 'KHALEEJI', 'YEMENI', 'LOFI', 'CINEMATIC', 'ACOUSTIC']).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'title', 'duration']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export type ListSongsQuery = z.infer<typeof listSongsQuerySchema>;

/** Strips internal fields (e.g. raw provider responses stored in AIJob.output) before returning a song to the client — never echo back internal job metadata wholesale. */
export function toSongResponseDto(song: {
  id: string;
  title: string;
  genre: string;
  mood: string;
  language: string;
  voiceType: string;
  duration: number;
  status: string;
  progress: number;
  audioUrl: string | null;
  isFavorite: boolean;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  processingTime: number | null;
  fileSize: number | null;
}) {
  return {
    id: song.id,
    title: song.title,
    genre: song.genre,
    mood: song.mood,
    language: song.language,
    voiceType: song.voiceType,
    duration: song.duration,
    status: song.status,
    progress: song.progress,
    audioUrl: song.audioUrl,
    isFavorite: song.isFavorite,
    isPublic: song.isPublic,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
    processingTime: song.processingTime,
    fileSize: song.fileSize,
  };
}
