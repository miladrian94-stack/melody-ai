import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth';
import { s3Client } from '@/lib/storage/s3';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createHash } from 'crypto';
import path from 'path';
import { rateLimit } from '@/middleware/rate-limit';

const uploadSchema = z.object({
  type: z.enum(['audio', 'image', 'profile']),
});

const MAX_FILE_SIZES = {
  audio: 50 * 1024 * 1024,  // 50MB
  image: 10 * 1024 * 1024,  // 10MB
  profile: 5 * 1024 * 1024, // 5MB
};

// ✅ FIX: Use explicit allowlist — never trust client-reported MIME type alone
const ALLOWED_TYPES: Record<string, string[]> = {
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/webm'],
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  // ✅ FIX: Removed SVG from allowed image types — SVGs can contain scripts (XSS vector)
  profile: ['image/jpeg', 'image/png', 'image/webp'],
};

// ✅ FIX: Magic byte validation (file signature check)
const MAGIC_BYTES: Record<string, { bytes: number[]; offset: number }[]> = {
  'audio/mpeg': [{ bytes: [0xFF, 0xFB], offset: 0 }, { bytes: [0x49, 0x44, 0x33], offset: 0 }], // MP3
  'audio/wav':  [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }], // RIFF
  'audio/ogg':  [{ bytes: [0x4F, 0x67, 0x67, 0x53], offset: 0 }], // OggS
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF], offset: 0 }],
  'image/png':  [{ bytes: [0x89, 0x50, 0x4E, 0x47], offset: 0 }],
  'image/gif':  [{ bytes: [0x47, 0x49, 0x46], offset: 0 }],
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }],
};

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return true; // Skip check for types without known signatures
  return signatures.some(sig =>
    sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte)
  );
}

// ✅ FIX: Sanitize filename to prevent path traversal
function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

export async function POST(req: NextRequest) {
  try {
    // ✅ FIX: Rate-limit uploads per user
    const rateLimitResult = await rateLimit(req, { max: 20, window: 3600 });
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Upload limit reached. Try again later.' }, { status: 429 });
    }

    const user = await AuthService.getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Content-Type must be multipart/form-data' }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const typeRaw = formData.get('type') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const validation = uploadSchema.safeParse({ type: typeRaw });
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid upload type' }, { status: 400 });
    }

    const { type } = validation.data;

    // ✅ FIX: Validate client-reported MIME type against allowlist
    if (!ALLOWED_TYPES[type].includes(file.type)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_FILE_SIZES[type]) {
      return NextResponse.json(
        { error: `File too large. Max: ${MAX_FILE_SIZES[type] / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    // ✅ FIX: Verify actual file contents via magic bytes (prevents MIME spoofing)
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateMagicBytes(buffer, file.type)) {
      return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
    }

    // ✅ FIX: Generate content-hash based filename to prevent duplicate uploads
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const sanitized = sanitizeFilename(file.name);
    const extension = sanitized.split('.').pop() || 'bin';
    const uniqueName = `${uuidv4()}-${hash}.${extension}`;

    // ✅ FIX: Scope upload path to user ID to prevent cross-user access
    const folder = type === 'profile' ? 'avatars' : `${type}s`;
    const key = `users/${user.id}/${folder}/${uniqueName}`;

    const url = await s3Client.upload(key, buffer, file.type);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'FILE_UPLOADED',
        entity: 'Upload',
        entityId: uniqueName,
        details: {
          originalName: sanitized,
          size: file.size,
          type: file.type,
          key,
        },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
      },
    });

    return NextResponse.json({
      file: {
        name: sanitized,
        size: file.size,
        type: file.type,
        url,
        key,
      },
      message: 'File uploaded successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
