import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail } from '@/Backend/enterprise/core/api-response';
import { AppError } from '@/Backend/enterprise/core/errors';
import { requireTenant } from '@/Backend/enterprise/guards/tenant';
import { FeatureFlagsService } from '@/Backend/enterprise/services/feature-flags.service';

const flagSchema = z.object({
  key: z.string().min(2).max(80),
  name: z.string().min(2).max(120),
  description: z.string().optional(),
  enabled: z.boolean(),
  rolloutPercent: z.number().min(0).max(100).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireTenant(req);
    return ok({ flags: await FeatureFlagsService.list() });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant(req);
    if (ctx.userRole !== 'ADMIN' && ctx.userRole !== 'SUPER_ADMIN') return fail('FORBIDDEN', 'Admin only', 403);
    const body = await req.json();
    const parsed = flagSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.errors);
    const flag = await FeatureFlagsService.upsert(parsed.data);
    return ok({ flag });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
