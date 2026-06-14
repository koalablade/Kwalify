# Universal Intent Identity Verification Report

Date: 2026-06-14

Scope: verification only. No ranking, coherence, genre, mood, activity, atmosphere, era, recovery, UI, benchmark, or architecture code changes were made for this audit. Product-code inspection was read-only; this report is the only file updated.

## Summary

The universal identity layer is wired into result-producing code paths and can materially change ordering in retrieval, finalization, and recovery. However, the current diagnostics do not expose a true before/after candidate list, V3 does not report identity contribution as a separate score, and some prompts still collapse at the structured genre level into a broad parent genre. In those cases, the new identity layer depends on free-text identity terms such as `liquid`, `rollers`, `drum`, `bass`, `warehouse`, or `black` rather than a strong structured subgenre field.

Overall result: WARNING, not FAIL.

- PASS: Identity terms are derived and used in retrieval ordering.
- PASS: Mood, activity, and energy are now preserved into V3 locked intent instead of being dropped at handoff.
- PASS: Finalization and recovery order candidates with `intentCoherenceScore()`.
- WARNING: No first-class diagnostics show top candidates before identity adjustment versus after identity adjustment.
- WARNING: V3 ranking has no explicit `identityContribution` diagnostic.
- WARNING: D&B/rollers and liquid D&B still collapse to weak or broad structured genre identity.
- WARNING: Atmosphere is mostly carried as identity text / scene vectors, not as a typed `atmosphere` dimension.

## Code Paths Audited

Files involved:

- `backend/core/playlist-pipeline.ts`
- `backend/controllers/generation.controller.ts`
- `backend/core/v3/intent.ts`
- `backend/lib/expanded-intent-vocabulary.ts`

Identity influence points:

- Retrieval: `extractIdentityTerms()`, `identityTermScore()`, `promptOrderingBias()`, `buildRetrievalPools()`
- V3 handoff: `buildV3LockedIntent()`
- Finalization: `universalIdentityTerms()`, `intentCoherenceScore()`, `candidateFinalizationScore()`, `coherentRankedCandidates`
- Recovery: `recoveryIdentityTerms`, `broadEnergyCandidates`

## Prompt Identity Trace

These values were traced from the compiled `buildLockedIntent()` output and the implemented identity-term extraction logic.

### D&B rollers for night driving

- Genre: none in `LockedIntent.genreFamilies`
- Subgenre / identity terms: `rollers`
- Mood: none
- Atmosphere: `night`
- Activity: `driving`
- Era: none
- Scene: car / evening / driving

Result: WARNING.

The identity layer can influence ordering through `rollers`, `night`, and `driving`, but the structured genre parser does not recognize `D&B` here. This means genre identity can collapse before retrieval unless candidate metadata happens to contain the text terms.

### Industrial techno warehouse rave

- Genre: `electronic`
- Subgenre / identity terms: `industrial techno`, `techno`, `warehouse`, `rave`
- Mood: `energised`
- Atmosphere: `warehouse`
- Activity: `party`
- Era: none
- Scene: electronic anchor with techno satellite

Result: PASS with caveat.

The broad genre is still only `electronic`, but the identity terms are strong and specific. Tracks with metadata containing industrial techno / techno / warehouse / rave should be boosted; generic electronic without those terms should be downranked.

### 2000s pop punk gym workout

- Genre: `pop`, `rock`
- Subgenre / identity terms: `pop punk`, `punk`
- Mood: `energised`
- Activity: `gym`
- Era: `2000-2009`
- Energy: `high`

Result: PASS.

This is the strongest signature in the audit. It has genre, subgenre, mood, activity, era, and energy. The layer should materially punish wrong-era tracks, non-pop-punk metadata, and non-gym energy.

### Deep focus coding

- Genre: none
- Subgenre / identity terms: `focus`, `coding`, `deep`
- Mood: none
- Activity: `focus`
- Era: none
- Energy: `low`

Result: PASS with caveat.

Activity and energy are strong. Genre is intentionally absent, so the system will preserve focus/coding via audio/activity proxies and text identity rather than genre. This should block aggressive gym-like drift better than before.

### Euphoric trance sunset drive

- Genre: `electronic`
- Subgenre / identity terms: `trance`
- Mood: `warm`, `euphoric`
- Atmosphere: `sunset`
- Activity: `driving`
- Era: none
- Energy: `medium`

Result: PASS with caveat.

The signature is broad-parent `electronic` plus specific `trance` and mood/activity terms. Generic electronic can still enter if it scores well, but it should be downranked when it lacks trance/euphoric/sunset/driving identity.

### Dark atmospheric black metal

- Genre: `metal`
- Subgenre / identity terms: `black`, `atmospheric`
- Mood: `dark`
- Activity: none
- Era: none

Result: PASS with caveat.

The identity terms are exactly the scene specificity the new layer is meant to preserve. However, `black metal` is not represented as a structured subgenre field in `LockedIntent`, so final strength depends on track taxonomy/metadata containing `black`, `atmospheric`, or compatible metal subgenre data.

### Liquid drum and bass rainstorm

- Genre: `electronic`
- Subgenre / identity terms: `liquid`, `drum`, `bass`
- Atmosphere: `rainstorm`
- Mood: none
- Activity: none
- Era: none

Result: WARNING.

Like D&B rollers, this still collapses structurally to `electronic`. The identity layer should help if candidate metadata includes liquid / drum / bass / dnb terms, but there is no strong structured `dnb` or `liquid` intent dimension.

## Retrieval Stage

Audited code:

- `buildRetrievalPools()`
- `promptOrderingBias()`
- `identityTermScore()`
- `earlyDiversityRank()`

