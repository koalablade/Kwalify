# Beta Final Punchlist

Date: 2026-06-13

Scope: bounded pre-beta stabilization sweep only. This pass did not intentionally redesign playlist generation, rerun benchmarks, or change scoring, V3 ranking, diversity systems, recovery logic, prompt parsing, or benchmark logic.

## Summary

- BLOCKER: none found in this sweep.
- HIGH: none found in this sweep.
- MEDIUM: 1 fixed.
- LOW: 4 noted, 2 fixed or already guarded.

## Items

### MEDIUM - Noisy backend timing logs

- Status: Fixed.
- Area: Logging.
- Files:
  - `backend/lib/genre-profile-cache.ts`
  - `backend/lib/genre-intelligence-stack.ts`
  - `backend/lib/genre-detection-pipeline.ts`
- Risk: `console.info` timing logs bypass the central Pino logger, ignore `LOG_LEVEL`, and can spam production stdout during generation.
- Fix: Routed these timing messages through `logger.debug(...)` so production stays quiet by default while debug timing remains available when `LOG_LEVEL=debug`.

### LOW - Generated benchmark/report artifacts

- Status: No runtime fix needed.
- Area: Cleanup opportunities.
- Files/directories:
  - `reports/playlist-evaluation/`
  - `reports/`
- Risk: Benchmark outputs can be large and noisy if accidentally committed.
- Current guard: `.gitignore` already ignores `reports/`, and `git ls-files` shows generated `reports/` outputs are not tracked.
- Recommendation: Keep generated report artifacts local/ignored. Do not delete tonight unless disk space becomes a problem.

### LOW - Root beta audit reports

- Status: No runtime fix needed.
- Area: Dead code / obsolete reports.
- Files:
  - `beta-readiness-audit.md`
  - `beta-readiness-report.md`
  - `beta-final-audit.md`
  - `beta-user-journey-report.md`
- Risk: These docs are stale context and can distract reviewers, but they do not ship runtime code or affect deployment.
- Recommendation: Keep through closed beta as traceability. Archive or remove after beta stabilization if desired.

### LOW - Environment and startup validation

- Status: Already guarded.
- Area: Deployment safety.
- Files:
  - `backend/lib/env.ts`
  - `backend/server.ts`
  - `backend/app.ts`
- Risk checked: missing required env vars, startup DB hangs, readiness false positives.
- Current guard: `validateEnv()` requires `DATABASE_URL`, `SESSION_SECRET`, and valid `PORT`; Spotify config degrades to disabled feature mode when incomplete; startup DB/session/schema checks are bounded by timeouts; readiness is separate from liveness.
- Fix: none needed.

### LOW - Frontend stuck-state and error handling

- Status: Already guarded.
- Area: User-facing reliability.
- Files:
  - `frontend/public/pages/app.js`
  - `frontend/public/pages/gallery.js`
  - `frontend/public/pages/playlist.js`
- Risk checked: stuck generate button, missing fetch timeouts, private-mode `localStorage` crashes, failed delete/sync/generate responses.
- Current guard: API calls use `AbortController` timeouts; generate resets state in `finally`; sync/delete/generation failures produce user-facing messages; theme storage is wrapped in `try/catch`.
- Fix: none needed in this sweep.

### LOW - Existing uncommitted era/cache cleanup

- Status: Present before this stabilization sweep; not expanded into generation redesign.
- Area: Cleanup / deployment safety.
- Files:
  - `backend/lib/era-evidence.ts`
  - `backend/lib/genre-profile-cache.ts`
- Risk: Existing local changes should be reviewed as part of the final diff before any release commit.
- Current guard: typecheck/build validation covers the current tree.
- Recommendation: Commit only if the release owner wants these carried into tonight's beta build.

## Validation Plan

Required by task:

- `npm run typecheck`
- `npm run build`

No benchmarks should be run from this punchlist.
