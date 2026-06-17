import { prisma } from '@/lib/prisma';
import { Errors } from '../core/errors';

export class CreditsService {
  static async getBalance(input: { userId: string; organizationId?: string }) {
    if (input.organizationId) {
      const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { credits: true } });
      if (!org) throw Errors.notFound('Organization');
      return org.credits;
    }
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { credits: true } });
    if (!user) throw Errors.notFound('User');
    return user.credits;
  }

  static async deduct(input: { userId: string; organizationId?: string; amount: number; reason: string; referenceType?: string; referenceId?: string; metadata?: unknown }) {
    if (input.amount <= 0) throw Errors.validation('Credit amount must be positive');

    return prisma.$transaction(async (tx) => {
      if (input.organizationId) {
        const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { credits: true } });
        if (!org) throw Errors.notFound('Organization');
        if (org.credits < input.amount) throw Errors.insufficientCredits();
        const updated = await tx.organization.update({
          where: { id: input.organizationId },
          data: { credits: { decrement: input.amount } },
          select: { credits: true },
        });
        await tx.creditLedger.create({
          data: { organizationId: input.organizationId, userId: input.userId, type: 'USAGE', amount: -input.amount, balanceAfter: updated.credits, reason: input.reason, referenceType: input.referenceType, referenceId: input.referenceId, metadata: input.metadata as any },
        });
        return updated.credits;
      }

      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { credits: true, isActive: true } });
      if (!user || !user.isActive) throw Errors.notFound('User');
      if (user.credits < input.amount) throw Errors.insufficientCredits();
      const updated = await tx.user.update({ where: { id: input.userId }, data: { credits: { decrement: input.amount } }, select: { credits: true } });
      await tx.creditLedger.create({
        data: { userId: input.userId, type: 'USAGE', amount: -input.amount, balanceAfter: updated.credits, reason: input.reason, referenceType: input.referenceType, referenceId: input.referenceId, metadata: input.metadata as any },
      });
      return updated.credits;
    });
  }

  static async grant(input: { userId?: string; organizationId?: string; amount: number; reason: string; metadata?: unknown }) {
    if (input.amount <= 0) throw Errors.validation('Credit amount must be positive');
    return prisma.$transaction(async (tx) => {
      if (input.organizationId) {
        const updated = await tx.organization.update({ where: { id: input.organizationId }, data: { credits: { increment: input.amount } }, select: { credits: true } });
        await tx.creditLedger.create({ data: { organizationId: input.organizationId, userId: input.userId, type: 'GRANT', amount: input.amount, balanceAfter: updated.credits, reason: input.reason, metadata: input.metadata as any } });
        return updated.credits;
      }
      if (!input.userId) throw Errors.validation('userId is required');
      const updated = await tx.user.update({ where: { id: input.userId }, data: { credits: { increment: input.amount } }, select: { credits: true } });
      await tx.creditLedger.create({ data: { userId: input.userId, type: 'GRANT', amount: input.amount, balanceAfter: updated.credits, reason: input.reason, metadata: input.metadata as any } });
      return updated.credits;
    });
  }

  static async history(input: { userId: string; organizationId?: string; limit?: number }) {
    return prisma.creditLedger.findMany({
      where: input.organizationId ? { organizationId: input.organizationId } : { userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: input.limit || 50,
    });
  }
}
