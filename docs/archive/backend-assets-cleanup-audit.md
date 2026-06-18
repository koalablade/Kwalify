# Backend And Assets Cleanup Audit

Generated: 2026-06-14

Scope audited:
- `backend/`
- frontend/static asset surface under `frontend/public/`
- asset-like and generated local artifacts, including ignored `reports/` output

Rules followed:
- No files deleted during this audit pass.
- No runtime, scoring, retrieval, generation, UI, or benchmark behavior changed.
- Findings are conservative: active imports, package scripts, served static files, and compatibility exports are not marked safe for immediate removal.

## Summary

`attached_assets/` exists locally and contains untracked PNG image exports with timestamped/generated-looking names. No code or docs references `attached_assets/` or the sampled filenames. The active frontend asset surface is separate and small: three HTML shells, three page scripts, and one CSS file under `frontend/public/`. Those files are all referenced by the Express static server or by the HTML shells, so there is no high-confidence `frontend/public` asset deletion.

The backend is large, but most large-looking areas are active. V2-named modules, debug/stability modules, playlist evaluation helpers, Spotify audit helpers, semantic scene systems, and genre intelligence modules are still imported by live generation, scoring, routes, or package scripts.

The safest backend deletion already identified is limited to the two unimported diagnostic helper modules that were removed in the prior cleanup: `backend/lib/genre-leak-detector.ts` and `backend/lib/scene-fidelity.ts`. Beyond that, the next backend cleanup should be symbol-level pruning, not whole-folder deletion.

## Safe To Remove

These are safe only under the listed condition.

| Path | Reason | Confidence | Safe now? |
|---|---|---:|---:|
| `backend/lib/genre-leak-detector.ts` | Unimported diagnostic helper. Runtime reference search found no active imports; only older memory/audit notes mention it. Already deleted in the working tree. | HIGH | YES |
| `backend/lib/scene-fidelity.ts` | Unimported diagnostic helper. Runtime reference search found no active imports; only older memory/audit notes mention it. Already deleted in the working tree. | HIGH | YES |
| `backend/dist/` | Generated TypeScript output. `npm run build` regenerates it; `npm start` depends on it after build. It can also contain stale emitted files after source modules are removed. | HIGH | YES, after rebuild |
| `attached_assets/*.png` | Untracked local image/design exports with no code/docs references. The folder currently contains 36 PNGs, including repeated timestamp groups. | HIGH | YES, if not needed as design history |
| `Liked Songs - Skiley Export.csv` | Ignored local/privacy-sensitive export artifact. No runtime references found. | HIGH | YES |
| Ignored historical report output under `reports/playlist-evaluation/` | Generated benchmark/evaluation output, not runtime input. Many old named runs were already removed locally. | HIGH | YES, if historical evidence is not needed |

## Review Manually

These are cleanup candidates, but should not be deleted without a product or compatibility decision.

| Path / Area | Why review | Evidence | Confidence |
|---|---|---|---:|
| `reports/playlist-evaluation/latest/` | Default output for the evaluation harness. It can be deleted before a fresh run, but it is the active default report location. | `package.json` runs `playlist-evaluation-harness`; harness defaults to `reports/playlist-evaluation/latest`. | HIGH |
| `reports/playlist-evaluation/current-run/` and `current-validation/` | Generated/ignored, but names imply active manual validation aliases. | No Git tracking; physical directories still exist. | MEDIUM |
| `reports/playlist-evaluation/full-20-79dde94-hard-safe-top-up/` | Historical report referenced by root audit docs. | `overlap-root-cause-audit.md` and `diversity-activation-audit.md` cite it. | MEDIUM |
| `reports/playlist-evaluation/production-validation-12/` | Generated validation output that may still be useful as reliability evidence. | Still physically present and ignored. | MEDIUM |
| `backend/zod/api.ts` | Generated schema file with mostly unused response/query exports. Keep `GeneratePlaylistBody`; review unused exports separately. | Reference search found active backend use of request body schema, but not several response/query exports. | MEDIUM |
| `backend/controllers/playlist-crud.controller.ts` `POST /playlists/:id/feedback` | Writes playlist-level feedback that appears unused by frontend. This is a feature decision, not a dead-code delete. | Frontend calls track feedback endpoints, not playlist feedback. Docs also note `playlist_feedback` is write-only. | MEDIUM |
| Deprecated compatibility aliases | `beginGenerateSession`, `computeTemporalPhase`, `CanonicalScene`, `OntologyLevel`, `OntologyNode`, and `buildGenreGraph` appear unused by exact search. Remove only if there are no external/debug script consumers. | Definitions are present with `@deprecated`; active code uses newer names. | MEDIUM |
| Strict TypeScript unused locals/imports | A stricter audit found unused locals/imports across active backend files. These should be pruned carefully per file. | `tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` reports symbol-level issues. | HIGH |
| Frontend duplicated helpers | `esc`, API wrappers, theme helpers, icon/date helpers are repeated across page scripts. | `docs/frontend-architecture.md` and reference search confirm duplication. | HIGH |

