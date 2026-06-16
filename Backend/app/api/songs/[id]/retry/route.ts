import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

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

    if (song.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if song can be retried
    if (song.status !== 'FAILED' && song.status !== 'CANCELLED') {
      return NextResponse.json(
        { error: 'Only failed or cancelled songs can be retried' },
        { status: 400 }
      );
    }

    // Check credits
    if (user.credits <= 0) {
      return NextResponse.json(
        { error: 'Insufficient credits' },
        { status: 402 }
      );
    }

    // Reset song status
    await prisma.song.update({
      where: { id: params.id },
      data: {
        status: 'PENDING',
        progress: 0,
        errorMessage: null,
      },
    });

    // Deduct credits
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: 1 } },
    });

    // Add to processing queue
    const songQueue = new Queue('song-generation', {
      connection: redis,
    });

    await songQueue.add('generate-song', {
      songId: song.id,
      userId: user.id,
      input: {
        lyrics: song.lyrics,
        genre: song.genre,
        mood: song.mood,
        language: song.language,
        voiceType: song.voiceType,
        duration: song.duration,
      },
    }, {
      priority: 1, // Higher priority for retries
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'SONG_RETRY',
        entity: 'Song',
        entityId: song.id,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    return NextResponse.json({
      message: 'Song queued for retry',
      song: { id: song.id, status: 'PENDING' },
    });
  } catch (error) {
    console.error('Retry song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
