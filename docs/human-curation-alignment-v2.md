# Kwalify — Human Curation Alignment v2

## Mission

Do **not** optimise for benchmark scores, audio-feature targets, or passing individual prompts.

Optimise for one outcome only:

> **Generate playlists that real people would actually save, return to repeatedly, and believe were curated by an experienced human rather than an algorithm.**

Every decision should improve long-term listening satisfaction, not just first impressions.

---

## Human Success Criteria

### The Human Test

> Would an experienced music fan proudly send this playlist to a friend?

### The Save Test

> Would the average Spotify user press "Save" after listening?

Not: is every individual song relevant? A playlist with individually relevant songs can still fail if it lacks identity.

### The Replay Test

> Would someone genuinely replay this playlist next week?

Replayability matters more than novelty.

### The Editorial Test

> Could this realistically appear as an official Spotify editorial playlist?

If it feels machine assembled rather than intentionally curated, it fails.

---

## Core Philosophy

Humans curate using musical worlds. They do **not** think in energy 0.72 / danceability 0.81.

They think: **"These songs belong together."**

Optimise for belonging.

---

## Playlist Identity

Every playlist should have one dominant identity. Avoid drifting between unrelated worlds unless explicitly requested.

Prioritise: production style, instrumentation, vocal character, era, cultural scene, emotional temperature, pacing, audience overlap — more than identical energy values.

---

## Integrity Rules

- **Era integrity** — Never leak unrelated eras (70s disco ≠ 70s rock; 90s grunge ≠ 2000s pop punk).
- **Genre integrity** — Genres are musical cultures, not keywords (disco ≠ 1970s music; UK Garage ≠ Electronic).
- **No seasonal leakage** — Christmas / holiday / Halloween / Valentine / Easter never appear unless explicitly requested. Negations (`no christmas`, `non christmas`) are hard suppresses. Wanted Christmas with empty supply must refuse, not invent pop fillers.
- **Scene integrity** — Human moments are unique (rave comedown ≠ rave; coding sprint ≠ deep focus ≠ gym).
- **Artist diversity** — Avoid shuffle-artist-radio unless artist-specific.
- **Never force completion** — Prefer honest partial or refuse with explanation over padded incoherence.

---

## Retrieval Priorities

1. Scene understanding
2. Musical world
3. Emotional consistency
4. Genre identity
5. Artist neighbourhood
6. Audio features (supporting evidence only)

---

## Human Quality Gate

Before returning any playlist, ask:

> Would I personally save this playlist and happily replay it in a month's time?

If not: continue improving, return an honest partial, or explain why a high-quality playlist cannot be produced.

Never optimise for returning *something*. Optimise for returning something worth keeping.

Executable gate: `backend/core/editorial/human-quality-gate.ts` (`pass` | `honest_partial` | `refuse`).
