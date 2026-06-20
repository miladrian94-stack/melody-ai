// lib/providers/replicate-ai-provider.ts — Replicate-backed AIProvider
//
// Implements the existing `AIProvider` interface (lib/providers/ai-provider.ts)
// against Replicate's hosted inference API. This is one of three swappable
// providers (Replicate / FAL.ai / self-hosted Suno) registered into the
// existing `AIProviderFactory` — see lib/providers/index.ts for the
// registration + selection logic. No changes to the interface, the
// use-case, or the queue were needed: this file is purely an
// implementation of the contract that already existed.
//
// Models used:
//   - melody/music: Meta's MusicGen (`meta/musicgen`) — text-conditioned
//     instrumental generation. There's no separate "melody" stage in
//     Replicate's MusicGen API (it generates audio directly from a prompt,
//     not a MIDI intermediate), so `generateMelody()` produces a structured
//     prompt + song-structure plan and defers actual audio synthesis to
//     `generateMusic()`, which is where the real Replicate call happens.
//     This keeps both AIProvider methods meaningful without inventing a
//     fake MIDI step the model doesn't actually support.
//   - voice: Suno's Bark (`suno-ai/bark`) — supports custom voice presets;
//     Arabic presets are selected via ARABIC_VOICE_PRESETS below since
//     Bark's preset library includes non-English speaker embeddings.
//
// Auth: REPLICATE_API_TOKEN. Not set in this environment yet — every method
// fails fast with a clear InfrastructureError rather than an opaque fetch
// failure, mirroring the requireRedis() pattern in
// infrastructure/queue/generation-queue.ts.

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

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

// Pinned model versions (Replicate requires a version hash, not just a
// model name, for predictions). These should be bumped deliberately when
// validated against a newer version — never auto-floated to "latest".
const MUSICGEN_VERSION = 'meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055ce93827da3da14e35b14b';
const BARK_VERSION = 'suno-ai/bark:b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2da';

// Bark speaker presets with usable Arabic-adjacent / multilingual coverage.
// Bark's official preset library is sparse for Arabic specifically, so this
// maps our domain's MALE/FEMALE + ARABIC/ENGLISH combo to the closest
// available multilingual speaker embeddings. Swap these for fine-tuned
// Arabic speakers as they become available — isolated in one constant so
// that's a one-line change, not a code change.
const VOICE_PRESETS: Record<string, string> = {
  'ARABIC:MALE': 'v2/ar_speaker_1',
  'ARABIC:FEMALE': 'v2/ar_speaker_0',
  'ENGLISH:MALE': 'v2/en_speaker_6',
  'ENGLISH:FEMALE': 'v2/en_speaker_9',
};

function requireReplicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new InfrastructureError(
      'Replicate AI provider',
      new Error('REPLICATE_API_TOKEN is not configured — set it before using the "replicate" provider.'),
    );
  }
  return token;
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: unknown;
  error: string | null;
}

async function runPrediction(
  version: string,
  input: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const createRes = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`Replicate prediction creation failed (${createRes.status}): ${body}`);
  }

  let prediction = (await createRes.json()) as ReplicatePrediction;

  // Replicate predictions are async — poll until terminal state. No
  // built-in webhook handling here since the worker that calls this is
  // already a background BullMQ job; polling inside it doesn't block any
  // HTTP request (the use-case forbids that anyway — see
  // process-song-generation.use-case.ts comments).
  const pollIntervalMs = 2000;
  const maxAttempts = 150; // ~5 minutes ceiling per call

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (prediction.status === 'succeeded') return prediction.output;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!pollRes.ok) {
      throw new Error(`Replicate prediction poll failed (${pollRes.status})`);
    }
    prediction = (await pollRes.json()) as ReplicatePrediction;
  }

  throw new Error(`Replicate prediction ${prediction.id} timed out after ${maxAttempts * pollIntervalMs}ms`);
}

async function fetchAudioBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated audio (${res.status}): ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function genreToPromptFragment(genre: string, mood: string): string {
  // Maps the domain's controlled vocab (see createSongRequestSchema in
  // domains/ai/dto/song.dto.ts) into a natural-language MusicGen prompt
  // fragment. ARABIC/KHALEEJI/YEMENI are domain-specific genres MusicGen
  // has no native label for, so they're expanded into descriptive terms
  // the model responds to better than the raw enum value.
  const genreMap: Record<string, string> = {
    POP: 'pop',
    RAP: 'hip hop, rap beat',
    ROCK: 'rock',
    EDM: 'electronic dance music, EDM',
    ARABIC: 'Arabic music, oud and qanun instrumentation',
    KHALEEJI: 'Khaleeji Gulf music, traditional Arabian Gulf percussion',
    YEMENI: 'Yemeni traditional music, oud-led melody',
    LOFI: 'lo-fi chill beat',
    CINEMATIC: 'cinematic orchestral score',
    ACOUSTIC: 'acoustic guitar, unplugged',
  };
  const moodMap: Record<string, string> = {
    HAPPY: 'upbeat and joyful',
    SAD: 'melancholic and somber',
    EPIC: 'epic and powerful',
    ROMANTIC: 'romantic and warm',
    EMOTIONAL: 'emotional and heartfelt',
    MOTIVATIONAL: 'motivational and uplifting',
  };
  return `${genreMap[genre] ?? genre.toLowerCase()}, ${moodMap[mood] ?? mood.toLowerCase()}`;
}

