import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { id: params.id },
    });

    if (!apiKey || apiKey.userId !== user.id) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Soft delete - deactivate
    await prisma.apiKey.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'API_KEY_DELETED',
        entity: 'ApiKey',
        entityId: params.id,
        details: { name: apiKey.name },
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    return NextResponse.json({ message: 'API key deactivated successfully' });
  } catch (error) {
    console.error('Delete API key error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
