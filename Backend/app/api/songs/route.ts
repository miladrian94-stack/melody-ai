// app/api/songs/route.ts — Thin Controller (rewritten)
// BEFORE: GET built a raw Prisma `where`/`orderBy` inline with an
// unvalidated `sort` query param fed directly into `orderBy: { [sort]: order }`.
// POST delegated to EnterpriseSongService (non-atomic credit deduction — see
// create-song-generation.use-case.ts's header comment).

import { NextRequest } from 'next/server';
import { AuthService } from '@/lib/auth';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import { createSongRequestSchema, listSongsQuerySchema, toSongResponseDto } from '@/Backend/domains/ai/dto/song.dto';
import { CreateSongGenerationUseCase } from '@/Backend/domains/ai/use-cases/create-song-generation.use-case';
import { ListSongsUseCase } from '@/Backend/domains/ai/use-cases/get-and-list-songs.use-case';

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const { searchParams } = new URL(req.url);

    const parsed = listSongsQuerySchema.safeParse({
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      genre: searchParams.get('genre') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      order: searchParams.get('order') ?? undefined,
    });
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const result = await ListSongsUseCase.execute({
      userId: user.id,
      organizationId,
      page: parsed.data.page,
      limit: parsed.data.limit,
      status: parsed.data.status,
      genre: parsed.data.genre,
      search: parsed.data.search,
      sortField: parsed.data.sort,
      sortDirection: parsed.data.order,
    });

    return {
      songs: result.songs.map(toSongResponseDto),
      pagination: result.pagination,
    };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const body = await req.json().catch(() => null);
    const parsed = createSongRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const result = await CreateSongGenerationUseCase.execute({
      userId: user.id,
      organizationId,
      title: parsed.data.title,
      lyrics: parsed.data.lyrics,
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      language: parsed.data.language,
      voiceType: parsed.data.voiceType,
      durationSeconds: parsed.data.duration,
      hasReferenceAudio: parsed.data.hasReferenceAudio,
    });

    return {
      song: { id: result.songId, status: 'PENDING' },
      aiJob: { id: result.aiJobId, status: result.status },
      cost: result.cost,
      message: 'Song created, credits deducted, and AI job queued for processing',
    };
  }, 201);
}
