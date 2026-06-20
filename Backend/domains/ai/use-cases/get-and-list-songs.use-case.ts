// domains/ai/use-cases/get-song.use-case.ts and list-songs.use-case.ts
// (combined in one file — both are simple read use-cases for the same aggregate)

import { songRepository, type SongListFilter, type SongListOptions } from '../repositories/song.repository';
import { NotFoundError } from '@/Backend/domains/shared/errors/domain-errors';
import type { Song } from '@prisma/client';

export interface GetSongInput {
  songId: string;
  userId: string;
  organizationId?: string;
  /** ADMIN/SUPER_ADMIN can view any song regardless of ownership — matches the existing route's behavior in app/api/songs/[id]/route.ts. */
  role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

export class GetSongUseCase {
  static async execute(input: GetSongInput): Promise<Song> {
    const song = await songRepository.findById(input.songId);
    if (!song) throw new NotFoundError('Song');

    const isAdmin = input.role === 'ADMIN' || input.role === 'SUPER_ADMIN';
    const ownsResource = input.organizationId
      ? song.organizationId === input.organizationId
      : song.userId === input.userId;

    // ✅ 404, not 403, on access denial — matches the existing route's
    // explicit choice to avoid confirming a song ID exists to a non-owner.
    if (!ownsResource && !isAdmin) throw new NotFoundError('Song');

    return song;
  }
}

export interface ListSongsInput {
  userId: string;
  organizationId?: string;
  page?: number;
  limit?: number;
  status?: SongListFilter['status'];
  genre?: SongListFilter['genre'];
  search?: string;
  sortField?: SongListOptions['sortField'];
  sortDirection?: SongListOptions['sortDirection'];
}

export interface ListSongsResult {
  songs: Song[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
}

// ✅ Sort field allowlist enforced HERE, at the use-case boundary — the
// original app/api/songs/route.ts did `orderBy: { [sort]: order }` with
// `sort` taken directly from an unvalidated query string. Any caller-
// controlled object key fed into Prisma's `orderBy` is a real (if narrow)
// abuse surface: a request for `?sort=__proto__` or any field outside the
// intended set could behave unpredictably or error in ways an attacker
// can use to enumerate schema internals via differing error responses.
const ALLOWED_SORT_FIELDS: ReadonlyArray<SongListOptions['sortField']> = ['createdAt', 'updatedAt', 'title', 'duration'];

export class ListSongsUseCase {
  static async execute(input: ListSongsInput): Promise<ListSongsResult> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 10)); // ✅ capped at 100 — the original had no upper bound on `limit`, letting a caller request `?limit=999999`
    const sortField = ALLOWED_SORT_FIELDS.includes(input.sortField as any) ? (input.sortField as SongListOptions['sortField']) : 'createdAt';
    const sortDirection = input.sortDirection === 'asc' ? 'asc' : 'desc';

    const { songs, total } = await songRepository.list(
      {
        userId: input.userId,
        organizationId: input.organizationId,
        status: input.status,
        genre: input.genre,
        search: input.search,
      },
      { page, limit, sortField, sortDirection },
    );

    return {
      songs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }
}
