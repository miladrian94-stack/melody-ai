// domains/ai/domain/song-generation.entity.ts — Domain Entities & Value Objects
//
// Until now, this codebase had no domain layer at all — every file dealt
// directly in Prisma's generated `Song`/`AIJob` types, which means business
// rules (how is generation cost computed? what counts as "song belongs to
// this account"?) were duplicated wherever someone happened to need them
// (compare EnterpriseSongService.costForDuration, which existed, against
// SongGenerationService.createSong, which hardcoded a flat 1-credit cost
// with no duration awareness at all — two different answers to the same
// business question). This file is the single place those rules live now.
//
// These are plain classes with no Prisma/database dependency — they can be
// constructed, tested, and reasoned about without a database connection.
// Repositories (see ../repositories/) are responsible for translating
// between these and Prisma rows.

import type { Genre, Mood, Language, VoiceType, SongStatus, AIJobStatus } from '@prisma/client';

// ── Value Object: GenerationCost ────────────────────────────────────────────
// Replaces the two conflicting cost rules found in the existing code:
//   - EnterpriseSongService.costForDuration: tiered (1/2/3 credits by duration)
//   - SongGenerationService.createSong: hardcoded 1 credit, ignoring duration
// This is now the ONE place this rule is defined. The tiered version is kept
// (it's the more thought-out of the two) — if product actually wants flat
// pricing, that's a one-line change here, not a re-audit of every call site.
export class GenerationCost {
  private constructor(public readonly credits: number) {}

  static forDuration(durationSeconds: number): GenerationCost {
    if (durationSeconds <= 60) return new GenerationCost(1);
    if (durationSeconds <= 180) return new GenerationCost(2);
    return new GenerationCost(3);
  }

  /**
   * Reconstructs a GenerationCost from a known, already-charged credit
   * amount — used for refunds, where we must refund EXACTLY what was
   * originally deducted (read back from the AIJob's stored record), not
   * recompute a fresh cost from duration (which could differ if the cost
   * formula changes between when a job was charged and when it fails).
   */
  static of(credits: number): GenerationCost {
    if (credits <= 0) throw new Error('GenerationCost must be positive');
    return new GenerationCost(credits);
  }
}

// ── Value Object: GenerationRequest ─────────────────────────────────────────
// The validated, normalized shape of "what the caller wants generated" —
// independent of HTTP, independent of whichever route or worker is asking.
export interface GenerationRequestProps {
  lyrics?: string;
  genre: Genre;
  mood: Mood;
  language: Language;
  voiceType: VoiceType;
  durationSeconds: number;
  hasReferenceAudio: boolean;
}

export class GenerationRequest {
  private constructor(private readonly props: GenerationRequestProps) {}

  static create(props: GenerationRequestProps): GenerationRequest {
    if (!props.hasReferenceAudio && !props.lyrics) {
      throw new Error('Lyrics are required when no reference audio is provided');
    }
    if (props.durationSeconds < 15 || props.durationSeconds > 300) {
      throw new Error('Duration must be between 15 and 300 seconds');
    }
    return new GenerationRequest(props);
  }

  get lyrics() { return this.props.lyrics; }
  get genre() { return this.props.genre; }
  get mood() { return this.props.mood; }
  get language() { return this.props.language; }
  get voiceType() { return this.props.voiceType; }
  get durationSeconds() { return this.props.durationSeconds; }
  get hasReferenceAudio() { return this.props.hasReferenceAudio; }

  get cost(): GenerationCost {
    return GenerationCost.forDuration(this.props.durationSeconds);
  }

  /** Default title generation — extracted from the inline `new Date().toLocaleString(...)` previously duplicated in SongGenerationService. */
  defaultTitle(): string {
    return `Song - ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  }
}

// ── Entity: SongGenerationJob ───────────────────────────────────────────────
// Wraps the Song + AIJob pair as a single aggregate — in the existing
// schema these are two separate rows (Song.status duplicates AIJob.status
// in spirit, tracked independently), and nothing enforced that they stay in
// sync. This entity is the seam where that invariant gets enforced going
// forward, and exposes the state-transition rules as methods rather than
// letting callers `prisma.song.update({ data: { status: 'COMPLETED' } })`
// from arbitrary call sites with no validation that the transition is legal.
export interface SongGenerationJobProps {
  songId: string;
  aiJobId: string;
  userId: string;
  organizationId: string | null;
  songStatus: SongStatus;
  jobStatus: AIJobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
}

const VALID_TRANSITIONS: Record<AIJobStatus, AIJobStatus[]> = {
  QUEUED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['QUEUED'], // retry re-queues a failed job
  CANCELLED: [],
};

export class SongGenerationJob {
  private constructor(private props: SongGenerationJobProps) {}

  static fromPersistence(props: SongGenerationJobProps): SongGenerationJob {
    return new SongGenerationJob(props);
  }

  get songId() { return this.props.songId; }
  get aiJobId() { return this.props.aiJobId; }
  get jobStatus() { return this.props.jobStatus; }
  get progress() { return this.props.progress; }
  get attempts() { return this.props.attempts; }

  canRetry(): boolean {
    return this.props.jobStatus === 'FAILED' && this.props.attempts < this.props.maxAttempts;
  }

  canTransitionTo(target: AIJobStatus): boolean {
    return VALID_TRANSITIONS[this.props.jobStatus].includes(target);
  }

  /** Belongs-to check — the ONE place "does this user/org own this job" is decided for the AI domain, replacing the ad-hoc `song.userId !== user.id` checks scattered across routes. */
  isOwnedBy(params: { userId: string; organizationId?: string }): boolean {
    if (this.props.organizationId) {
      return this.props.organizationId === params.organizationId;
    }
    return this.props.userId === params.userId;
  }
}
