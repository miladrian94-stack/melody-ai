import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { z } from 'zod';
import { SongStatus } from '@prisma/client';
import { EnterpriseSongService } from '@/Backend/enterprise/services/enterprise-song.service';

const createSongSchema = z.object({
  title: z.string().min(1).max(200),
  lyrics: z.string().optional(),
  genre: z.enum(['POP', 'RAP', 'ROCK', 'EDM', 'ARABIC', 'KHALEEJI', 'YEMENI', 'LOFI', 'CINEMATIC', 'ACOUSTIC']),
  mood: z.enum(['HAPPY', 'SAD', 'EPIC', 'ROMANTIC', 'EMOTIONAL', 'MOTIVATIONAL']),
  language: z.enum(['ARABIC', 'ENGLISH']),
  voiceType: z.enum(['MALE', 'FEMALE']),
  duration: z.number().min(30).max(300),
});

export async function GET(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status') as SongStatus | null;
    const genre = searchParams.get('genre');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'createdAt';
    const order = searchParams.get('order') || 'desc';

    // Build where clause
    const where: any = { userId: user.id };
    if (status) where.status = status;
    if (genre) where.genre = genre;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { lyrics: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get total count for pagination
    const total = await prisma.song.count({ where });

    // Get songs
    const songs = await prisma.song.findMany({
      where,
      select: {
        id: true,
        title: true,
        genre: true,
        mood: true,
        language: true,
        voiceType: true,
        duration: true,
        status: true,
        progress: true,
        audioUrl: true,
        isFavorite: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        processingTime: true,
        fileSize: true,
      },
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
    });

    return NextResponse.json({
      songs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Get songs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizationId = req.headers.get('x-organization-id') || undefined;

    const body = await req.json();
    const validation = createSongSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { title, lyrics, genre, mood, language, voiceType, duration } = validation.data;

    const result = await EnterpriseSongService.createQueuedSong({
      userId: user.id,
      organizationId,
      title,
      lyrics,
      genre,
      mood,
      language,
      voiceType,
      duration,
    });

    return NextResponse.json({
      song: {
        id: result.song.id,
        title: result.song.title,
        status: result.song.status,
        createdAt: result.song.createdAt,
      },
      aiJob: {
        id: result.aiJob.id,
        status: result.aiJob.status,
        progress: result.aiJob.progress,
      },
      cost: result.cost,
      message: 'Song created, credits deducted, and AI job queued for processing',
    }, { status: 201 });
  } catch (error) {
    console.error('Create song error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
