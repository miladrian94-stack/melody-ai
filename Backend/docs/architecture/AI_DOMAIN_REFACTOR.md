# Melody AI — Domain-Driven Architecture Refactor: AI/Songs Domain

**Scope of this pass:** the AI generation/songs domain end-to-end, plus three project-wide structural fixes (duplicate `enterprise/` deletion, the Dockerfile's silent-folder-drop bug, the missing `Dockerfile.worker`). This is a worked example of the target architecture on real, previously-broken code — not a transformation of every domain. See Section 6 for what's intentionally not done and the plan to extend this pattern.

---

## 1. Real bugs found and fixed (not hypothetical — traced through actual call paths)

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | **Dead duplicate directory.** `Backend/lib/enterprise/` was a byte-for-byte copy of `Backend/enterprise/` (confirmed via `diff -rq`), imported by nothing. | `Backend/lib/enterprise/` | Deleted. |
| 2 | **Empty endpoint.** `studio/generate` did no auth, no validation, no work — just returned a static success message. | `app/api/studio/generate/route.ts` | Rebuilt on `CreateSongGenerationUseCase`. |
| 3 | **Non-atomic credit deduction.** `EnterpriseSongService.createQueuedSong` created Song+AIJob in one transaction, then called `CreditsService.deduct` (which opens its own SEPARATE transaction) afterward. A crash between the two leaves a queued job with no credit ever charged. Structural, not just a usage mistake — `CreditsService.deduct` was never composable with an outer transaction to begin with (it always opens its own). | `enterprise/services/enterprise-song.service.ts` | `CreditsDomainService.deduct(tx, ...)` requires the caller's transaction client — there is no overload that runs without one. |
| 4 | **Retry queue had no consumer.** The retry route pushed jobs to a BullMQ queue named `'song-generation'`. The actual worker (`enterprise-ai-worker.ts`) only consumed `'enterprise-ai-generation'`. Every retry request silently charged a credit and did nothing else. | `app/api/songs/[id]/retry/route.ts` | Retry now enqueues onto the single canonical `GENERATION_QUEUE_NAME` the worker actually listens to. |
| 5 | **Retry recharge ignored original cost.** Retry always deducted a flat 1 credit regardless of the song's actual duration-tiered cost (1/2/3 credits). | same file | `RetrySongGenerationUseCase` reads the original charged amount from `AIJob.input.cost` and charges exactly that. |
| 6 | **Retry had no transaction.** Status reset and credit deduction were two separate, unguarded calls. | same file | Wrapped in one `prisma.$transaction`. |
| 7 | **Two conflicting cost formulas.** `EnterpriseSongService.costForDuration` (tiered 1/2/3) vs `SongGenerationService.createSong` (flat 1, ignoring duration) — two different answers to the same business question, depending on which code path a request happened to go through. | `enterprise-song.service.ts` vs `services/song-generation.service.ts` | One formula: `GenerationCost.forDuration()` in the domain entity. |
| 8 | **AIJob never updated by the actual generation pipeline.** `SongGenerationService.processSongGeneration` updated `Song.status/progress` but never touched `AIJob` at all. The worker's own wrapper code updated `AIJob` separately, uncoordinated with the Song updates — no guarantee they'd agree on failure. | `services/song-generation.service.ts` + `enterprise/queue/ai-queue.ts` | `ProcessSongGenerationUseCase` is the single place updating both, together. |
| 9 | **Refund amount was hardcoded.** Failure handling always refunded 1 credit regardless of what was actually charged. | `services/song-generation.service.ts`'s `failSong` | `GenerationCost.of(chargedCost)` reads the real charged amount back off the job record before refunding. |
| 10 | **Redis-can-be-null passed directly into BullMQ.** `lib/redis.ts` exports `Redis \| null` (null when `REDIS_URL` unset), but `new Queue(name, { connection: redis })` was called with that possibly-null value in at least 3 places (`enterprise/queue/ai-queue.ts`, `services/song-generation.service.ts`, the old retry route), producing a confusing BullMQ-internal crash instead of a clear error. | multiple | `requireRedis()` throws a clear, explicit error before any Queue/Worker is constructed. |
| 11 | **`package.json`'s `"worker"` script pointed at a file that doesn't exist** (`workers/index.ts`). | `package.json` | Points to the real `workers/ai-generation.worker.ts`. |
| 12 | **`docker-compose.yml`'s worker service references `Dockerfile.worker`, which did not exist anywhere in the project.** `docker compose up` would fail at the worker's build step. The worker has likely never successfully run via this compose file. | `docker-compose.yml` / (missing file) | Created `Dockerfile.worker`. |
| 13 | **The main `Dockerfile` copied `Backend/`'s subfolders individually** (`COPY Backend/app ./app`, `COPY Backend/lib ./lib`, etc.) — flattening each EXCEPT `Backend/enterprise`, which was copied preserving its `Backend/` prefix. Any NEW top-level folder under `Backend/` (like this refactor's `domains/`, `application/`, `infrastructure/`) would silently never be copied into the image. This is almost certainly why `next.config.js` had `typescript: { ignoreBuildErrors: true }` — type errors from files missing in the actual build context were being suppressed rather than fixed. | `Dockerfile`, `next.config.js` | Dockerfile now copies the whole `Backend/` tree preserving its prefix; the error-suppressing flags are removed with a comment trail explaining why. |
| 14 | **No upper bound on `?limit=`.** The original songs-listing route had no cap, so `?limit=999999` was a valid, unbounded query. | `app/api/songs/route.ts` | Zod schema caps `limit` at 100. |
| 15 | **Unvalidated `orderBy` field from query string.** `orderBy: { [sort]: order }` with `sort` taken directly from `searchParams.get('sort')`. | same file | Allowlisted via `ListSongsUseCase`'s `ALLOWED_SORT_FIELDS`. |

