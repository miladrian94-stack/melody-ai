// lib/providers/index.ts — Provider Registration
//
// Closes a gap that existed independently of the "Not implemented" stubs:
// `AIProviderFactory.getProvider()` (lib/providers/ai-provider.ts) is
// always called with no argument, defaulting to name `'default'` — but
// nothing anywhere registered a provider under that name, so even with a
// fully-implemented DefaultAIProvider, `getProvider()` would throw
// `AI provider 'default' not found` (see AIProviderFactory.getProvider's
// existing implementation, unmodified here). This module is the single
// place that calls `registerProvider()`, imported once for its side
// effect at process startup — by the worker (workers/ai-generation.worker.ts)
// and, for parity, the main app entrypoint, since `app/api/studio/generate`
// only enqueues a job and never calls getProvider() itself, but keeping
// both processes' registries identical avoids "works in the worker, throws
// in a future direct-call path" surprises.
//
// Selection: AI_PROVIDER env var chooses which of the three registered
// providers answers to the 'default' name the use-case asks for —
// 'replicate' | 'fal' | 'suno'. Defaults to 'replicate' (broadest model
// coverage via one hosted API, least operational dependency — no sibling
// Docker service required — making it the most likely to actually work
// the moment a single API token is added). All three remain registered
// under their own names regardless of which is 'default', so a future
// per-request provider override (e.g. a Pro-tier user routed to a higher
// quality model) only needs `AIProviderFactory.getProvider('fal')`, no
// further registration work.

import { AIProviderFactory, type AIProvider } from './ai-provider';
import { ReplicateAIProvider } from './replicate-ai-provider';
import { FalAIProvider } from './fal-ai-provider';
import { SunoAIProvider } from './suno-ai-provider';

type ProviderName = 'replicate' | 'fal' | 'suno';

let registered = false;

export function registerAIProviders(): void {
  // Idempotent — both the worker and the main app process may import this
  // module, and Next.js's module cache doesn't guarantee single-eval
  // across every runtime (e.g. dev-mode hot reload), so guard against
  // double-registering rather than relying on import semantics alone.
  if (registered) return;

  const replicate = new ReplicateAIProvider();
  const fal = new FalAIProvider();
  const suno = new SunoAIProvider();

  AIProviderFactory.registerProvider('replicate', replicate);
  AIProviderFactory.registerProvider('fal', fal);
  AIProviderFactory.registerProvider('suno', suno);

  const selected = (process.env.AI_PROVIDER as ProviderName | undefined) ?? 'replicate';
  const providerMap: Record<ProviderName, AIProvider> = { replicate, fal, suno };
  const activeProvider = providerMap[selected] ?? replicate;

  if (!(selected in providerMap)) {
    console.warn(
      `[ai-providers] AI_PROVIDER="${selected}" is not one of replicate|fal|suno — falling back to "replicate".`,
    );
  }

  // 'default' is the name process-song-generation.use-case.ts actually
  // asks for via AIProviderFactory.getProvider() with no argument — see
  // file header. Registering the chosen provider under that name is what
  // makes AI_PROVIDER take effect without touching the use-case.
  AIProviderFactory.registerProvider('default', activeProvider);

  registered = true;
  console.log(`[ai-providers] registered replicate, fal, suno — active "default" provider: ${selected}`);
}
