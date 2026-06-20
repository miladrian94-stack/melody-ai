// lib/providers/fal-ai-provider.ts — FAL.ai-backed AIProvider
//
// Second of three swappable AIProvider implementations (see
// lib/providers/index.ts for registration/selection). FAL.ai hosts
// several relevant models behind one queue-based API shape — this
// provider supports three of them for music generation
// (MusicGen / Stable Audio / AudioLDM2), selectable per-call via
// FAL_MUSIC_MODEL, since they have different strengths (Stable Audio
// tends toward cleaner ambient/cinematic textures, AudioLDM2 is
// stronger on sound-design-heavy prompts, MusicGen on rhythmic/genre
// material) and the "best" one is genre-dependent rather than fixed.
//
// Voice synthesis isn't offered on FAL in a way that matches this
// project's MALE/FEMALE + ARABIC/ENGLISH preset requirement as cleanly
// as Bark on Replicate does, so synthesizeVoice() here delegates to the
// Replicate provider's Bark implementation rather than half-implementing
// a weaker voice path — providers are swappable per-capability via the
// registry, not required to be siloed reimplementations of every method.
//
// Auth: FAL_KEY. Not set in this environment yet — fails fast like the
// other providers.

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
import { ReplicateAIProvider } from './replicate-ai-provider';

const FAL_API_BASE = 'https://queue.fal.run';

type FalMusicModel = 'musicgen' | 'stable-audio' | 'audioldm2';

const FAL_MODEL_ENDPOINTS: Record<FalMusicModel, string> = {
  musicgen: 'fal-ai/musicgen-melody/text-to-audio',
  'stable-audio': 'fal-ai/stable-audio',
  audioldm2: 'fal-ai/audioldm2',
};

function requireFalKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new InfrastructureError(
      'FAL.ai provider',
      new Error('FAL_KEY is not configured — set it before using the "fal" provider.'),
    );
  }
  return key;
}

function resolveMusicModel(): FalMusicModel {
  const configured = process.env.FAL_MUSIC_MODEL as FalMusicModel | undefined;
  if (configured && configured in FAL_MODEL_ENDPOINTS) return configured;
  return 'musicgen'; // default: best general-purpose genre coverage for this app's enum (POP/RAP/ROCK/EDM/...)
}

interface FalQueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalQueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
}

async function runFalRequest(endpoint: string, input: Record<string, unknown>, key: string): Promise<unknown> {
  const submitRes = await fetch(`${FAL_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`FAL request submission failed (${submitRes.status}): ${body}`);
  }

  const submitted = (await submitRes.json()) as FalQueueSubmitResponse;

  const pollIntervalMs = 2000;
  const maxAttempts = 150; // ~5 minutes ceiling, matching the Replicate provider's budget

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(submitted.status_url, {
      headers: { Authorization: `Key ${key}` },
    });
    if (!statusRes.ok) throw new Error(`FAL status poll failed (${statusRes.status})`);
    const status = (await statusRes.json()) as FalQueueStatusResponse;

    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(submitted.response_url, {
        headers: { Authorization: `Key ${key}` },
      });
      if (!resultRes.ok) throw new Error(`FAL result fetch failed (${resultRes.status})`);
      return resultRes.json();
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`FAL request ${submitted.request_id} timed out after ${maxAttempts * pollIntervalMs}ms`);
}

async function fetchAudioBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated audio (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function genreToPromptFragment(genre: string, mood: string): string {
  // Same controlled-vocab mapping as replicate-ai-provider.ts — kept as a
  // local copy rather than a shared import because the two providers'
  // prompt styles diverge slightly (FAL's models respond better to
  // shorter, comma-free phrasing in practice), not because of a missed
  // refactor opportunity.
  const genreMap: Record<string, string> = {
    POP: 'pop music',
    RAP: 'hip hop beat',
    ROCK: 'rock music',
    EDM: 'electronic dance music',
    ARABIC: 'Arabic music with oud and qanun',
    KHALEEJI: 'Khaleeji Gulf percussion music',
    YEMENI: 'Yemeni oud melody',
    LOFI: 'lo-fi chill beat',
    CINEMATIC: 'cinematic orchestral score',
    ACOUSTIC: 'acoustic guitar',
  };
  const moodMap: Record<string, string> = {
    HAPPY: 'upbeat joyful',
    SAD: 'melancholic somber',
    EPIC: 'epic powerful',
    ROMANTIC: 'romantic warm',
    EMOTIONAL: 'emotional heartfelt',
    MOTIVATIONAL: 'motivational uplifting',
  };
  return `${moodMap[mood] ?? mood.toLowerCase()} ${genreMap[genre] ?? genre.toLowerCase()}`;
}

export class FalAIProvider implements AIProvider {
  async enhanceLyrics(lyrics: string, language: string): Promise<string> {
    return LyricsEnhancer.enhance(lyrics, language);
  }

  async generateMelody(lyrics: string, genre: string, mood: string): Promise<MelodyData> {
    // Same rationale as ReplicateAIProvider.generateMelody: FAL's music
    // models are text-conditioned end-to-end audio generators, not
    // MIDI-stage generators. This builds the prompt/structure plan;
    // generateMusic() does the actual model call.
    requireFalKey();

    const promptFragment = genreToPromptFragment(genre, mood);
    const structure = { intro: 8, verse: 16, chorus: 16, bridge: 8, outro: 8 };

    return {
      midi: Buffer.from(JSON.stringify({ prompt: promptFragment, lyrics, structure })),
      tempo: mood === 'EPIC' || mood === 'MOTIVATIONAL' ? 128 : 92,
      key: 'C major',
      structure,
    };
  }

  async generateMusic(melody: MelodyData, genre: string): Promise<MusicData> {
    const key = requireFalKey();
    const model = resolveMusicModel();
    const plan = JSON.parse(melody.midi.toString()) as { prompt: string; structure: MelodyData['structure'] };
    const totalBars = Object.values(plan.structure).reduce((a, b) => a + b, 0);
    const durationSeconds = Math.min(30, Math.max(8, Math.round(totalBars / 2)));

    // Each FAL model endpoint has a slightly different input schema —
    // normalized here so callers (generateMusic itself) don't need to
    // branch on the model elsewhere in the codebase.
    const input: Record<string, unknown> =
      model === 'musicgen'
        ? { prompt: plan.prompt, duration: durationSeconds }
        : model === 'stable-audio'
          ? { prompt: plan.prompt, seconds_total: durationSeconds }
          : { prompt: plan.prompt, audio_length_in_s: durationSeconds }; // audioldm2

    const result = await runFalRequest(FAL_MODEL_ENDPOINTS[model], input, key);
    const audioUrl =
      (result as { audio_file?: { url?: string }; audio?: { url?: string } })?.audio_file?.url ??
      (result as { audio?: { url?: string } })?.audio?.url;

    if (!audioUrl) throw new Error(`FAL ${model} returned no audio output`);

    const audio = await fetchAudioBuffer(audioUrl);

    return {
      audio,
      stems: { instrumental: audio },
      bpm: melody.tempo,
    };
  }

  async synthesizeVoice(lyrics: string, voiceType: string, language: string): Promise<VoiceData> {
    // Delegated to Replicate/Bark — see file header. This still requires
    // REPLICATE_API_TOKEN to actually succeed at runtime; if only FAL_KEY
    // is configured, this call will fail with Replicate's own clear
    // InfrastructureError rather than this provider silently no-opting.
    return new ReplicateAIProvider().synthesizeVoice(lyrics, voiceType, language);
  }

  async mixAudio(components: AudioComponents): Promise<Buffer> {
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
