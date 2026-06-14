# Prompt Identity Preservation Audit

Date: 2026-06-14

Scope: targeted audit and fix for niche prompt identity collapse. This pass did not optimize overlap/diversity, run benchmarks, redesign V3, or edit benchmark/evaluation code.

## Prompt Under Test

Prompt: `Seeing Friends 2am - Fast Racing Techno`

Expected identity:

- hard techno
- hardgroove
- tekk / tekno
- schranz
- industrial techno
- rave / warehouse energy
- hard trance

Observed identity:

- high energy is usually understood
- broad `electronic` is sometimes understood
- techno substyle is weakly preserved
- UK garage / riddim / jungle / DnB tracks can enter
- at least one obvious rock leak was observed: `0G21yYKMZoHa30cYVi1iA8` / `Welcome To The Jungle`

## Exact Prompt Term Mappings

Before this fix:

| Prompt term | Parsed by family aliases | Survives normalization | Genre family | Retrieval constraint | Coverage |
| --- | --- | --- | --- | --- | --- |
| `techno` | yes, via `backend/core/v3/intent.ts` `GENRE_ALIASES` and `backend/lib/expanded-intent-vocabulary.ts` | yes | `electronic` | broad electronic only | partially supported |
| `hard techno` | yes, via expanded aliases only | yes | `electronic` | broad electronic only | partially supported |
| `tekk` | no | no | none | none | unsupported |
| `hardgroove` | no | no | none | none | unsupported |
| `schranz` | no | no | none | none | unsupported |
| `industrial techno` | yes, via expanded aliases only | yes | `electronic` | broad electronic only | partially supported |
| `hard trance` | no as exact term | only `trance` if present independently | `electronic` | broad electronic only | partially supported |
| `rave` | yes | yes | `electronic` and activity `party` | broad electronic + activity energy | collapsed into high-energy party/electronic |

After this fix:

| Prompt term | Parsed by family aliases | Taxonomy substyle | Genre family | Retrieval constraint |
| --- | --- | --- | --- | --- |
| `techno` | yes | `techno` | `electronic` | electronic + techno identity reserve |
| `hard techno` | yes | `hard_techno` | `electronic` | electronic + techno identity reserve |
| `tekk` | yes | `hard_techno` | `electronic` | electronic + techno identity reserve |
| `hardgroove` | yes | `hard_techno` | `electronic` | electronic + techno identity reserve |
| `schranz` | yes | `hard_techno` | `electronic` | electronic + techno identity reserve |
| `industrial techno` | yes | `hard_techno` | `electronic` | electronic + techno identity reserve |
| `hard trance` | yes | `trance` | `electronic` | electronic + techno identity reserve |
| `rave` | yes | `rave` | `electronic` | electronic + techno identity reserve |

## Retrieval Trace

For `Seeing Friends 2am Fast Racing Techno`, the candidate path is:

1. `backend/core/v3/intent.ts` `buildLockedIntent()`
   - detects `techno` as `genreFamilies: ["electronic"]`
   - detects `2am` as `late_night`
   - detects `friends` / `rave`-like language as social or party-adjacent
   - before this fix, it did not preserve `tekk`, `hardgroove`, or `schranz`

2. `backend/core/scoring-engine/scoring-pool-cap.ts` `capTracksForHybridScoring()`
   - explicit family was `electronic`
   - broad electronic candidates received a boost/reserve
   - non-electronic candidates only received a soft penalty, not a hard prefilter
   - before this fix, no techno-substyle reserve existed inside electronic

3. `backend/core/playlist-pipeline.ts` intent contract
   - `trackMatchesGenreFamilies(..., ["electronic"])` is family-level
   - `contractFitScore` can reward electronic but not specifically hard techno / tekk

4. `backend/controllers/generation.controller.ts` finalization and recovery
   - `finalTrackIsSafe()` and `finalTrackIsHardSafe()` enforced family-level electronic identity
   - activity/social/high-energy safety could still admit non-techno high-energy tracks when metadata was broad or weak

Candidate count per stage is available at runtime from `generationDiagnostics.waterfall`; this audit did not run a new benchmark or live generation, per instruction.

