import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { Errors } from '../core/errors';
import type { TenantContext } from '../types/tenant';

export async function requireTenant(req?: NextRequest): Promise<TenantContext> {
  const user = await AuthService.getCurrentUser();
  if (!user) throw Errors.unauthorized();

  const organizationId = req?.headers.get('x-organization-id') || undefined;
  if (!organizationId) {
    return { userId: user.id, email: user.email, userRole: user.role, tier: user.tier };
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true, organizationId: true },
  });

  if (!member && user.role !== 'SUPER_ADMIN') throw Errors.forbidden();

  return {
    userId: user.id,
    email: user.email,
    userRole: user.role,
    tier: user.tier,
    organizationId,
    organizationRole: member?.role,
  };
}

export function assertRole(ctx: TenantContext, allowed: string[]) {
  if (ctx.userRole === 'SUPER_ADMIN') return;
  if (!ctx.organizationRole || !allowed.includes(ctx.organizationRole)) throw Errors.forbidden();
}
