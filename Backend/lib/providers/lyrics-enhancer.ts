// lib/providers/lyrics-enhancer.ts — Bilingual Lyrics Enhancement
//
// Shared by every AIProvider implementation's enhanceLyrics() method (see
// replicate-ai-provider.ts, fal-ai-provider.ts, suno-ai-provider.ts) so
// lyrics-enhancement logic exists in exactly one place rather than being
// copy-pasted per provider. Supports two interchangeable backends — Claude
// Haiku and GPT-4o-mini — selected via LYRICS_ENHANCER_BACKEND, since
// either is a reasonably-priced, fast text model well-suited to this
// (not music generation, just rewriting/polishing existing lyrics).
//
// Both ANTHROPIC_API_KEY and OPENAI_API_KEY are unset in this environment
// — same fail-fast-with-clear-error pattern as the music/voice providers.
// If NEITHER is configured, enhancement falls back to returning the input
// lyrics unchanged (matching the original DefaultAIProvider.enhanceLyrics
// behavior) rather than hard-failing the whole generation over an
// optional polish step.

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_BASE = 'https://api.openai.com/v1/chat/completions';

type Backend = 'claude-haiku' | 'gpt-4o-mini';

function resolveBackend(): Backend | null {
  const configured = process.env.LYRICS_ENHANCER_BACKEND as Backend | undefined;
  if (configured === 'claude-haiku' && process.env.ANTHROPIC_API_KEY) return 'claude-haiku';
  if (configured === 'gpt-4o-mini' && process.env.OPENAI_API_KEY) return 'gpt-4o-mini';

  // No explicit preference (or the preferred one isn't configured) — use
  // whichever key is actually present, preferring Claude since this is
  // an Anthropic-API-consuming project elsewhere too (see
  // anthropic_api_in_artifacts conventions used in this codebase's tooling).
  if (process.env.ANTHROPIC_API_KEY) return 'claude-haiku';
  if (process.env.OPENAI_API_KEY) return 'gpt-4o-mini';
  return null;
}

function buildPrompt(lyrics: string, language: string): string {
  const languageName = language === 'ARABIC' ? 'Arabic' : 'English';
  // Instructs the model to preserve language, meaning, and line structure
  // — this is a polish pass (rhythm, rhyme, word choice for singability),
  // not a rewrite or translation. Arabic gets an explicit note about
  // diacritics/dialect since song lyrics often use colloquial dialect
  // rather than Modern Standard Arabic, and over-correcting to MSA would
  // change the song's character.
  const dialectNote =
    language === 'ARABIC'
      ? ' Preserve the original dialect (e.g. Khaleeji, Yemeni, Egyptian, or MSA) rather than normalizing to Modern Standard Arabic, unless the input is already MSA.'
      : '';

  return [
    `You are polishing song lyrics written in ${languageName} for an AI music generation pipeline.`,
    `Improve rhythm, rhyme, and natural singability while preserving the original meaning, structure, and line breaks.${dialectNote}`,
    'Do not add explanations, headers, or commentary — return only the enhanced lyrics text.',
    '',
    'Lyrics:',
    lyrics,
  ].join('\n');
}

async function enhanceWithClaude(lyrics: string, language: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string;
  const res = await fetch(ANTHROPIC_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(lyrics, language) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude lyrics enhancement failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error('Claude lyrics enhancement returned no text content');
  return text.trim();
}

async function enhanceWithGpt(lyrics: string, language: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY as string;
  const res = await fetch(OPENAI_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: buildPrompt(lyrics, language) }],
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GPT-4o-mini lyrics enhancement failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { choices: Array<{ message?: { content?: string } }> };
  const text = data.choices[0]?.message?.content;
  if (!text) throw new Error('GPT-4o-mini lyrics enhancement returned no text content');
  return text.trim();
}

export class LyricsEnhancer {
  static async enhance(lyrics: string, language: string): Promise<string> {
    const backend = resolveBackend();

    // No key configured for either backend — degrade to a no-op rather
    // than failing the whole song generation, matching the original
    // DefaultAIProvider.enhanceLyrics stub's behavior (return lyrics
    // unchanged) since enhancement is a quality improvement, not a
    // required step the rest of the pipeline depends on.
    if (!backend) return lyrics;

    try {
      return backend === 'claude-haiku'
        ? await enhanceWithClaude(lyrics, language)
        : await enhanceWithGpt(lyrics, language);
    } catch (err) {
      // Same reasoning: a transient enhancement-API failure shouldn't sink
      // an otherwise-successful generation. Log and fall back to the
      // original lyrics rather than throwing.
      console.error('[lyrics-enhancer] falling back to unenhanced lyrics:', err);
      return lyrics;
    }
  }
}