Finding: PASS for influence, WARNING for observability.

Before identity adjustment, retrieval base ordering is:

```text
(contractFitScore * 0.20) + track.score - feedbackPenalty - recentTrackPenalty
```

After identity adjustment, ordering includes:

```text
promptOrderingBias(...)
= fitLift + activityLift + moodLift + identityTermScore + deterministic prompt variance
```

Materiality:

- `identityTermScore()` can add up to about `+0.16`.
- It can subtract `-0.12` for specific-identity misses.
- Activity/mood lifts add more small prompt-specific movement.
- This is large enough to reorder close candidates near top-k boundaries.

Weakness:

The system does not persist diagnostics for “top candidates before identity adjustment” and “top candidates after identity adjustment.” Current `retrievalPoolDiagnostics.top20` is after identity ordering only. So the layer is definitely in the ordering formula, but actual per-request before/after top candidates are not currently observable.

## V3 Ranking Stage

Audited code:

- `buildV3LockedIntent()`
- V3 candidate and sampler handoff

Finding: PASS for dimension preservation, WARNING for separate contribution diagnostics.

The previous leak where `mood`, `activity`, and `energy` were passed as `undefined` into V3 has been closed. V3 now receives:

- `mood: unifiedIntentContext.lockedIntent.mood`
- `activity: unifiedIntentContext.lockedIntent.activity`
- `energy: unifiedIntentContext.lockedIntent.energy ?? energyIntentFromProfile(profile)`

Materiality:

This should affect V3 constraint matching, lane scoring, and sampler decisions where V3 uses locked intent.

Weakness:

V3 diagnostics still do not expose a separate `identityContribution` or `identityFit` field. Coherence exists through scene, activity, energy, and constraints, but the new universal identity score is not surfaced as a V3-native diagnostic.

## Finalization Stage

Audited code:

- `intentCoherenceScore()`
- `candidateFinalizationScore()`
- `coherentRankedCandidates`
- `finalTrackIsSafe()`
- `finalTrackIsHardSafe()`

Finding: PASS.

Finalization now uses identity score in candidate ordering. Tracks can be boosted for:

- explicit genre evidence
- matching identity terms
- matching era
- matching mood
- matching activity / energy
- matching preferred cohesion family

Tracks can be penalized for:

- wrong explicit family
- missing specific identity terms
- known era mismatch
- mood mismatch
- activity mismatch
- multiple simultaneous identity violations

Rejected for identity violations:

- Hard rejections still occur through `finalTrackIsSafe()` and `finalTrackIsHardSafe()` for hard constraints, explicit genre/era mismatch, and known activity safety failures.
- Soft identity violations are not hard rejected; they are downranked and counted through `intentCoherenceDownranked`.

Accepted despite weak identity:

- Weak-identity tracks can still be accepted if the pool is sparse, the track passes hard safety, and fill pressure requires completion.
- This is intentional soft-constraint behavior, but it means not every weak identity candidate is blocked.

## Recovery Stage

Audited code:

- `recoverLowComplexityPlaylist()`
- `broadEnergyCandidates`
- `recoveryIdentityTerms`

Finding: PASS.

Broad recovery candidate ordering now includes:

```text
broadEnergyRecoveryScore(...)
intentCoherenceScore(...) * 0.8
```

Materiality:

Recovery ordering should now prefer tracks that match the original genre/mood/activity/era/signature rather than generic high-energy or high-score tracks.

Weakness:

There is no recovery-specific diagnostic listing candidates before and after identity scoring. The impact is present in code, but not directly observable from existing reports without adding instrumentation.

## Direct Answers

Is the identity layer materially changing candidate ordering?

Yes in code. Retrieval and finalization now include identity terms and coherence in their sorting scores. The score deltas are large enough to reorder close candidates. Actual before/after candidate lists are not currently captured.

Is it materially changing final playlists?

Likely yes, especially where candidates are close in score or where finalization performs top-up. The strongest evidence is that finalization now sorts through `coherentRankedCandidates` and recovery adds `intentCoherenceScore()`. However, this audit did not run live generation, so final playlist deltas were not measured empirically.

Which identity dimensions are strongest?

- Era, when explicitly parsed.
- Activity, especially gym/focus/driving/party.
- Root genre family, when parsed.
- Mood terms like dark/euphoric/energised.
- Specific identity terms when candidate metadata contains matching taxonomy/subgenre/Spotify text.

Which dimensions are still weak?

- D&B / rollers when abbreviated as `D&B`.
- Liquid D&B when only parsed as broad `electronic`.
- Atmosphere, because it is mostly text/scene-vector based rather than typed.
- Subgenre identity when candidate metadata does not include the exact subgenre terms.

Are there prompts where genre identity still collapses into a broad parent genre?

Yes.

- `D&B rollers for night driving`: structured genre is missing entirely.
- `Liquid drum and bass rainstorm`: structured genre is only `electronic`.
- `Industrial techno warehouse rave`: structured genre is only `electronic`, though identity terms are strong.
- `Euphoric trance sunset drive`: structured genre is only `electronic`, though `trance` survives as an identity term.

## Conclusion

The universal identity layer is actually wired into result-producing ordering paths and should influence results. The largest remaining risk is not whether the layer runs; it does. The risk is observability and structured specificity: several culturally specific prompts still rely on generic text identity terms after the parser collapses them to broad parent genres.

Recommended next step, after this verification-only task: add diagnostics before making further ranking changes, specifically `identityTerms`, `identityScoreBeforeAfter`, top candidate before/after snapshots, and final `identityCoverage` by dimension.
