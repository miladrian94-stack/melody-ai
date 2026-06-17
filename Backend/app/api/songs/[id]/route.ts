import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { s3Client } from '@/lib/storage/s3';
import { z } from 'zod';

const updateSongSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  isPublic: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  // ✅ FIX: Sanitize lyrics length to prevent massive payloads
  lyrics: z.string().max(10000).optional(),
});

// ✅ FIX: Extract & validate song ID to prevent injection
function validateSongId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id); // UUID format
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // ✅ FIX: Validate ID format before hitting the database
    if (!validateSongId(params.id)) {
      return NextResponse.json({ error: 'Invalid song ID' }, { status: 400 });
    }

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

    // ✅ FIX: Only allow admin OR song owner to access
    if (song.userId !== user.id && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      // ✅ FIX: Return 404 not 403 to avoid confirming the song exists
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    return NextResponse.json({ song });
  } catch (error) {
    console.error('Get song error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!validateSongId(params.id)) {
      return NextResponse.json({ error: 'Invalid song ID' }, { status: 400 });
    }

    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ✅ FIX: Fetch song with userId filter to prevent IDOR
    const song = await prisma.song.findFirst({
      where: { id: params.id, userId: user.id },
    });

    if (!song) {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    const body = await req.json();
    const validation = updateSongSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors.map(e => e.message) },
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!validateSongId(params.id)) {
      return NextResponse.json({ error: 'Invalid song ID' }, { status: 400 });
    }

    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const song = await prisma.song.findUnique({ where: { id: params.id } });

    if (!song) {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    // Only owner or admin can delete
    if (song.userId !== user.id && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    // ✅ FIX: Delete from S3 using full key path, not just filename
    if (song.audioUrl) {
      try {
        // Extract key from CDN URL properly
        const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL || '';
        const key = song.audioUrl.startsWith(cdnUrl)
          ? song.audioUrl.slice(cdnUrl.length + 1)
          : null;
        if (key) {
          await s3Client.delete(key);
        }
      } catch (s3Error) {
        // Log S3 error but don't block DB deletion
        console.error('S3 delete error:', s3Error);
      }
    }

    await prisma.song.delete({ where: { id: params.id } });

    return NextResponse.json({ message: 'Song deleted successfully' });
  } catch (error) {
    console.error('Delete song error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