## 2. New architecture (this domain)

```
Backend/
├── domains/
│   ├── ai/
│   │   ├── domain/              → GenerationCost, GenerationRequest, SongGenerationJob (pure, no DB dependency)
│   │   ├── repositories/        → SongRepository, AIJobRepository (interface + Prisma impl)
│   │   ├── use-cases/           → Create/Process/Retry/Get/List/Update/Delete — one class per business operation
│   │   ├── services/            → CreditsDomainService (transaction-aware, AI-domain-specific)
│   │   └── dto/                 → Zod schemas + response shaping
│   └── shared/
│       ├── errors/              → Domain error hierarchy (extends the existing AppError)
│       └── events/              → In-process domain event bus
├── infrastructure/
│   └── queue/                   → generation-queue.ts (BullMQ wrapper, fixes the null-Redis bug, adds orphaned-job reconciliation)
├── application/
│   └── http/                    → route-handler.ts (thin-controller wrapper, consistent error mapping, request-id correlation)
└── app/api/songs/, app/api/studio/generate/   → thin controllers, now ~15-25 lines each, zero business logic
```

**What moved where, concretely:**
- `EnterpriseSongService.createQueuedSong` → `CreateSongGenerationUseCase` (+ `CreditsDomainService`, `songRepository`, `aiJobRepository`, `generationQueue`)
- `SongGenerationService.processSongGeneration` → `ProcessSongGenerationUseCase`
- Retry logic inline in the route → `RetrySongGenerationUseCase`
- Inline Prisma queries in `GET/PATCH/DELETE /songs/[id]` and `GET/POST /songs` → `GetSongUseCase`, `UpdateSongUseCase`, `DeleteSongUseCase`, `ListSongsUseCase`
- `createEnterpriseAIWorker`'s inline Prisma calls → `workers/ai-generation.worker.ts` (now a ~50-line BullMQ adapter with zero business logic; everything delegates to `ProcessSongGenerationUseCase`)

## 3. What stayed the same (deliberately)

- `enterprise/core/errors.ts`'s `AppError`/`Errors` — kept as the base class, extended rather than replaced. Existing routes (`enterprise/credits/route.ts`, `enterprise/organizations/route.ts`, etc.) that already use it are untouched and keep working.
- `enterprise/guards/tenant.ts`, `enterprise/services/{audit,billing,feature-flags,organizations}.service.ts` — untouched. Out of scope for this pass (see Section 6).
- `lib/auth.ts`, `lib/prisma.ts`, `lib/redis.ts`, `lib/storage/s3.ts`, `lib/providers/ai-provider.ts` — untouched; the new domain code depends on these via their existing interfaces.
- All existing security checks in the routes (UUID validation, owner-or-admin, 404-not-403 pattern) — carried over verbatim into the use-cases, not relaxed.

