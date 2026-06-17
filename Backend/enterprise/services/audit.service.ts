import { prisma } from '@/lib/prisma';

export class AuditService {
  static async log(input: {
    userId?: string;
    organizationId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    details?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return prisma.auditLog.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
