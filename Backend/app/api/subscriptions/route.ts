import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { subscriptionTiers } from '@/config/site';

export async function GET(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
    });

    const currentTier = subscription?.tier || 'FREE';
    const tierDetails = subscriptionTiers[currentTier as keyof typeof subscriptionTiers];

    return NextResponse.json({
      subscription,
      currentTier,
      tierDetails,
      availableTiers: subscriptionTiers,
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
