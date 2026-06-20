import { prisma } from '@/lib/prisma';
import { Errors } from '../core/errors';

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `org-${Date.now()}`;
}

export class OrganizationsService {
  static async create(input: { ownerId: string; name: string }) {
    const baseSlug = slugify(input.name);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
    return prisma.organization.create({
      data: {
        name: input.name,
        slug,
        ownerId: input.ownerId,
        members: { create: { userId: input.ownerId, role: 'OWNER' } },
        creditLedger: { create: { userId: input.ownerId, type: 'GRANT', amount: 100, balanceAfter: 100, reason: 'initial_organization_grant' } },
      },
      include: { members: true },
    });
  }

  static async listForUser(userId: string) {
    return prisma.organization.findMany({
      where: { members: { some: { userId } }, isActive: true },
      include: { members: { where: { userId }, select: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async ensureAccess(userId: string, organizationId: string) {
    const member = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true },
    });
    if (!member) throw Errors.forbidden();
    return member;
  }

  static async invite(input: { organizationId: string; email: string; role: 'ADMIN' | 'MEMBER' | 'BILLING' | 'VIEWER'; invitedBy: string }) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw Errors.notFound('Invited user');
    return prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: input.organizationId } },
      create: { userId: user.id, organizationId: input.organizationId, role: input.role, invitedBy: input.invitedBy },
      update: { role: input.role },
    });
  }
}
