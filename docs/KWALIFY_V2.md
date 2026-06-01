# Kwalify V2 — Emotional Intelligence Overhaul

## Philosophy

**Moments, not moods.** Kwalify understands situations, journeys, memory, and social context — then sequences a playlist like a DJ, not a keyword matcher.

## Shipped

| Capability | Module |
|------------|--------|
| **Forgotten Favourites Engine** (modes + rediscovery score) | `forgotten-favourites.ts` |
| **Library signals** (liked date, last surfaced, frequency) | `library-signals.ts` |
| **Music Life Chapters** (year bursts + vibe match) | `music-life-chapters.ts` |
| **Library Archaeology** (concept detection from text) | `library-archaeology.ts` |
| **Human Surprise** (comfort/discovery/nostalgia/novelty) | `human-surprise.ts` |
| **Emotional Discovery** (pool bias + wildcards) | `emotional-discovery.ts` |
| Anti-repetition 100→75→50→15% | `playlist-freshness.ts` |
| `GET /api/library/chapters` | `routes/library.ts` |
| Scene / prompt / narrative layers | see earlier modules |

### Rediscovery modes (auto-detected from vibe)

| Mode | Trigger phrases |
|------|-----------------|
| `forgotten_favourites` | forgotten, archaeology, music you forgot |
| `deep_cuts` | deep cuts, rare tracks |
| `old_obsessions` | played to death, used to love |
| `hidden_gems` | hidden gems, hidden corners |
| `nostalgic_rediscovery` | take me back, lost summer |

### Archaeology concepts

- Music You Forgot You Loved
- Your Lost Summer Soundtrack
- Played To Death Then Abandoned
- Forgotten Midnight Favourites
- Hidden Corners Of Your Library

### Cooldown curve (tracks)

| Recent appearances | Score multiplier |
|--------------------|------------------|
| 0 | 100% |
| 1 | 75% |
| 2 | 50% |
| 3 | 30% |
| 4+ | 15% |

Never hard-banned.

### Rediscovery

- Liked years ago + not in recent playlists → score bonus
- Surfaces “forgotten” favourites from full sync’d library (all `liked_songs` rows scored equally)

### API fields (generate response)

- `libraryIntelligence` — rediscoveryMode, archaeology, chapter, surpriseMix
- `tracks[].rediscoveryScore` — 0–1 forgotten-favourite potential
- `promptConfidence`, `explanation`, `tracks[].narrativeRole`

### Example prompts

```
Music you forgot you loved — late night, reflective
Take me back to 2019
Hidden corners of my library, rainy indie phase
Road trip with friends but surface deep cuts I abandoned
```

### Chapters endpoint

`GET /api/library/chapters` — inferred timeline clusters (no private event names).

## Roadmap (your spec)

| # | Feature | Status |
|---|---------|--------|
| 1 | Anti-repetition (full) | Partial — cooldowns + clone penalty |
| 2 | Deep library exploration | Partial — rediscovery bonus; audit confirms all liked songs scored |
| 3 | 500+ scene library | ~80 scenes — grow `scene-library-extended.ts` |
| 4 | Emotional journey engine | Partial — destination + arcs |
| 5 | Playlist narrative engine | Partial — roles + `buildPlaylistStructure` + `enforceArc` |
| 6 | Emotional complexity | Partial — `multi-emotion.ts` |
| 7 | Memory intelligence | Partial — `memoryWeight` on scenes + scoring nudge |
| 8 | Seasonal intelligence | Partial — season on scenes + keywords |
| 9 | Social context engine | Partial — scene tags; scoring hooks next |
| 10 | 1000+ vibe encyclopedia | Planned — JSON import pipeline |
| 11 | Prompt confidence UI | API only — optional frontend hint |
| 12 | Multi-layer parsing | Done — `emotion-scene-layers.ts` |
| 13 | Anti-clone protection | Partial |
| 14 | Explainability | API `explanation` |

## Grow the scene library

Add entries to `scene-library-extended.ts` using `SceneEntry` in `scene-types.ts`. Each needs unique `id`, specific `terms[]`, and emotional targets.

## Cursor prompt (next batch)

```
Add 40 scenes to scene-library-extended.ts (compound phrases only).
Categories: work, travel, relationships, seasons, contradictions.
Wire socialContext into refineSongScore when scene.socialContext is set.
Do not add UI preset chips.
Read docs/KWALIFY_V2.md first.
```
