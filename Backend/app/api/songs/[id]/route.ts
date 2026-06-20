// app/api/songs/[id]/route.ts — Thin Controller (rewritten)

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import { GetSongUseCase } from '@/Backend/domains/ai/use-cases/get-and-list-songs.use-case';
import { UpdateSongUseCase, DeleteSongUseCase, isValidSongId } from '@/Backend/domains/ai/use-cases/update-and-delete-song.use-case';
import { z } from 'zod';

const updateSongSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  isPublic: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  lyrics: z.string().max(10000).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) throw new ValidationError({ id: 'Invalid song ID' });

    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const song = await GetSongUseCase.execute({ songId: params.id, userId: user.id, organizationId, role: user.role });

    // ✅ The original route included a `jobs` relation in its response —
    // preserved here as a direct read since it's a simple display-only
    // join with no business logic attached, rather than forcing it through
    // the use-case's primary return shape.
    const jobs = await prisma.aIJob.findMany({
      where: { songId: song.id },
      select: { id: true, type: true, status: true, progress: true, createdAt: true },
    });

    return { song: { ...song, jobs } };
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) throw new ValidationError({ id: 'Invalid song ID' });

    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    const body = await req.json().catch(() => null);
    const parsed = updateSongSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const song = await UpdateSongUseCase.execute({ songId: params.id, userId: user.id, data: parsed.data });
    return { song };
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) throw new ValidationError({ id: 'Invalid song ID' });

    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    await DeleteSongUseCase.execute({ songId: params.id, userId: user.id, role: user.role });
    return { message: 'Song deleted successfully' };
  });
}
