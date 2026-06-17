import { NextRequest } from 'next/server';
import { ok, fail } from '@/Backend/enterprise/core/api-response';
import { AppError } from '@/Backend/enterprise/core/errors';
import { requireTenant } from '@/Backend/enterprise/guards/tenant';
import { CreditsService } from '@/Backend/enterprise/services/credits.service';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant(req);
    const organizationId = req.headers.get('x-organization-id') || undefined;
    const balance = await CreditsService.getBalance({ userId: ctx.userId, organizationId });
    const history = await CreditsService.history({ userId: ctx.userId, organizationId, limit: 50 });
    return ok({ balance, history });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
