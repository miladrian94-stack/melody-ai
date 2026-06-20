// lib/providers/suno-ai-provider.ts — Self-hosted Suno (Docker) AIProvider
//
// Third of three swappable AIProvider implementations. Unlike Replicate
// and FAL (hosted SaaS APIs with a token), this targets a self-hosted
// Suno-compatible generation service running in its own Docker
// container — matching the "Suno (via self-hosted Docker)" integration
// already in progress per current project context. The container is
// expected to expose a simple HTTP API (generate + poll-by-job-id), which
// is the common shape for the open-source Suno-API wrapper projects this
// is typically deployed from.
//
// Config: SUNO_SERVICE_URL (e.g. http://localhost:3001 or the in-cluster
// service DNS name once deployed alongside the BullMQ worker — see
// docker-compose.yml / Dockerfile.worker for where a sibling service
// would be added). Optional SUNO_SERVICE_API_KEY if the self-hosted
// service is configured to require one.
//
// Not reachable in this environment yet — fails fast with a clear error,
// same pattern as the other two providers, rather than hanging on a
// connection that will never succeed.

import {
  AIProvider,
  MelodyData,
  MusicData,
  VoiceData,
  AudioComponents,
  PitchData,
} from './ai-provider';
import { InfrastructureError } from '@/Backend/domains/shared/errors/domain-errors';
import { mixAudioBuffers, masterAudioBuffer, stripNoiseFloor, estimatePitch } from './audio-toolkit';
import { LyricsEnhancer } from './lyrics-enhancer';

