import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { z } from 'zod';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20.acacia',
});

const checkoutSchema = z.object({
  tier: z.enum(['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  provider: z.enum(['stripe', 'lemonsqueezy']),
});

const STRIPE_PRICES: Record<string, string> = {
  STARTER: 'price_starter_id',
  PRO: 'price_pro_id',
  BUSINESS: 'price_business_id',
  ENTERPRISE: 'price_enterprise_id',
};

export async function POST(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validation = checkoutSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { tier, provider } = validation.data;

    if (provider === 'stripe') {
      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: user.email,
        client_reference_id: user.id,
        line_items: [
          {
            price: STRIPE_PRICES[tier],
            quantity: 1,
          },
        ],
        metadata: {
          userId: user.id,
          tier,
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?payment=cancelled`,
      });

      return NextResponse.json({ url: session.url });
    } else if (provider === 'lemonsqueezy') {
      // LemonSqueezy integration would go here
      return NextResponse.json(
        { error: 'LemonSqueezy integration coming soon' },
        { status: 501 }
      );
    }

    return NextResponse.json(
      { error: 'Invalid payment provider' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
