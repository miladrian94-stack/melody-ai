import type { OrganizationRole, SubscriptionTier, UserRole } from '@prisma/client';

export type TenantContext = {
  userId: string;
  email: string;
  userRole: UserRole;
  tier: SubscriptionTier;
  organizationId?: string;
  organizationRole?: OrganizationRole;
};
