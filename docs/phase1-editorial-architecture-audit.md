# Phase 1 — Editorial Architecture Audit

**Date:** 2026-06-27  
**Deploy:** `b6f109b`  
**Evidence:** 500-playlist live fault benchmark (`koalablade`, live-auth), codebase audit

---

## Executive summary

Kwalify’s successful generations mostly run `full_pipeline`, but playlists are still **assembled from pre-ranked track pools**, not **optimized as combinations**. The sampler code runs in-process, yet **benchmark telemetry reports 0% sampler participation** due to a trace bug — masking the real issue. Multi-candidate generation produces **meaningfully different tournament winners** (not 100% `strict_intent`), but candidates differ mainly by **retrieval slice + seed**, not editorial interpretation. Winner selection uses pairwise dimensions, yet **seeds the tournament from scalar pre-scores dominated by gate-derived would-save (54%)**. The #1 production failure remains **intent pool collapse (24.6%)**, driven by **editorial world ↔ archetype mismatch** — not sampler quality.

---

## 1. Where do playlists become “top N ranked tracks”?

| Stage | Behavior | “Top N” effect |
|-------|----------|----------------|
| **Retrieval** | Layered pools (core/anchor/adjacent/bridge/discovery) | Tracks arrive pre-scored by hybrid retrieval |
| **Ranked intent selection** | `selectRankedCandidatesForSampler` keeps only `maxPool ≈ minPool × 1.15` (~21–29 tracks from hundreds) | **Hard cap** — sampler never sees 300-track combinatorial space |
| **Post-filter sort** | `v3-pipeline.ts` re-sorts survivors by intent score before lanes | Lane input order = score order |
| **Lane scoring** | `scoreLane` ranks within lane | Clusters built from score-sorted pool |
| **Sampler recovery** | `topNSelection` on failure | Deterministic top-N — pure ranking |
| **Interleaver** | Reorders sampled picks; does not change membership | Flow only |
| **Gate polish/stabiliser** | Swaps offending tracks | Local repair, not re-curation |

**Verdict:** Playlists are **ranked-track selections with stochastic tie-breaking**, not combination-optimized sets. The sampler adds diversity caps within a **pre-truncated elite pool** (~25 tracks), not within retrieve-300 → explore-50-candidates space.

**Benchmark:** On 316 HTTP 200 runs, `avgFillRatio` > 100% suggests over-delivery on shorter requests; editorial shape still feels algorithmic because **membership is score-elite, order is interleaver-smoothed**.

---

## 2. How often does the sampler alter composition?

### Telemetry (500-run benchmark)

| Signal | Value |
|--------|-------|
| `samplerExecuted` (benchmark heuristic) | **0 / 309 successes (0%)** |
| `samplerCount > 0` in API response | **0 / 316 HTTP 200** |
| `full_pipeline` execution path | **301 / 500 (60%)** |

### Code reality

- `selectFromClusters` **is invoked** per lane in `runV3Pipeline` (`v3-pipeline.ts` ~1626–1647).
- `after_sampler` trace is populated from `sceneClusterFunnelCounts.sampler_pool`, which is updated **only when `sceneWorldContext.sceneClusters` exists** — counting dominant-cluster tracks in the **input pool**, not sampler **output count** (`v3-pipeline.ts` ~1652–1657).

**Verdict:** Sampler likely runs on most full-pipeline successes, but **observability is broken** — we cannot measure sampler contribution from production responses. When recovery paths fire (`topNSelection`, `minimalSelectedTracks`), sampler is bypassed for output.

**Estimated true sampler participation:** 60–85% of HTTP 200 full_pipeline runs (code path), **0% measurable** (telemetry).

---

## 3. Candidate diversity between multi-candidate attempts

### Benchmark (252 HTTP 200 with pairwise tournament)

| Tournament winner label | Wins | Share |
|-------------------------|-----:|------:|
| `strict_intent` | 71 | 28.2% |
| `adjacent_bridge` | 53 | 21.0% |
| `discovery_energy_arc` | 47 | 18.7% |
| `wide_lane_blend` | 44 | 17.5% |
| `balanced_core_mix` | 37 | 14.7% |

- Avg comparisons per tournament: **3.96**
- Avg candidates: **~5**

**Verdict:** Winner selection is **not monopolized by strict_intent** — candidates do produce different winners ~72% of the time. However, candidates differ by **retrieval pool composition** (which lanes are included), not by **editorial interpretation** (discovery arc vs safe vs adventurous transitions). Same locked intent, same gate, same would-save evaluator → **high track overlap expected** between candidates.

**Why candidates may still feel identical to users:** Shared intent vector + tiny pre-sampler pool → all candidates draw from the same elite track set; interleaver + gate converge outputs.

---

## 4. Does winner selection meaningfully choose between candidates?

### Tournament mechanics

