# Cursor prompt: expand Kwalify emotional context engine

Copy everything below the line into a **new Cursor chat** when you want to grow the emotion library further.

---

## Prompt (copy from here)

```
You are working on Kwalify — a Spotify app that builds playlists from a user's LIKED SONGS using an emotional context engine (not genre pickers).

### Non-negotiables
- Do NOT remove or replace existing playlist generation, OAuth, sync, or Spotify routes.
- Do NOT break `EmotionProfile` consumers — extend additively first.
- Build on: `backend/lib/emotion.ts`, `vibe-keywords-extended.ts`, `vibe-keywords-extended-b.ts`, `vibe-keywords-context-c.ts`, `vibe-archetypes.ts`, `emotion-destination.ts`.
- Match existing patterns: `VibeKeyword` / `ExtendedVibeKeyword`, longest-phrase-first matching, diminishing strength on many hits (`analyzeVibe` in emotion.ts).
- No external AI APIs — rule-based only.
- Minimize diff scope per PR; prefer new keyword batch files over editing 2000-line emotion.ts.

### Product vision (what we're building)
Kwalify is an AI DJ for **moments**, not genres.

User question: "How does life feel right now?" and optionally "How do I want to feel after?"

It scores tracks on:
- energy, valence, tension, calm, nostalgia
- scene: environment, timeOfDay, motionState

It builds a **journey arc** (intro → build → peak → descent), not a flat "top 25 by score" list.

Pitch: **Music for how life feels right now.**

### Current system audit (do not re-discover from scratch)

| Layer | Location | Role |
|--------|----------|------|
| Core profile | `EmotionProfile` in emotion.ts | 5 floats + 3 scene strings |
| Keyword banks | emotion.ts core + extended A/B/C | Text → profile weights |
| Scene regex | `SCENE_PATTERNS` in emotion.ts | environment / time / motion |
| Analysis | `analyzeVibe()` | keywords + scene + intensifiers + negation |
| Scoring | `scoreSong`, `refineSongScore`, `detectVibeKind` | Audio features vs profile |
| Structure | `buildPlaylistStructure`, `enforceArc`, `smoothEnergyCurve` | Arc + filters |
| Reference | `reference-playlist.ts` | Fingerprint from pasted Spotify playlist |
| Destination | `emotion-destination.ts` | "want to feel calm", "from anxious to calm" |
| Archetypes | `vibe-archetypes.ts` | 50+ reusable moment presets |

### Gaps to fill (prioritized)

**P0 — Keyword / scene coverage**
- Emotional states: grief, anger, anxiety, relief, comfort, euphoria, vulnerability, romance, determination, etc.
- Mental states: burnt out, flow state, overstimulated, mentally exhausted, creative, dreamy
- Social: date night, party, alone, missing someone, social recovery
- Weather + season: fog, thunder, snow, spring, autumn
- Activities: coding, studying, gaming, cooking, cleaning, falling asleep, waking up
- Compound moments: "driving home at 11pm mentally drained", "coffee shop rainy afternoon"

**P1 — Emotional destination**
- Parse current → desired feeling; blend profile toward destination
- Bias `enforceArc` toward `recovery` | `linear_rise` | `peak_release` | `slow_burn` based on destination

**P2 — Archetype library**
- Maintain 50+ archetypes with `journeyArc`, default vibe text, weight hints
- UI presets in index.html from archetypes (optional)

**P3 — Journey engine**
- Explicit arc types in `enforceArc` / `buildPlaylistStructure`
- Document memory layer (avoid repeat journeys) — schema proposal only unless trivial

**P4 — Future (proposal only)**
- Extra dimensions: confidence, loneliness, lyrical density preference
- User preference learning from playlist_history

### Implementation rules

1. New keywords go in `vibe-keywords-context-c.ts` or new batch `vibe-keywords-context-d.ts` — import and spread in emotion.ts `VIBE_KEYWORDS` array.
2. Longer phrases before shorter terms within each group.
3. Use `sceneHints` when a phrase implies place/time/motion.
4. Use `artistOrGenreCue: true` only for artist/genre cues (weaker weight scale).
5. Add scene patterns to `SCENE_PATTERNS` only when regex is clearer than keywords.
6. Destination phrases → `emotion-destination.ts` state map, not duplicate keyword entries.
7. After changes: run `npm run build`, sanity-check `analyzeVibe("driving home at 11pm drained want comfort")` produces low energy, rising valence, late_night, driving.

### Deliverables for each task
1. What you added (themes / count of keyword groups)
2. Example vibe strings that now parse better
3. Any new exports and where they're wired
4. What you intentionally did NOT implement yet
5. Next safe increment

### Example test vibes (must improve over time)
- driving home at 11pm mentally drained want comfort
- anxious but want to feel calm
- burnt out need motivation for gym
- coffee shop rainy afternoon reading
- 60s groovy funk soul
- heartbreak but want hopeful
- main character energy confidence cinematic
- summer sunset golden hour nostalgic
- locked in coding focus no distractions
- party with friends celebrating
```

---

## How to use this in Cursor

1. Open the Kwalify repo in Cursor.
2. Start a new Agent chat.
3. Paste the prompt block above.
4. Add a focused line at the end, e.g.  
   `Implement P0 batch D: 40 keyword groups for mental + social states. Wire into emotion.ts. Do not touch generate.ts unless needed.`

## Repo map (quick)

```
backend/lib/
  emotion.ts              # core engine — touch sparingly
  vibe-keywords-extended.ts # batch A
  vibe-keywords-extended-b.ts # batch B
  vibe-keywords-context-c.ts  # batch C (emotions, context, activities)
  vibe-archetypes.ts        # 50+ moment archetypes
  emotion-destination.ts    # current → desired feeling
  reference-playlist.ts     # Spotify reference fingerprint
```

## One-line pitch (for site copy)

**Kwalify is an AI DJ that understands emotional context and builds playlists around moments, moods, memories, environments, and how you want to feel — not just genres.**

Shorter: **Music for how life feels right now.**
