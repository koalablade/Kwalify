# Kwalify: moments, not moods

## Product thesis

**Location ≠ emotion.** A petrol station at 2am (liminal, isolated) and at 10am (routine, practical) are different *experiences* with different targets.

Kwalify should feel like an **AI DJ that understands life**, not a playlist app with sliders.

## Architecture (current)

```
User text
    │
    ├─ Experience scene library (~50+ scenes, growing to 200+)
    │     e.g. petrol_2am, airport_sunrise, late_train_home
    │     → direct energy/valence/tension/nostalgia/calm + journeyArc
    │
    ├─ Layered context (emotion-scene-layers.ts)
    │     time · place · atmosphere · motion (independent)
    │
    ├─ Keyword banks (emotion + extended A/B/C + places/times)
    │     per-layer caps · longest phrase wins
    │
    ├─ Life situations (in scene library: breakup, burnout, starting over…)
    │
    ├─ Intent / destination (emotion-destination.ts)
    │     anxious → calm · tired → motivated
    │
    └─ Archetypes (vibe-archetypes.ts) — legacy presets
          ↓
    EmotionProfile → score liked songs → journey arc → playlist
```

## Files

| File | Role |
|------|------|
| `scene-library.ts` | Human experience encyclopedia |
| `scene-intelligence.ts` | Match + blend scenes into profile |
| `emotion-scene-layers.ts` | Independent time/place/motion |
| `emotion-destination.ts` | Current → desired journey |
| `emotion.ts` | `analyzeVibe()` orchestration |

## Cursor prompt for next increments

Copy into Agent chat:

```
Expand Kwalify scene intelligence — do NOT add UI preset chips.

1. Add 50 new entries to scene-library.ts (compound phrases only).
   Categories: university, holiday, road trip solo, hospital waiting,
   wedding morning, breakup drive, first day new job.

2. Each scene must include: terms[], energy, valence, tension,
   nostalgia, calm, optional journeyArc, qualities[], lifeSituation?

3. Never attach timeOfDay to a place-only regex — time comes from
   clock phrases or scene entries.

4. Wire mixed emotions: if text matches contradiction patterns AND
   a scene, preserve tension+valence spread (don't collapse to one mood).

5. Playlist roles: extend enforceArc with intro/build/peak/resolve
   segments using journeyArc from scene or destination.

6. Anti-repetition: when playlist_history has same sceneId twice,
   reduce score for tracks used in those playlists (light penalty).

Read docs/EMOTION_SCENE_VISION.md and docs/EMOTION_LAYERS.md first.
```

## Roadmap

| Phase | Status |
|-------|--------|
| Layered time/place | ✅ |
| Scene library + blend | ✅ (~50 scenes) |
| Intent / destination | ✅ partial |
| 200+ scenes | 🔲 grow library |
| Mixed emotion preservation | 🔲 |
| Playlist storytelling roles | 🔲 partial (arcs) |
| Memory layer weighting in score | 🔲 |
| Social context in scoring | 🔲 tags only |
| Season modifiers | 🔲 tags only |
| Anti-repetition by scene | 🔲 |

## One-line pitch

**Music for how life feels right now** — built from situations, journeys, and memories, not genre tags.
