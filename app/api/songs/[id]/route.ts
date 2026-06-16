import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { s3Client } from '@/lib/storage/s3';
import { z } from 'zod';

const updateSongSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  lyrics: z.string().optional(),
});

export async function GET(
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
      include: {
        jobs: {
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            createdAt: true,
          },
        },
      },
    });

    if (!song) {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    // Check ownership or admin role
    if (song.userId !== user.id && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ song });
  } catch (error) {
    console.error('Get song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    if (song.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const validation = updateSongSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const updated = await prisma.song.update({
      where: { id: params.id },
      data: validation.data,
    });

    return NextResponse.json({ song: updated });
  } catch (error) {
    console.error('Update song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    if (song.userId !== user.id && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete audio from S3 if exists
    if (song.audioUrl) {
      const key = song.audioUrl.split('/').pop();
      if (key) {
        await s3Client.delete(key);
      }
    }

    // Delete from database
    await prisma.song.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: 'Song deleted successfully' });
  } catch (error) {
    console.error('Delete song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
