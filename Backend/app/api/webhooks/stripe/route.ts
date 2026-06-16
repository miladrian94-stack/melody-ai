import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import Stripe from 'stripe';
import { headers } from 'next/headers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20.acacia',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = headers().get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id;
  const tier = session.metadata?.tier || 'STARTER';

  if (!userId) return;

  // Create or update subscription
  const existingSub = await prisma.subscription.findFirst({
    where: { userId, status: 'active' },
  });

  if (existingSub) {
    await prisma.subscription.update({
      where: { id: existingSub.id },
      data: { status: 'cancelled' },
    });
  }

  await prisma.subscription.create({
    data: {
      userId,
      tier: tier as any,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      provider: 'stripe',
      providerId: session.subscription as string,
    },
  });

  // Update user tier and credits
  await prisma.user.update({
    where: { id: userId },
    data: {
      tier: tier as any,
      credits: getCreditsForTier(tier),
    },
  });

  // Log payment
  await prisma.payment.create({
    data: {
      userId,
      amount: session.amount_total ? session.amount_total / 100 : 0,
      currency: session.currency || 'USD',
      status: 'completed',
      provider: 'stripe',
      providerId: session.id,
    },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const dbSubscription = await prisma.subscription.findFirst({
    where: { providerId: subscription.id },
  });

  if (!dbSubscription) return;

  await prisma.subscription.update({
    where: { id: dbSubscription.id },
    data: {
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const dbSubscription = await prisma.subscription.findFirst({
    where: { providerId: subscription.id },
  });

  if (!dbSubscription) return;

  await prisma.subscription.update({
    where: { id: dbSubscription.id },
    data: { status: 'cancelled' },
  });

  // Revert user to free tier
  await prisma.user.update({
    where: { id: dbSubscription.userId },
    data: {
      tier: 'FREE',
      credits: 100,
    },
  });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Log successful payment
  if (invoice.subscription) {
    const dbSubscription = await prisma.subscription.findFirst({
      where: { providerId: invoice.subscription as string },
    });

    if (dbSubscription) {
      await prisma.payment.create({
        data: {
          userId: dbSubscription.userId,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency,
          status: 'completed',
          provider: 'stripe',
          providerId: invoice.id,
          description: `Payment for ${dbSubscription.tier} subscription`,
        },
      });
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (invoice.subscription) {
    const dbSubscription = await prisma.subscription.findFirst({
      where: { providerId: invoice.subscription as string },
    });

    if (dbSubscription) {
      await prisma.payment.create({
        data: {
          userId: dbSubscription.userId,
          amount: invoice.amount_due / 100,
          currency: invoice.currency,
          status: 'failed',
          provider: 'stripe',
          providerId: invoice.id,
        },
      });
    }
  }
}

function getCreditsForTier(tier: string): number {
  const credits = {
    STARTER: 1000,
    PRO: 5000,
    BUSINESS: 20000,
    ENTERPRISE: 999999,
  };
  return credits[tier as keyof typeof credits] || 100;
}
