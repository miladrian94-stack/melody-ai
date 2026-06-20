// domains/ai/repositories/song.repository.ts — Repository Layer
//
// Direct `prisma.song.findUnique(...)` calls currently happen in at least
// four places: app/api/songs/route.ts, app/api/songs/[id]/route.ts,
// app/api/songs/[id]/retry/route.ts, and services/song-generation.service.ts
// — each with its own slightly different select/include shape. This
// repository is the single seam between the AI domain and Prisma; use-cases
// depend on the `SongRepository` INTERFACE below, never on `prisma` directly,
// which is what makes the use-cases unit-testable without a real database
// (swap in an in-memory fake implementing the same interface).

import type { Song, Genre, Mood, Language, VoiceType, SongStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface SongListFilter {
  userId: string;
  organizationId?: string;
  status?: SongStatus;
  genre?: Genre;
  search?: string;
}

export interface SongListOptions {
  page: number;
  limit: number;
  sortField: 'createdAt' | 'updatedAt' | 'title' | 'duration'; // allowlisted — see note in createOrderBy below
  sortDirection: 'asc' | 'desc';
}

export interface CreateSongInput {
  userId: string;
  organizationId?: string;
  title: string;
  lyrics?: string;
  genre: Genre;
  mood: Mood;
  language: Language;
  voiceType: VoiceType;
  duration: number;
}

// ✅ errorMessage is explicitly `string | null | undefined`, not just
// `string | undefined` — Prisma treats `undefined` as "don't touch this
// field" but `null` as "set it to NULL in the database." Callers that need
// to CLEAR a previous error (e.g. retry-song-generation.use-case.ts resetting
// a FAILED song back to PENDING) must pass `null`, not `undefined` — passing
// undefined there would have silently left the old error message in place.
export interface SongStatusUpdate {
  status: SongStatus;
  progress?: number;
  errorMessage?: string | null;
  audioUrl?: string;
  fileSize?: number;
  processingTime?: number;
}

export interface SongRepository {
  findById(id: string): Promise<Song | null>;
  findByIdForOwner(id: string, ownerFilter: { userId: string } | { organizationId: string }): Promise<Song | null>;
  list(filter: SongListFilter, options: SongListOptions): Promise<{ songs: Song[]; total: number }>;
  create(input: CreateSongInput, tx?: PrismaTransactionClient): Promise<Song>;
  updateStatus(id: string, update: SongStatusUpdate, tx?: PrismaTransactionClient): Promise<Song>;
  updateMetadata(id: string, data: { title?: string; isPublic?: boolean; isFavorite?: boolean; lyrics?: string }): Promise<Song>;
  delete(id: string): Promise<void>;
}

// Prisma's transaction client type — exported so use-cases can pass a `tx`
// through to keep multi-step writes atomic without the repository needing
// to know about transaction orchestration itself (that's the use-case's job).
export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export class PrismaSongRepository implements SongRepository {
  async findById(id: string): Promise<Song | null> {
    return prisma.song.findUnique({ where: { id } });
  }

  async findByIdForOwner(
    id: string,
    ownerFilter: { userId: string } | { organizationId: string },
  ): Promise<Song | null> {
    return prisma.song.findFirst({ where: { id, ...ownerFilter } });
  }

  async list(filter: SongListFilter, options: SongListOptions): Promise<{ songs: Song[]; total: number }> {
    const where = {
      ...(filter.organizationId ? { organizationId: filter.organizationId } : { userId: filter.userId }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.genre ? { genre: filter.genre } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: 'insensitive' as const } },
              { lyrics: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        orderBy: { [options.sortField]: options.sortDirection },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
      }),
      prisma.song.count({ where }),
    ]);

    return { songs, total };
  }

  async create(input: CreateSongInput, tx?: PrismaTransactionClient): Promise<Song> {
    const client = tx ?? prisma;
    return client.song.create({
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
  }

  async updateStatus(id: string, update: SongStatusUpdate, tx?: PrismaTransactionClient): Promise<Song> {
    const client = tx ?? prisma;
    return client.song.update({ where: { id }, data: update });
  }

  async updateMetadata(id: string, data: { title?: string; isPublic?: boolean; isFavorite?: boolean; lyrics?: string }): Promise<Song> {
    return prisma.song.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.song.delete({ where: { id } });
  }
}

// Singleton instance — use-cases import this directly for now. If/when this
// codebase adopts a DI container (not currently present — no inversify,
// tsyringe, or similar in package.json), swap this for container resolution
// without changing the use-case code, since use-cases depend on the
// `SongRepository` interface, not this concrete export.
export const songRepository: SongRepository = new PrismaSongRepository();