## 4. A boundary worth naming honestly

`CreditsDomainService` (new, AI-domain-specific, transaction-aware) and `enterprise/services/credits.service.ts`'s `CreditsService` (existing, used by the billing/organizations enterprise routes) are now **two separate implementations of "deduct credits."** This isn't an oversight — `CreditsService.deduct` opens its own internal `prisma.$transaction`, which makes it structurally unable to participate in an outer transaction (nesting Prisma transactions isn't what that code does), so it could never have correctly served the AI domain's atomicity requirement without changing its own signature. Changing `CreditsService` itself was out of scope for this pass since other enterprise routes depend on its current signature.

**This is the natural next domain to tackle**: extracting a single `CreditsDomainService` that both the AI domain and a future Billing domain depend on, with the enterprise routes migrated onto it. Flagging this explicitly rather than quietly leaving two credit systems and calling the refactor "done."

## 5. Testing this domain

No test files existed for this logic before. Given the bug count found by simply *reading* the code, this domain is exactly where tests would have caught problems 3, 4, 5, 7, 9, and 10 immediately. Recommended first tests (Vitest — not currently a devDependency in this project's `package.json`; add it):

- `GenerationCost.forDuration()` — boundary values at 60s/180s
- `CreditsDomainService.deduct` — insufficient credits throws, exact ledger entry recorded, organization vs user paths
- `RetrySongGenerationUseCase` — refunds/charges the ORIGINAL cost, not a flat rate; rejects retry on a non-FAILED/CANCELLED song
- `ProcessSongGenerationUseCase` — on provider failure, Song AND AIJob both end in FAILED, credits refunded exactly once

## 6. What this pass deliberately did NOT do (honest scope boundary)

The original request asked for transformation across 16 architectural dimensions (frontend, state management, event-driven architecture across the whole system, full CI/lint standards, full test suite, every domain). This pass:

- **Did not touch the frontend** (`melody-ai/frontend/`) at all — no component restructuring, no Zustand/TanStack Query introduction. That frontend wasn't analyzed in this pass and a real refactor there needs its own dedicated read-through first, the same way this backend pass started with reading actual files rather than guessing.
- **Did not build out Billing, Organizations, Users, Analytics as separate `domains/*` modules** — only `domains/ai` exists. The existing `enterprise/services/*.service.ts` files for those areas were left as-is; they're reasonably structured already and weren't shown to have the kind of concrete, traceable bugs that justified a rewrite in this pass the way the AI domain did.
- **Did not stand up OpenTelemetry/Sentry** — no tracing SDK is in `package.json`'s dependencies currently; adding one is an infrastructure decision (which provider, what sampling rate, what budget) that deserves its own conversation, not a default I should silently bake in.
- **Did not add ESLint architecture-boundary rules** (e.g. `eslint-plugin-boundaries` to enforce "routes can't import Prisma directly") — a good next step, genuinely valuable, but not done here since it requires deciding on tooling/config the project doesn't currently have an opinion on.
- **Did not write the test suite** — see Section 5 for what to write first; no test runner config currently exists in `package.json` for this backend.

## 7. Migration safety notes

- The 4 deleted files (`services/song-generation.service.ts`, `enterprise/services/enterprise-song.service.ts`, `enterprise/queue/ai-queue.ts`, `workers/enterprise-ai-worker.ts`) were verified via full-codebase grep to have zero remaining imports before deletion.
- The Prisma schema was NOT modified — every repository method maps onto fields that already exist in `prisma/schema.prisma`. No migration needed for the domain code itself.
- Run `npm run type-check` (now meaningful again, since the Dockerfile fix that was masking it) before deploying — this refactor was written carefully against the real schema and real existing files, but wasn't run through an actual `tsc` pass in this environment (no network access to install TypeScript here). Treat it as reviewed-and-consistent, not compiler-verified.