export class ReplicateAIProvider implements AIProvider {
  async enhanceLyrics(lyrics: string, language: string): Promise<string> {
    // Lyrics enhancement isn't a Replicate model call — delegate to the
    // shared LyricsEnhancer (Claude Haiku / GPT-4o-mini), which every
    // provider reuses rather than each reimplementing prompt-based text
    // generation against a different LLM API.
    return LyricsEnhancer.enhance(lyrics, language);
  }

  async generateMelody(lyrics: string, genre: string, mood: string): Promise<MelodyData> {
    const token = requireReplicateToken();
    // No standalone MIDI-generation model is wired here — MusicGen
    // generates audio directly from a text prompt. This stage builds the
    // structured plan (tempo/key/song structure + final prompt text) that
    // generateMusic() consumes, keeping the two-stage interface intact
    // without faking a MIDI artifact nothing downstream actually reads
    // (mixAudio/masterAudio only ever touch the audio Buffers).
    void token; // no network call needed for planning; token validated for fail-fast consistency

    const promptFragment = genreToPromptFragment(genre, mood);
    const structure = {
      intro: 8,
      verse: 16,
      chorus: 16,
      bridge: 8,
      outro: 8,
    };

    return {
      midi: Buffer.from(JSON.stringify({ prompt: promptFragment, lyrics, structure })),
      tempo: mood === 'EPIC' || mood === 'MOTIVATIONAL' ? 128 : 92,
      key: 'C major',
      structure,
    };
  }

  async generateMusic(melody: MelodyData, genre: string): Promise<MusicData> {
    const token = requireReplicateToken();
    const plan = JSON.parse(melody.midi.toString()) as { prompt: string; structure: MelodyData['structure'] };
    const totalBars = Object.values(plan.structure).reduce((a, b) => a + b, 0);
    const durationSeconds = Math.min(30, Math.max(8, Math.round(totalBars / 2))); // MusicGen caps around 30s per call

    const output = await runPrediction(
      MUSICGEN_VERSION,
      {
        prompt: plan.prompt,
        model_version: 'stereo-large',
        duration: durationSeconds,
        output_format: 'mp3',
        normalization_strategy: 'loudness',
      },
      token,
    );

    const audioUrl = typeof output === 'string' ? output : (output as { audio?: string })?.audio;
    if (!audioUrl) throw new Error('MusicGen prediction returned no audio output');

    const audio = await fetchAudioBuffer(audioUrl);

    return {
      audio,
      stems: { instrumental: audio }, // MusicGen's stereo-large output is a mixed instrumental, not stem-separated
      bpm: melody.tempo,
    };
  }

  async synthesizeVoice(lyrics: string, voiceType: string, language: string): Promise<VoiceData> {
    const token = requireReplicateToken();
    const presetKey = `${language}:${voiceType}`;
    const preset = VOICE_PRESETS[presetKey] ?? VOICE_PRESETS['ENGLISH:FEMALE'];

    const output = await runPrediction(
      BARK_VERSION,
      {
        prompt: lyrics,
        history_prompt: preset,
        text_temp: 0.7,
        waveform_temp: 0.7,
      },
      token,
    );

    const audioUrl = typeof output === 'string' ? output : (output as { audio_out?: string })?.audio_out;
    if (!audioUrl) throw new Error('Bark prediction returned no audio output');

    const audio = await fetchAudioBuffer(audioUrl);

    return {
      audio,
      pitch: voiceType === 'FEMALE' ? 220 : 110, // rough indicative values; not derived from the model output
      timbre: { warmth: 0.5, brightness: 0.5 },
    };
  }

  // Mixing/mastering/noise-removal/pitch-detection are local DSP
  // operations, not hosted-model calls — every provider shares the same
  // ffmpeg-backed implementation in audio-toolkit.ts rather than each
  // reimplementing (or each requiring its own paid API for what's a
  // solved, local problem).
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
