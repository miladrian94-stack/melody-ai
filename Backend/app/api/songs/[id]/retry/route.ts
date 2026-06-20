// app/api/songs/[id]/retry/route.ts — Thin Controller (rewritten)
// See retry-song-generation.use-case.ts for the 3 real bugs fixed
// (wrong queue name with no consumer, non-atomic credit charge, flat-rate
// recharge ignoring original duration-based cost).

import { NextRequest } from 'next/server';
import { AuthService } from '@/lib/auth';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError } from '@/Backend/domains/shared/errors/domain-errors';
import { RetrySongGenerationUseCase } from '@/Backend/domains/ai/use-cases/retry-song-generation.use-case';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const user = await AuthService.getCurrentUser();
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const result = await RetrySongGenerationUseCase.execute({
      songId: params.id,
      userId: user.id,
      organizationId,
    });

    return { message: 'Song queued for retry', song: { id: result.songId, status: 'PENDING' } };
  });
}
