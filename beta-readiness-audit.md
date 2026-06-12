# Beta Readiness Audit

Generated: 2026-06-12

## Executive Summary

Kwalify is close to beta readiness after reverting the risky overlap/diversity tuning. The current release priority is reliability and observability, not further quality tuning.

Estimated beta readiness score: **78/100**

Primary reason it is not higher: `/api/generate` now has better structured timeout/fallback behavior and progress state, but the slowest production paths still need live latency samples from normal user requests before public beta. The previous overlap benchmark attempts showed request-time risk when scoring complexity was increased, so no additional scoring complexity should ship before latency visibility is reviewed.

## Release Blockers

1. **Live latency attribution was incomplete before this audit.**
   - Added timing diagnostics for retrieval, candidate generation, V3 scoring, sampler, repair, finalization, and total request time.
   - Added `stagesOver30s` in `generationDiagnostics.timingMs`.

2. **Deployment health checks depended on an unbounded database check.**
   - Hardened `/api/healthz` and `/api/readyz` with a 3s DB check timeout and structured JSON error payloads.
   - Mounted health and eval ping routes before session middleware so deployment checks do not depend on the database-backed session store.

3. **Pre-library `/api/generate` work still needs operational observation.**
   - The route has structured errors and hard timeout/fallback once generation context is populated.
   - Remaining risk: if an early DB/library query or platform connection stalls before full generation context is available, fallback quality context may be limited.

## High-Risk Code Paths

- `backend/controllers/generation.controller.ts`
  - Very large request orchestrator.
  - Highest-risk sections: library load, genre profile build, genre stack build, request-layer generation, finalization/recovery, Spotify side effects.

- `backend/core/playlist-pipeline.ts`
  - Builds retrieval pools, V3 candidate pools, runs multiple V3 candidate attempts, then repairs/enforces final playlist.
  - Risk: repeated candidate attempts can consume most of the request budget on large libraries or strict prompts.

- `backend/core/v3/v3-pipeline.ts`
  - Per-lane scoring, cluster building, sampler, and interleaving.
  - Risk: lane-level work multiplies by number of lanes and candidates.

- `backend/core/v3/v3-sampler.ts`
  - Selection hot path.
  - Recent complex diversity changes were reverted because they created beta-readiness latency risk.

- `backend/routes/health.ts`
  - Startup/deployment health.
  - Now bounded with a short database timeout.

- `backend/app.ts`
  - Route/middleware ordering.
  - Health and eval ping are now mounted before session middleware to keep deploy checks responsive during session-store contention.

## Slowest Stages To Watch

These are now surfaced in response diagnostics:

- `generationDiagnostics.timingMs.preV3`
- `generationDiagnostics.timingMs.playlistPipeline`
- `generationDiagnostics.timingMs.retrieval`
- `generationDiagnostics.timingMs.candidateGeneration`
- `generationDiagnostics.timingMs.v3Scoring`
- `generationDiagnostics.timingMs.sampler`
- `generationDiagnostics.timingMs.repair`
- `generationDiagnostics.timingMs.finalization`
- `generationDiagnostics.timingMs.stagesOver30s`

Expected likely slow paths based on code structure:

- Genre profile / genre stack on cache miss.
- Playlist pipeline candidate attempts.
- V3 per-lane scoring on large candidate pools.
- Final repair/finalization for strict era or genre prompts.

## Reliability Status

- Structured success response: present.
- Structured validation/auth/rate-limit errors: present.
- Structured stale/cancelled response: present.
- Structured fatal error response: present.
- Timeout fallback response: present once generation context exists.
- Empty playlist guards: present through V3 fallback, fallback pipeline, recovery, and final `EMPTY_PLAYLIST` structured error.
- Progress polling: present via `/api/generate/status`.
- Deployment health endpoints: present and now bounded.

## UX Status

- Progress phases are available: `starting`, `loading_library`, `building_profile`, `scoring`, `composing`, `spotify`, `saving`, `done`, `error`.
- Stage details are available and updated through generation.
- Partial tracks can be surfaced during generation.
- Confidence, recovery, fallback, and artist diversity diagnostics are returned in generation responses.

## Fixes Applied In This Audit

- Added V3 timing diagnostics:
  - retrieval
  - lane generation
  - scoring
  - candidate generation
  - sampler
  - interleaver
  - total
  - slowest stage

- Added playlist-pipeline timing diagnostics:
  - scoring
  - retrieval
  - candidate generation
  - V3 scoring/sampling
  - repair
  - finalization
  - total

- Added controller-level timing summary:
  - total request time
  - pre-V3 timing
  - playlist pipeline time
  - V3 stage timings
  - repair/finalization time
  - stages over 30s

- Hardened health endpoints:
  - `/api/healthz`
  - `/api/readyz`
  - Both now return within a bounded DB health timeout.

- Hardened deployment verification routes:
  - `/api/eval/ping`
  - `/api/healthz`
  - `/api/readyz`
  - These now bypass session middleware before the main API router.

## Exact Remaining Work Before Public Testing

1. Verify deployment reports the latest commit via `/api/eval/ping`.
2. Verify `/api/healthz` and `/api/readyz` return structured JSON quickly.
3. Run a small manual `/api/generate` readiness request, not a benchmark, and inspect:
   - `generationDiagnostics.timingMs`
   - `generationDiagnostics.timingMs.stagesOver30s`
   - `playlistConfidence`
   - `tracks.length`
   - no `GENERATION_CANCELLED`
   - no empty successful playlist
4. If any stage exceeds 30s, optimize that stage before beta.
5. Freeze scoring/diversity changes until reliability is verified from live timing diagnostics.
6. Add frontend display polish for slow generation:
   - show current stage detail
   - show partial tracks when available
   - show recovery/fallback explanation when used
7. Prepare beta tester known-issues note:
   - generation may take longer on very large libraries or very strict prompts
   - retry guidance should be shown for timeout or strict-evidence errors

## Recommendation

Ship beta only after the latest deployment passes health checks and one manual generation readiness request returns structured timing diagnostics with no hanging, no empty successful playlist, and no cancelled session.

Do not resume overlap tuning until latency data from the new diagnostics shows the pipeline has enough headroom.