## Keep

These areas looked large, old, or debug-like, but are active.

| Path / Area | Why keep | Confidence |
|---|---|---:|
| `frontend/public/index.html`, `gallery.html`, `playlist.html` | Served as the three static frontend shells. | HIGH |
| `frontend/public/pages/app.js`, `gallery.js`, `playlist.js` | Referenced by the HTML shells and contain active UI/API behavior. | HIGH |
| `frontend/public/styles/base.css` | Referenced by all three HTML shells. | HIGH |
| `backend/core/v3/**` | Active V3 pipeline, intent, sampler, interleaver, diversity, and scoring logic. | HIGH |
| `backend/core/v2/era-model.ts` and `triple-signal-scorer.ts` | V2 namespace but still imported by V3/scoring code. | HIGH |
| `backend/core/debug/**` | Debug/stability modules are imported by active scoring/genre forecast code. | HIGH |
| `backend/core/output.ts` | Thin barrel, but imported by generation/orchestration helpers. | HIGH |
| `backend/scripts/*.ts` | Referenced by `package.json` scripts: evaluation, quality, stress, deploy smoke. | HIGH |
| `backend/lib/spotify-api-audit.ts` | Used by `backend/lib/spotify.ts` and generation diagnostics. | HIGH |
| `backend/lib/reference-playlist.ts`, `music-life-chapters.ts`, `library-archaeology.ts`, `scoring-explanation.ts`, `request-generation-orchestrator.ts` | Imported by live generation/scoring paths. | HIGH |
| `backend/lib/semantic-interpreter.ts`, `semantic-scene-engine.ts`, scene and genre intelligence modules | Imported by moment/scene/genre systems; not safe to remove at folder level. | HIGH |

## Strict Unused-Symbol Findings

These are not whole-file delete recommendations. They are the safest next code cleanup pass because they target unused variables/imports inside active files.

Files with strict unused findings include:
- `backend/controllers/generation.controller.ts`
- `backend/core/playlist-pipeline.ts`
- `backend/core/engine/recommendation-engine.ts`
- `backend/core/scoring-engine/gravity-surprise.ts`
- `backend/core/v2/triple-signal-scorer.ts`
- `backend/core/v3/adaptive-lane-generator.ts`
- `backend/core/v3/cluster-candidate-engine.ts`
- `backend/core/v3/intent.ts`
- `backend/core/v3/interleaver.ts`
- `backend/core/v3/v3-pipeline.ts`
- `backend/core/v3/v3-sampler.ts`
- `backend/lib/ecosystem-lock.ts`
- `backend/lib/emotion-destination.ts`
- `backend/lib/emotion.ts`
- `backend/lib/feedback-memory.ts`
- `backend/lib/forgotten-favourites.ts`
- `backend/lib/genre-audit.ts`
- `backend/lib/genre-clustering.ts`
- `backend/lib/genre-detection-pipeline.ts`
- `backend/lib/genre-intelligence-stack.ts`
- `backend/lib/genre-ontology.ts`
- `backend/lib/genre-profile-cache.ts`
- `backend/lib/genre-signature.ts`
- `backend/lib/genre-similarity-engine.ts`
- `backend/lib/genre-taxonomy.ts`
- `backend/lib/hybrid-scoring.ts`
- `backend/lib/intent-parser.ts`
- `backend/lib/music-life-chapters.ts`
- `backend/lib/scene-intelligence.ts`
- `backend/lib/semantic-interpreter.ts`
- `backend/lib/semantic-scene-engine.ts`
- `backend/lib/vibe-genre-bias.ts`
- `backend/shared/embeddings/dynamic-genre-graph.ts`
- `backend/shared/embeddings/track-embeddings.ts`

## Recommended Cleanup Order

1. Decide whether to delete or archive the remaining ignored report directories: `latest`, `current-run`, `current-validation`, `full-20-79dde94-hard-safe-top-up`, and `production-validation-12`.
2. Delete or archive unreferenced local exports in `attached_assets/` and `Liked Songs - Skiley Export.csv` if they are not needed outside the app.
3. Do a symbol-level unused cleanup using the strict TypeScript output above, one small batch at a time.
4. Review deprecated compatibility aliases and remove only if no external/debug consumers exist.
5. Decide whether playlist-level feedback is still planned; if not, remove endpoint, table init, schema, and docs together in one migration-aware change.
6. Optionally refactor duplicated frontend helpers into a tiny shared ES module. This reduces code size but is not a deletion-only cleanup.

