import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/Backend/enterprise/core/api-response';
import { AppError } from '@/Backend/enterprise/core/errors';
import { requireTenant } from '@/Backend/enterprise/guards/tenant';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant(req);
    const { searchParams } = new URL(req.url);
    const organizationId = req.headers.get('x-organization-id') || undefined;
    const status = searchParams.get('status') as any;
    const jobs = await prisma.aIJob.findMany({
      where: { userId: ctx.userId, ...(organizationId ? { organizationId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Number(searchParams.get('limit') || 50),
    });
    return ok({ jobs });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
