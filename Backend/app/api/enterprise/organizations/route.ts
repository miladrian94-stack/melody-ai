import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, created, fail } from '@/Backend/enterprise/core/api-response';
import { AppError } from '@/Backend/enterprise/core/errors';
import { requireTenant } from '@/Backend/enterprise/guards/tenant';
import { OrganizationsService } from '@/Backend/enterprise/services/organizations.service';
import { AuditService } from '@/Backend/enterprise/services/audit.service';

const createSchema = z.object({ name: z.string().min(2).max(80) });

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant(req);
    const organizations = await OrganizationsService.listForUser(ctx.userId);
    return ok({ organizations });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant(req);
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.errors);
    const organization = await OrganizationsService.create({ ownerId: ctx.userId, name: parsed.data.name });
    await AuditService.log({ userId: ctx.userId, organizationId: organization.id, action: 'ORGANIZATION_CREATED', entity: 'Organization', entityId: organization.id, details: { name: parsed.data.name }, ipAddress: req.headers.get('x-forwarded-for') || undefined });
    return created({ organization });
  } catch (error) {
    if (error instanceof AppError) return fail(error.code, error.message, error.status, error.details);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
