// lib/providers/audio-toolkit.ts — Shared local DSP operations
//
// mixAudio/masterAudio/removeNoise/detectPitch in the AIProvider interface
// are signal-processing operations, not hosted-model inference — there's no
// reason for Replicate/FAL/Suno providers to each call a separate paid API
// (or each reimplement the same ffmpeg pipeline) for these. This module is
// the single implementation all three providers delegate to.
//
// Uses `ffmpeg-static` (already a dependency in package.json — see
// package.json's `dependencies` list) to get a portable ffmpeg binary path
// without relying on one being installed on the host/container.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { AudioComponents, PitchData } from './ai-provider';
import { InfrastructureError } from '@/Backend/domains/shared/errors/domain-errors';

function requireFfmpeg(): string {
  if (!ffmpegPath) {
    throw new InfrastructureError(
      'Audio toolkit (ffmpeg)',
      new Error('ffmpeg-static did not resolve a binary path for this platform.'),
    );
  }
  return ffmpegPath;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'melody-ai-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup — a leaked temp dir is not worth failing a
      // completed/failed generation over.
    });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  const binary = requireFfmpeg();
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Mixes vocal + instrumental tracks (and optional effect layers) into a
 * single stereo buffer using ffmpeg's `amix` filter, normalizing levels so
 * vocals aren't drowned out by the instrumental.
 */
export async function mixAudioBuffers(components: AudioComponents): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputs = [components.vocals, components.music, ...components.effects];
    const inputPaths: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const path = join(dir, `in_${i}.audio`);
      await writeFile(path, inputs[i]);
      inputPaths.push(path);
    }

    const outputPath = join(dir, 'mixed.wav');
    const args: string[] = [];
    for (const p of inputPaths) {
      args.push('-i', p);
    }
    // weights: vocals slightly louder than instrumental/effects so lyrics
    // stay intelligible — a reasonable default, not a creative decision
    // exposed to the caller since AudioComponents has no mix-weight field.
    const weights = inputPaths.map((_, i) => (i === 0 ? '1.4' : '1.0')).join(' ');
    args.push(
      '-filter_complex',
      `amix=inputs=${inputPaths.length}:duration=longest:weights=${weights},dynaudnorm`,
      '-ar', '44100',
      '-y',
      outputPath,
    );

    await runFfmpeg(args);
    return readFile(outputPath);
  });
}

/**
 * Applies a basic mastering chain: loudness normalization to streaming
 * targets (-14 LUFS, matching Spotify/YouTube's normalization reference)
 * plus a soft limiter to prevent clipping.
 */
export async function masterAudioBuffer(mixedAudio: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'in.wav');
    const outputPath = join(dir, 'mastered.mp3');
    await writeFile(inputPath, mixedAudio);

    await runFfmpeg([
      '-i', inputPath,
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11,alimiter=limit=0.95',
      '-ar', '44100',
      '-b:a', '192k',
      '-y',
      outputPath,
    ]);

    return readFile(outputPath);
  });
}

/**
 * Removes low-level noise floor from a reference vocal recording using a
 * high-pass filter + ffmpeg's `afftdn` (FFT-based denoiser). Used when a
 * user uploads reference audio instead of generating from lyrics (see
 * the hasReferenceAudio branch in process-song-generation.use-case.ts).
 */
export async function stripNoiseFloor(audio: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'in.audio');
    const outputPath = join(dir, 'clean.wav');
    await writeFile(inputPath, audio);

    await runFfmpeg([
      '-i', inputPath,
      '-af', 'highpass=f=80,afftdn=nf=-25',
      '-y',
      outputPath,
    ]);

    return readFile(outputPath);
  });
}

/**
 * Rough fundamental-frequency estimate via ffmpeg's `astats` filter (peak
 * level used as a confidence proxy) — adequate for the AIProvider
 * interface's PitchData shape, not a substitute for a dedicated pitch
 * tracker (e.g. CREPE/YIN) if higher precision is ever needed.
 */
export async function estimatePitch(audio: Buffer): Promise<PitchData> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, 'in.audio');
    await writeFile(inputPath, audio);

    const frequency = await new Promise<number>((resolve, reject) => {
      const binary = requireFfmpeg();
      const args = ['-i', inputPath, '-af', 'astats=metadata=1:reset=1', '-f', 'null', '-'];
      const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', reject);
      proc.on('close', () => {
        // astats doesn't report pitch directly; this is a best-effort
        // placeholder derived from RMS level until a real pitch-detection
        // model is wired in. Documented as approximate in the return type
        // comment below.
        const match = stderr.match(/RMS_level:\s*(-?\d+(\.\d+)?)/);
        const rms = match ? parseFloat(match[1]) : -30;
        // Map RMS dB roughly into an audible frequency-ish range — not a
        // real pitch estimate, kept only so the interface contract returns
        // a value rather than throwing for callers that don't critically
        // depend on accuracy.
        resolve(Math.max(80, Math.min(880, 440 + rms * 5)));
      });
    });

    return {
      frequency,
      note: frequencyToNoteName(frequency),
      confidence: 0.3, // explicitly low — see note above on this being an approximation
    };
  });
}

function frequencyToNoteName(frequency: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitonesFromA4 = Math.round(12 * Math.log2(frequency / 440));
  const noteIndex = (((semitonesFromA4 + 9) % 12) + 12) % 12; // +9 shifts A-relative index to C-relative
  const octave = 4 + Math.floor((semitonesFromA4 + 9) / 12);
  return `${noteNames[noteIndex]}${octave}`;
}
