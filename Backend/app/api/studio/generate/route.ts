// app/api/studio/generate/route.ts — Thin Controller (rewritten)
//
// BEFORE: this entire file was
//   export async function POST() {
//     return NextResponse.json({ success: true, message: "Studio generation endpoint is active" });
//   }
// It accepted no body, did no auth check, created no Song, no AIJob,
// charged no credits, and queued nothing. Any client calling it got a
// false "success" with zero actual work performed.
//
// AFTER: thin controller — auth → parse/validate → delegate to use-case →
// map result/errors. No business logic lives here; everything moved to
// CreateSongGenerationUseCase.

import { NextRequest } from 'next/server';
import { AuthService } from '@/lib/auth';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import { createSongRequestSchema } from '@/Backend/domains/ai/dto/song.dto';
import { CreateSongGenerationUseCase } from '@/Backend/domains/ai/use-cases/create-song-generation.use-case';

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
      message: 'Song queued for generation',
    };
  }, 201);
}
