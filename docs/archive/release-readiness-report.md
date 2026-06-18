# Release Readiness Report

Date: 2026-06-14

Scope: bounded stabilization pass for retrieval stability, generation performance, prompt fidelity, failure experience, and production safety. No V3 rewrite, ranking redesign, recovery rewrite, benchmark framework, or speculative scoring change was made.

## Summary

No remaining BLOCKER issue was confirmed in this pass.

The main release risks were narrow and operational:

- HIGH: recent subgenre tightening could collapse candidate pools if exact metadata evidence was sparse.
- MEDIUM: normal generations could rebuild the same retrieval pools twice when no session/recent diversity penalty was active.
- MEDIUM: expired generation sessions were only removed opportunistically, leaving stale entries until a status lookup or map-cap eviction.
- LOW: hard-timeout copy was retry-only and did not clearly tell users how to recover.

## Findings

### HIGH - Retrieval Starvation From Strict Subgenre Evidence

Root cause: recent retrieval tightening prioritized structured subgenre matches, but sparse Spotify/library metadata meant prompts such as `D&B rollers for night driving`, `Industrial techno warehouse rave`, and `Fast driving backroad tekk` could have too few exact subgenre matches after intent contract filtering. Without a ladder, strict filtering could reduce retrieval, post-filter, recovery, or finalization pools toward zero even when broader valid family candidates existed.

File: `backend/core/playlist-pipeline.ts`

Fix: confirmed and retained the structured fallback ladder in `structuredRetrievalScope()` and the pre-V3 guard:

- strict primary subgenre when evidence is healthy
- related structured subgenre when primary evidence is too small
- family-level pool when subgenre evidence is sparse
- final guard fallback through family-safe/intent-scoped candidates instead of empty pools

Expected impact: prompts with niche electronic and D&B wording should preserve identity when evidence exists, but degrade to valid broader candidates instead of returning zero tracks or timing out.

Status: fixed before this report and re-audited in this pass.

### MEDIUM - Duplicate Retrieval Pool Build On Unpenalized Requests

Root cause: `runPlaylistPipeline()` always built an unpenalized retrieval pool to estimate viable pool size, then built retrieval again even when no recent-track penalty and no session artist memory were active. In those cases the second pass is identical work.

File: `backend/core/playlist-pipeline.ts`

Fix: reuse `unpenalizedRetrieval` when `upstreamRecentTrackPenalty` and `effectiveSessionArtistMemory` are both absent.

Expected impact: lowers CPU time for common first-run/no-history generations without changing scoring, ranking, V3 behavior, recovery behavior, or final output.

Status: fixed in this pass.

### MEDIUM - Expired Generate Sessions Could Accumulate

Root cause: expired or terminal sessions were deleted during status reads and same-user reacquisition, but `evictIfNeeded()` did not prune inactive sessions before enforcing the map cap. A low-traffic deployment with abandoned requests could keep stale sessions longer than needed.

File: `backend/lib/generate-session.ts`

Fix: prune inactive sessions inside `evictIfNeeded()` before size-cap eviction.

Expected impact: reduces stale session memory pressure and lowers the risk of stuck-session residue without changing active request behavior.

Status: fixed in this pass.

### LOW - Timeout Failure Copy Needed A Clearer Next Action

Root cause: the hard-timeout empty-library failure response only said to try again. That was technically safe, but not release-quality guidance for users whose prompt is too narrow or library is under-synced.

Files:

- `backend/controllers/generation.controller.ts`
- `frontend/public/pages/app.js`

Fix: backend timeout copy now explains that generation took too long before a safe playlist could be built and suggests a broader prompt or Spotify sync. Frontend maps HTTP 504 to friendly retry guidance.

Expected impact: fewer confusing timeout failures and no technical error dumps shown to users.

Status: fixed in this pass.

## Prompt Fidelity Validation

Representative prompt categories were reviewed against the current intent-contract and structured-subgenre flow:

- Genres: D&B, techno, trance, house, hip hop, metal, rock, pop punk
- Activities: gym, driving, focus, party, chill
- Eras: 70s, 80s, 90s, 2000s, 2010s

No broad speculative ranking change was made. The remaining fidelity risk is metadata sparsity for niche subgenres, which is addressed by graceful fallback rather than hard failure. Existing structured identity scoring and intent contract checks remain in place.

## Failure Experience

Verified failure surfaces:

- generation timeout: friendly 504 copy with retry path
- retrieval starvation: graceful broadening via structured retrieval fallback
- Spotify failures: existing Spotify unavailable/fallback paths remain intact
- sync failures: existing sync route status and stale sync cleanup remain intact
- auth failures: frontend maps 401 to reconnect Spotify guidance

No silent failure path was intentionally introduced.

## Production Safety

Verified:

- startup/env safety remains unchanged
- request timeout fallback remains unchanged
- generation sessions now prune inactive entries during eviction
- status polling remains no-store and monotonic progress remains unchanged
- cache behavior remains conservative; no cache TTL changes were made

## Validation

Completed:

- `npm run typecheck` passed
- `npm run build` passed
