import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';

const updateSettingsSchema = z.object({
  language: z.enum(['en', 'ar']).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  notifications: z.object({
    email: z.boolean().optional(),
    songComplete: z.boolean().optional(),
    promotions: z.boolean().optional(),
  }).optional(),
  privacy: z.object({
    publicProfile: z.boolean().optional(),
    showInSearch: z.boolean().optional(),
  }).optional(),
});

// Note: You'll need to add a UserSettings model to your Prisma schema
// or store settings as JSON in the User model

export async function GET(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user settings from metadata field or separate table
    const userWithSettings = await prisma.$queryRaw<Array<{ settings: any }>>`
      SELECT settings FROM user_settings WHERE user_id = ${user.id}
    `;

    const settings = userWithSettings[0]?.settings || {
      language: 'en',
      theme: 'dark',
      notifications: {
        email: true,
        songComplete: true,
        promotions: false,
      },
      privacy: {
        publicProfile: false,
        showInSearch: true,
      },
    };

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const validation = updateSettingsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    // Upsert settings
    await prisma.$executeRaw`
      INSERT INTO user_settings (user_id, settings, updated_at)
      VALUES (${user.id}, ${JSON.stringify(validation.data)}::jsonb, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        settings = ${JSON.stringify(validation.data)}::jsonb,
        updated_at = NOW()
    `;

    return NextResponse.json({
      settings: validation.data,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    console.error('Update settings error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