## Where Non-Techno Candidates Enter

Broad family collapse:

- File: `backend/core/v3/intent.ts`
- Code path: `parseGenreFamilies()` -> `GENRE_ALIASES`
- Problem: exact terms below root family become `electronic`, losing techno substyle.

Retrieval broadening:

- File: `backend/core/scoring-engine/scoring-pool-cap.ts`
- Code path: `explicitGenreFamilies()` -> `matchesExplicitFamily()`
- Problem: explicit prompt reserve was based on `electronic`, so UK garage / DnB / broad dance could compete as if they were techno.

Recovery/finalization broadening:

- File: `backend/controllers/generation.controller.ts`
- Code path: `finalizePlaylistTracks()` -> `finalTrackIsHardSafe()`
- Problem: hard-safe fill only checked family-level electronic and activity/energy safety.

Activity override:

- File: `backend/controllers/generation.controller.ts`
- Code path: `isUpbeatSocialPrompt()` and `trackIsUpbeatSocialSafe()`
- Problem: `friends`, `rave`, and high-energy language can activate social/high-energy safety, which is correct for vibe but too broad for techno identity.

## Why `Welcome To The Jungle` Could Survive

Track: `0G21yYKMZoHa30cYVi1iA8` / `Welcome To The Jungle`

Likely path:

- Retrieval reason: energetic/high-tempo fit and broad activity/social fit made it competitive if family metadata was weak or if it entered broad recovery.
- Ranking reason: high energy can align with `fast racing`, even when genre identity is wrong.
- Recovery reason: hard-safe fill used activity/energy plus family/metadata checks, but had no techno-specific identity guard.
- Final acceptance reason: there was a UK garage-specific known-non-UK-garage block, but no equivalent generic techno identity guard.

This was fixed by adding a prompt-activated techno identity guard in `finalTrackIsSafe()` and `finalTrackIsHardSafe()`.

## Ten Off-Identity Examples From Supplied Result

Fetched from Spotify oEmbed by track id/title only. These are clearly not hard techno / tekk identity even if some are adjacent club music:

| Track id | Title | Why off identity | Prior acceptance path |
| --- | --- | --- | --- |
| `0G21yYKMZoHa30cYVi1iA8` | `Welcome To The Jungle` | rock title / known rock leakage | energetic/activity recovery could survive without techno guard |
| `63wvdjsNzsdRWEQQnZViuu` | `Wasting My Time - Speed Garage` | UK garage, not techno/tekk | broad electronic family |
| `0VqSg7nsmUNJKHZYufNZFo` | `Re-Rewind (feat. Craig David)` | UK garage classic, not techno/tekk | broad electronic family |
| `1fGjIL2Ike4ypLQEQvQUc9` | `When the Bassline Drops` | bassline/garage identity | broad electronic family |
| `77MlbRsFh9nlS3G3OPh7HA` | `Street Fighter Riddim` | riddim/bassline identity | broad electronic family |
| `6EHgu7EYDUg39JcqWYF86q` | `Jungle` | jungle/DnB identity | broad electronic family |
| `3tzQMZh2OUOB2CXsGFyZwC` | `Riddim is a Killa` | riddim identity | broad electronic family |
| `3RHlWhrnYAX97Zn5q3VAdX` | `Super Sharp Shooter` | jungle/DnB identity | broad electronic family |
| `13Mgkz3Rk8t1XsMZ6JyIrG` | `Finesse Riddim` | riddim identity | broad electronic family |
| `14m7nJ1BKHZt0xoDpqkA3l` | `Your Mum Loves Garage` | garage identity | broad electronic family |
| `4tvY4XRup8JVcAeF0VXDLm` | `Forget-Me-Not (DnB Remix)` | DnB identity | broad electronic family |

## Genre Family Coverage