function requireSunoServiceUrl(): string {
  const url = process.env.SUNO_SERVICE_URL;
  if (!url) {
    throw new InfrastructureError(
      'Suno self-hosted provider',
      new Error('SUNO_SERVICE_URL is not configured — set it to the self-hosted Suno service URL before using the "suno" provider.'),
    );
  }
  return url.replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env.SUNO_SERVICE_API_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

interface SunoGenerateResponse {
  id: string;
}

interface SunoJobStatusResponse {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'error';
  audio_url?: string;
  error?: string;
}

async function pollSunoJob(baseUrl: string, jobId: string): Promise<string> {
  const pollIntervalMs = 3000;
  const maxAttempts = 200; // self-hosted Suno generations commonly run longer than hosted-API single-step calls

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${baseUrl}/api/generate/${jobId}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Suno job status check failed (${res.status})`);
    const status = (await res.json()) as SunoJobStatusResponse;

    if (status.status === 'complete') {
      if (!status.audio_url) throw new Error('Suno job completed but returned no audio_url');
      return status.audio_url;
    }
    if (status.status === 'error') {
      throw new Error(`Suno generation failed: ${status.error ?? 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Suno job ${jobId} timed out after ${maxAttempts * pollIntervalMs}ms`);
}

async function fetchAudioBuffer(url: string, baseUrl: string): Promise<Buffer> {
  // Self-hosted services commonly return relative paths for generated
  // assets rather than absolute URLs — resolve against the service's own
  // base URL when needed.
  const resolvedUrl = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  const res = await fetch(resolvedUrl, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to download generated audio (${res.status}): ${resolvedUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

function genreToTags(genre: string, mood: string): string {
  // Suno-style services typically take a freeform "tags" string (its
  // training data was tagged this way) rather than a structured prompt —
  // comma-separated descriptors, matching the convention used by the
  // open-source Suno-API wrappers this provider targets.
  const genreMap: Record<string, string> = {
    POP: 'pop',
    RAP: 'rap, hip hop',
    ROCK: 'rock',
    EDM: 'edm, electronic',
    ARABIC: 'arabic, oud, qanun',
    KHALEEJI: 'khaleeji, gulf, traditional percussion',
    YEMENI: 'yemeni, oud, traditional',
    LOFI: 'lofi, chill',
    CINEMATIC: 'cinematic, orchestral',
    ACOUSTIC: 'acoustic, guitar',
  };
  const moodMap: Record<string, string> = {
    HAPPY: 'upbeat, joyful',
    SAD: 'melancholic, sad',
    EPIC: 'epic, powerful',
    ROMANTIC: 'romantic, warm',
    EMOTIONAL: 'emotional, heartfelt',
    MOTIVATIONAL: 'motivational, uplifting',
  };
  return `${genreMap[genre] ?? genre.toLowerCase()}, ${moodMap[mood] ?? mood.toLowerCase()}`;
}

export class SunoAIProvider implements AIProvider {
  async enhanceLyrics(lyrics: string, language: string): Promise<string> {
    return LyricsEnhancer.enhance(lyrics, language);
  }

  async generateMelody(lyrics: string, genre: string, mood: string): Promise<MelodyData> {
    // Suno-style services generate full songs (vocals + instrumental
    // together) from lyrics + tags in one step, unlike MusicGen/Bark's
    // separate instrumental/voice stages on the other two providers. This
    // stage still only builds the plan; generateMusic() makes the actual
    // call and synthesizeVoice() becomes a pass-through (see below) since
    // Suno-style generation doesn't expose separable vocal/instrumental
    // stems on the typical self-hosted API surface.
    requireSunoServiceUrl();

    const structure = { intro: 8, verse: 16, chorus: 16, bridge: 8, outro: 8 };
    return {
      midi: Buffer.from(JSON.stringify({ tags: genreToTags(genre, mood), lyrics, structure })),
      tempo: mood === 'EPIC' || mood === 'MOTIVATIONAL' ? 128 : 92,
      key: 'C major',
      structure,
    };
  }

  async generateMusic(melody: MelodyData, genre: string): Promise<MusicData> {
    const baseUrl = requireSunoServiceUrl();
    const plan = JSON.parse(melody.midi.toString()) as { tags: string; lyrics?: string };

    const submitRes = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        prompt: plan.lyrics ?? '',
        tags: plan.tags,
        make_instrumental: !plan.lyrics, // self-hosted Suno generates a full song with vocals when lyrics are given
      }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => '');
      throw new Error(`Suno generation request failed (${submitRes.status}): ${body}`);
    }

    const { id } = (await submitRes.json()) as SunoGenerateResponse;
    const audioUrl = await pollSunoJob(baseUrl, id);
    const audio = await fetchAudioBuffer(audioUrl, baseUrl);

    return {
      audio,
      // Suno-style output is already a complete mixed song when lyrics are
      // provided — stems aren't separable, so 'full' is used as a marker
      // key rather than 'instrumental' to avoid implying a vocal track
      // still needs mixing in (see synthesizeVoice below).
      stems: { full: audio },
      bpm: 0, // not reported by the typical self-hosted API surface
    };
  }

  async synthesizeVoice(lyrics: string, voiceType: string, language: string): Promise<VoiceData> {
    void lyrics;
    void voiceType;
    void language;
    // Suno-style generation already produces vocals baked into the audio
    // from generateMusic() when lyrics were supplied — there's no separate
    // vocal stem to synthesize. Returning an empty/silent buffer here (vs.
    // throwing) keeps process-song-generation.use-case.ts's mixAudio step
    // working unmodified: mixing a near-silent "vocals" buffer with the
    // already-complete Suno output leaves the Suno audio dominant.
    return {
      audio: Buffer.alloc(0),
      pitch: 0,
      timbre: {},
    };
  }

  async mixAudio(components: AudioComponents): Promise<Buffer> {
    // If vocals is empty (the Suno pass-through case above), just return
    // the music buffer directly rather than running it through ffmpeg's
    // amix with a zero-length input, which would error.
    if (components.vocals.length === 0) return components.music;
    return mixAudioBuffers(components);
  }

  async masterAudio(mixedAudio: Buffer): Promise<Buffer> {
    return masterAudioBuffer(mixedAudio);
  }

  async removeNoise(audio: Buffer): Promise<Buffer> {
    return stripNoiseFloor(audio);
  }

  async detectPitch(audio: Buffer): Promise<PitchData> {
    return estimatePitch(audio);
  }
}
