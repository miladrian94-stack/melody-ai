// domains/ai/use-cases/update-and-delete-song.use-case.ts
//
// Carries over the existing route's security checks verbatim (UUID format
// validation, owner-only for PATCH, owner-or-admin for DELETE, 404-not-403
// on access denial) — this refactor relocates logic, it does not relax any
// existing protection.

import { prisma } from '@/lib/prisma';
import { s3Client } from '@/lib/storage/s3';
import { songRepository } from '../repositories/song.repository';
import { NotFoundError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import type { Song } from '@prisma/client';

// ✅ Carried over verbatim from the original route — UUID format check
// before the ID ever reaches a database query.
export function isValidSongId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

export interface UpdateSongInput {
  songId: string;
  userId: string;
  data: { title?: string; isPublic?: boolean; isFavorite?: boolean; lyrics?: string };
}

export class UpdateSongUseCase {
  static async execute(input: UpdateSongInput): Promise<Song> {
    if (!isValidSongId(input.songId)) throw new ValidationError({ id: 'Invalid song ID format' });

    // ✅ Carried over: PATCH is owner-only, no admin override — matches
    // the original route's `findFirst({ where: { id, userId } })`, which
    // is intentionally stricter than GET's owner-or-admin rule.
    const song = await songRepository.findByIdForOwner(input.songId, { userId: input.userId });
    if (!song) throw new NotFoundError('Song');

    return songRepository.updateMetadata(input.songId, input.data);
  }
}

export interface DeleteSongInput {
  songId: string;
  userId: string;
  role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

export class DeleteSongUseCase {
  static async execute(input: DeleteSongInput): Promise<void> {
    if (!isValidSongId(input.songId)) throw new ValidationError({ id: 'Invalid song ID format' });

    const song = await songRepository.findById(input.songId);
    if (!song) throw new NotFoundError('Song');

    const isAdmin = input.role === 'ADMIN' || input.role === 'SUPER_ADMIN';
    if (song.userId !== input.userId && !isAdmin) throw new NotFoundError('Song'); // 404-not-403, carried over

    // ✅ Carried over verbatim: S3 cleanup is best-effort and never blocks
    // the DB delete — an S3 failure shouldn't leave an orphaned, undeletable
    // DB row.
    if (song.audioUrl) {
      try {
        const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL || '';
        const key = song.audioUrl.startsWith(cdnUrl) ? song.audioUrl.slice(cdnUrl.length + 1) : null;
        if (key) await s3Client.delete(key);
      } catch (s3Error) {
        console.error('S3 delete error during song deletion:', s3Error);
      }
    }

    await prisma.song.delete({ where: { id: input.songId } });
  }
}