| Identity | Before | After |
| --- | --- | --- |
| `techno` | supported, collapsed to `electronic` | supported with `techno` subgenre |
| `hard techno` | partially supported, collapsed to `electronic` | supported with `hard_techno` subgenre |
| `hardgroove` | unsupported | supported as `hard_techno` microstyle |
| `schranz` | unsupported | supported as `hard_techno` microstyle |
| `tekk` | unsupported | supported as `hard_techno` microstyle |
| `industrial techno` | partially supported, collapsed to `electronic` | supported as `hard_techno` microstyle |
| `hard trance` | partially supported through `trance` only | supported as `trance` microstyle |
| `rave` | supported as broad electronic/activity | supported as `rave` subgenre and techno identity signal |

## Prompt Identity Score

Proposed metric:

`promptIdentityRetention = identityEvidenceTracks / finalTracks`

For electronic substyle prompts, `identityEvidenceTracks` means tracks that are:

- classified as compatible subgenre (`techno`, `hard_techno`, `rave`, `trance`), or
- have Spotify/album/local text evidence for the requested identity, or
- pass high-energy electronic shape when metadata is sparse.

Estimated scores:

| Prompt | Before estimate | After expected estimate | Notes |
| --- | ---: | ---: | --- |
| `Fast Racing Techno` | 0.35-0.55 | 0.70-0.85 | largest gain from techno alias coverage + final guard |
| `Fast Driving Backroad Racing Tekk` | 0.65-0.80 | 0.75-0.90 | already better because `tekk` result pool had stronger overlap with compatible tracks; now parsed explicitly |
| `Gym 2000s Pop Punk` | 0.75-0.90 | unchanged | not touched by this pass |
| `Party 70s Disco` | 0.70-0.85 | unchanged | not touched by this pass |

## Root Causes Ranked

### 1. Unsupported substyle vocabulary

- Impact: highest.
- File: `backend/lib/expanded-intent-vocabulary.ts`
- Code path: `EXPANDED_GENRE_ALIASES`
- Problem: `tekk`, `hardgroove`, `schranz`, and `hard trance` were missing.
- Fix: added those aliases under `electronic`.

### 2. Taxonomy lacked techno substyle classes

- Impact: high.
- File: `backend/lib/genre-taxonomy-data.ts`
- Code path: `GENRE_FAMILIES -> electronic.subgenres`
- Problem: hard techno / tekk / schranz / rave had no classification target, so downstream guards had no evidence to preserve.
- Fix: added `hard_techno`, expanded `techno`, added `rave`, and added `hard trance` to `trance`.

### 3. Retrieval reserved broad electronic, not techno identity

- Impact: high.
- File: `backend/core/scoring-engine/scoring-pool-cap.ts`
- Code path: `capTracksForHybridScoring()`
- Problem: explicit genre reserve preserved `electronic`, allowing garage/DnB/broad dance to occupy the cap.
- Fix: added prompt-activated techno identity boost and reserve before broad electronic fill.

### 4. Finalization accepted energetic electronic/fallback tracks without substyle guard

- Impact: high.
- File: `backend/controllers/generation.controller.ts`
- Code path: `finalTrackIsSafe()` and `finalTrackIsHardSafe()`
- Problem: techno prompts had no equivalent to the existing UK garage safety guard.
- Fix: added prompt-activated `trackMatchesTechnoIdentity()` guard.

### 5. Activity/social energy can overpower genre identity

- Impact: medium.
- File: `backend/controllers/generation.controller.ts`
- Code path: `isUpbeatSocialPrompt()` / `trackIsUpbeatSocialSafe()`
- Problem: `friends`, `2am`, `fast`, and `racing` correctly push high energy but can make generic high-energy tracks look acceptable.
- Fix: no broad activity redesign; the new techno final guard prevents activity safety from overriding explicit techno identity.

## Implemented Fixes

- Added missing techno/tekk aliases in `backend/lib/expanded-intent-vocabulary.ts`.
- Added matching V3 intent aliases in `backend/core/v3/intent.ts`.
- Added hard-techno/rave/trance taxonomy coverage in `backend/lib/genre-taxonomy-data.ts`.
- Added techno identity retrieval boost/reserve in `backend/core/scoring-engine/scoring-pool-cap.ts`.
- Added techno identity final/recovery guard in `backend/controllers/generation.controller.ts`.

## Validation

Required:

- `npm run typecheck`
- `npm run build`

Benchmarks intentionally not run.
