import { prisma } from '@/lib/prisma';
import type { SubscriptionTier } from '@prisma/client';

export class FeatureFlagsService {
  static async isEnabled(key: string, input?: { organizationId?: string; plan?: SubscriptionTier }) {
    const flags = await prisma.featureFlag.findMany({
      where: {
        key,
        OR: [
          { scope: 'GLOBAL', organizationId: null, plan: null },
          ...(input?.organizationId ? [{ organizationId: input.organizationId }] : []),
          ...(input?.plan ? [{ plan: input.plan }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    const flag = flags[0];
    if (!flag) return false;
    if (!flag.enabled) return false;
    if (flag.rolloutPercent >= 100) return true;
    return Math.floor(Math.random() * 100) < flag.rolloutPercent;
  }

  static async list() {
    return prisma.featureFlag.findMany({ orderBy: { createdAt: 'desc' } });
  }

  static async upsert(input: { key: string; name: string; description?: string; enabled: boolean; organizationId?: string; plan?: SubscriptionTier; rolloutPercent?: number }) {
    return prisma.featureFlag.upsert({
      where: { key_organizationId_plan: { key: input.key, organizationId: input.organizationId ?? null, plan: input.plan ?? null } },
      create: { key: input.key, name: input.name, description: input.description, enabled: input.enabled, organizationId: input.organizationId, plan: input.plan, scope: input.organizationId ? 'ORGANIZATION' : input.plan ? 'PLAN' : 'GLOBAL', rolloutPercent: input.rolloutPercent ?? 100 },
      update: { name: input.name, description: input.description, enabled: input.enabled, rolloutPercent: input.rolloutPercent ?? 100 },
    });
  }
}
