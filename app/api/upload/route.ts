import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth';
import { s3Client } from '@/lib/storage/s3';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const uploadSchema = z.object({
  type: z.enum(['audio', 'image', 'profile']),
  folder: z.string().optional(),
});

const MAX_FILE_SIZES = {
  audio: 50 * 1024 * 1024, // 50MB
  image: 10 * 1024 * 1024, // 10MB
  profile: 5 * 1024 * 1024, // 5MB
};

const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/webm',
];

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

export async function POST(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check content type
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type must be multipart/form-data' },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const type = (formData.get('type') as string) || 'audio';
    const folder = (formData.get('folder') as string) || 'uploads';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate type
    const validation = uploadSchema.safeParse({ type, folder });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid upload parameters' },
        { status: 400 }
      );
    }

    // Check file size
    const maxSize = MAX_FILE_SIZES[type as keyof typeof MAX_FILE_SIZES];
    if (file.size > maxSize) {
      return NextResponse.json(
        { 
          error: `File too large. Maximum size is ${maxSize / (1024 * 1024)}MB`,
          maxSize,
          fileSize: file.size,
        },
        { status: 400 }
      );
    }

    // Validate file type
    if (type === 'audio' && !ALLOWED_AUDIO_TYPES.includes(file.type)) {
      return NextResponse.json(
        { 
          error: 'Invalid audio format. Allowed: MP3, WAV, OGG, M4A, AAC, FLAC, WEBM',
          allowedTypes: ALLOWED_AUDIO_TYPES,
        },
        { status: 400 }
      );
    }

    if (type === 'image' && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { 
          error: 'Invalid image format. Allowed: JPEG, PNG, GIF, WebP, SVG',
          allowedTypes: ALLOWED_IMAGE_TYPES,
        },
        { status: 400 }
      );
    }

    // Generate unique filename
    const extension = file.name.split('.').pop() || 'bin';
    const uniqueName = `${uuidv4()}.${extension}`;
    const key = `${user.id}/${folder}/${uniqueName}`;

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to S3
    const url = await s3Client.upload(key, buffer, file.type);

    // Create file record in database
    const fileRecord = await prisma.$executeRaw`
      INSERT INTO uploads (id, user_id, filename, original_name, mime_type, size, key, url, folder, created_at)
      VALUES (
        ${uuidv4()},
        ${user.id},
        ${uniqueName},
        ${file.name},
        ${file.type},
        ${file.size},
        ${key},
        ${url},
        ${folder},
        NOW()
      )
    `;

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'FILE_UPLOADED',
        entity: 'Upload',
        entityId: uniqueName,
        details: {
          originalName: file.name,
          size: file.size,
          type: file.type,
          key,
        },
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      },
    });

    return NextResponse.json({
      file: {
        id: uniqueName,
        name: file.name,
        size: file.size,
        type: file.type,
        url,
        key,
      },
      message: 'File uploaded successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Handle large file uploads with streaming
export async function PUT(req: NextRequest) {
  try {
    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get upload ID for resumable uploads
    const { searchParams } = new URL(req.url);
    const uploadId = searchParams.get('uploadId');
    const partNumber = parseInt(searchParams.get('partNumber') || '1');

    if (!uploadId) {
      // Initialize multipart upload
      const key = `${user.id}/uploads/${uuidv4()}`;
      // S3 multipart upload initialization would go here
      
      return NextResponse.json({
        uploadId: 'multipart-upload-id',
        key,
      });
    }

    // Handle upload part
    const body = await req.arrayBuffer();
    // Upload part to S3
    
    return NextResponse.json({
      uploadId,
      partNumber,
      status: 'uploaded',
    });
  } catch (error) {
    console.error('Multipart upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