1. Pre-sort pool by `scalarTotal` (descending), take top 5
2. Champion = highest scalar
3. Sequential pairwise bouts vs challengers
4. Pairwise dimensions: human_saveable, opening, shape, cringe, prompt_alignment
5. **Tie → scalarTotal wins** (`pairwise-playlist-judge.ts` ~171–180)

### Scalar pre-score composition (`playlist-pipeline.ts` ~4911–4916)

| Component | Weight |
|-----------|-------:|
| `quality.overall` | 26% |
| `wouldISaveCandidateScore` (gate-derived) | **54%** |
| Fill bonus | up to 12% |
| Gate pass bonus | 6% |

**Verdict:** Tournament **can** overturn scalar champion (72% non-strict_intent wins), but **seeding and tie-breaks favor gate-aligned scalar scores**. Pairwise `human_saveable` dimension duplicates gate pass — circular. `prompt_alignment` blends `qualityOverall` + `humanPatternScore` but pattern score is **not** in scalar pre-score.

**Benchmark anomaly:** 20 runs are `humanSaveable` with `wouldISave.combinedScore < 0.5` — gate pass decoupled from would-save wrapper thresholds.

---

## 5. Stage contribution to final quality (quantified)

| Stage | Contribution | Evidence |
|-------|--------------|----------|
| **Intent collapse / ranked selection** | **Blocking** — 123/500 fail here | 24.6% `fault_intent_pool_collapse`; 55/123 have `postFilterCount=0` |
| **Editorial world ↔ archetype routing** | **Blocking** — top 422 strings | `incompatible_with_archetype` (26+ runs) |
| **Retrieval pool breadth** | **High** — determines candidate diversity ceiling | Pool cap ~25 post-intent |
| **Multi-candidate + pairwise** | **Medium** — changes winner 72% | Tournament winner distribution |
| **Sampler** | **Unknown (telemetry broken)**; code says bounded entropy within elite pool | 0% reported |
| **Interleaver** | **Low–medium** — flow/arc ordering | Does not change membership |
| **Human-saveability gate** | **High for pass/fail** — 60.2% pass rate | `curatorScore ≈ 1.0` on passes — may not discriminate quality |
| **Would-I-Save evaluator** | **Low independent signal** — mostly re-exports gate | `combinedScore` ignores locally computed `humanPatternScore` |

### Category performance (500-run)

| Worst | Success rate |
|-------|-------------|
| genre_specific | 10% |
| golden_regression | 15% |
| stress_live | 28% |
| focus | 46% |

| Best | Success rate |
|------|-------------|
| mixed | 89% |
| discovery | 84% |
| study | 84% |

**Genre/editorial prompts fail because intent collapse + world/archetype conflict fire before sampler can help.**

---

## Root causes (priority order)

1. **Pre-sampler pool truncated to ~25 tracks** — sampler cannot explore combinations
2. **Sampler observability broken** — cannot tune what we cannot measure
3. **Candidates = retrieval slices, not editorial interpretations**
4. **Winner selection seeded by gate-circular scalar score**
5. **Would-I-Save / gate feedback loop** — pattern score double-used, no human preference data
6. **Editorial worlds too coarse** — `indie_balanced_default` vs specific archetypes → 409/422
7. **No playlist-level learned patterns** — handcoded priors, empty corpus

---

## Recommended architectural shifts (Phases 2–7)

Aligned with mission constraints (no new layers, no gate relaxation):

| Phase | Action |
|-------|--------|
| 2 | Expand ranked pool cap to ~300; sampler optimizes combination from broad pool |
| 3 | Candidates = editorial interpretations (safe / discovery / arc / transitions / balanced) |
| 4 | Pairwise: add flow/transition/discovery/ending dimensions; seed tournament by playlist shape not scalar |
| 5 | Fit pattern priors from playlist corpus; scaffold playlist-genome dataset |
| 6 | Decouple would-save combined score from pure gate re-export |
| 7 | Fix `sampler_pool` trace to reflect sampler output count |

---

## Files audited

| Area | Path |
|------|------|
| Pipeline / multi-candidate | `backend/core/playlist-pipeline.ts` |
| V3 orchestration | `backend/core/v3/v3-pipeline.ts` |
| Sampler | `backend/core/v3/v3-sampler.ts` |
| Interleaver | `backend/core/v3/interleaver.ts` |
| Intent ranked selection | `backend/core/editorial/intent-collapse-layer.ts` |
| Pairwise judge | `backend/core/editorial/pairwise-playlist-judge.ts` |
| Would-I-Save | `backend/core/editorial/would-i-save-evaluator.ts` |
| Human patterns | `backend/core/editorial/human-playlist-patterns.ts` |
| Gate | `backend/core/human-saveability-gate.ts` |
| Trace | `backend/core/observability/playlist-execution-trace.ts` |
| Benchmark | `reports/live-fault-diagnosis-500.json` |

---

*Phase 1 complete. Implementation proceeds in Phases 2–7 per mission brief.*
