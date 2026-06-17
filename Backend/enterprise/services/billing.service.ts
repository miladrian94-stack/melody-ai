import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import type { SubscriptionTier } from '@prisma/client';
import { CreditsService } from './credits.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', { apiVersion: '2024-11-20.acacia' });

const planCredits: Record<SubscriptionTier, number> = {
  FREE: 100,
  STARTER: 1000,
  PRO: 5000,
  BUSINESS: 20000,
  ENTERPRISE: 1000000,
};

export class EnterpriseBillingService {
  static creditsForPlan(plan: SubscriptionTier) {
    return planCredits[plan] || 100;
  }

  static async createCheckout(input: { userId: string; email: string; tier: SubscriptionTier; organizationId?: string }) {
    const priceId = process.env[`STRIPE_PRICE_${input.tier}`];
    if (!priceId) throw new Error(`Missing STRIPE_PRICE_${input.tier}`);

    return stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: input.email,
      client_reference_id: input.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: input.userId, tier: input.tier, organizationId: input.organizationId || '' },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?canceled=true`,
    });
  }

  static async activateSubscription(input: { userId: string; tier: SubscriptionTier; providerId?: string; organizationId?: string }) {
    const credits = this.creditsForPlan(input.tier);
    await prisma.$transaction(async (tx) => {
      if (input.organizationId) {
        await tx.organization.update({ where: { id: input.organizationId }, data: { plan: input.tier } });
      } else {
        await tx.user.update({ where: { id: input.userId }, data: { tier: input.tier } });
      }
      await tx.subscription.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          tier: input.tier,
          status: 'active',
          provider: 'stripe',
          providerId: input.providerId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    });
    await CreditsService.grant({ userId: input.userId, organizationId: input.organizationId, amount: credits, reason: `plan_${input.tier.toLowerCase()}_credit_grant` });
  }
}
