import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const song = await prisma.song.findUnique({
      where: { id: params.id },
    });

    if (!song) {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    if (song.userId !== user.id && !song.isPublic) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Toggle favorite
    const updated = await prisma.song.update({
      where: { id: params.id },
      data: { isFavorite: !song.isFavorite },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: updated.isFavorite ? 'SONG_FAVORITED' : 'SONG_UNFAVORITED',
        entity: 'Song',
        entityId: song.id,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    return NextResponse.json({
      song: {
        id: updated.id,
        isFavorite: updated.isFavorite,
      },
      message: updated.isFavorite ? 'Song added to favorites' : 'Song removed from favorites',
    });
  } catch (error) {
    console.error('Favorite song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
