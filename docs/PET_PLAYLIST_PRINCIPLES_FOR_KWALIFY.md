# Why Spotify Pet Playlist works — and how Kwalify should copy the *structure*

This is not “design polish.” It is a deliberate **emotional product architecture**. Use this doc as analysis + a **paste-ready Cursor prompt** (see [Cursor prompt](#cursor-prompt-paste-into-agent) at the bottom).

---

## Part 1 — Breakdown

### Psychological (why it *feels* good)

| Mechanism | Pet Playlist | What the user feels |
|-----------|--------------|---------------------|
| **Identity mirror** | “Your dog is *this* type” | “This is *about me* (or my pet)” — not “I’m using a tool” |
| **Decision removal** | Few choices, obvious path | No “what do I do here?” paralysis |
| **Single dominant read** | One personality label | One clear emotional answer, not a mood spreadsheet |
| **Instant recognition** | Result matches the label fast | “Oh — it got me” (dopamine) |
| **Reward = output** | Playlist is the prize | Satisfaction comes from **music**, not from admiring the UI |
| **No AI frame** | No “processing”, “model”, “engine” | Feels human and playful, not technical |

**Core insight:** Pet Playlist succeeds because it **removes friction between feeling → personalised output**. Kwalify should do the same for **human moments**, not pets.

---

### UX (why it *works* as a flow)

| Principle | How Pet Playlist does it | Kwalify translation |
|-----------|--------------------------|---------------------|
| **One concept per screen** | Pet type → (maybe one question) → result | “What moment are you in?” → result |
| **One input → one output** | No tree, no settings maze | Moment text → playlist (+ one visual) |
| **Ultra-low cognitive load** | Understood in &lt;10 seconds | No manual, no “modes” on the happy path |
| **Fast emotional payoff** | Input → transformation → reward quickly | Short loading; then playlist + echo of their words |
| **Playful tone** | Toy-like, light copy | Friendly, human — not “cinematic engine” or “vibe analysis” |
| **Loading as mood** | Wait feels part of the bit | “Making playlist…” — not “analysing emotion layers” |

**Anti-patterns for Kwalify:** multi-stage cinema UX, exposed state machines, insights panels on the main path, “Kwalify heard” essays before Spotify.

---

### Visual (why it *reads* instantly)

Pet Playlist visual language is **friendly system design**, not film grading:

| Layer | Pet Playlist | Kwalify (adapted) |
|-------|--------------|-------------------|
| **Layout** | Soft space, rounded cards, gentle shadow | One column, one card for result, calm contrast |
| **Character** | Stylised pets — readable in 0.2s | **One** grounded still/loop per moment — readable mood, not “renderer output” |
| **Colour** | Calm, approachable palette | Subtle grade on photo stills; no neon soup or stacked vignettes |
| **Motion** | Light, purposeful | Static or very subtle loop only |
| **Noise** | No competing layers | No blur on UI, no atmospheric stack, no competing animations |

**Important:** Pet’s *illustrations* are stylised cartoons. Kwalify should use **cinematic realism** for scenes (your library constitution) but the **same job**: one dominant emotional read in one glance — like a personality card, not like a VFX demo.

---

### What Kwalify was drifting toward (and must stop)

| Drift | Pet Playlist opposite |
|-------|------------------------|
| Architecture explains emotion | Emotion is **shown** via playlist + one line |
| Cinematic / perception engines | One visual, no “system” language |
| Many UI states (thinking, locked, reveal) | User sees: type → wait → result |
| Visual richness &gt; playlist | Playlist accuracy + “got me” moment first |

---

## Part 2 — Locked model for Kwalify

```
INPUT  = messy human moment (natural language)
OUTPUT = Spotify playlist (primary) + one visual (secondary)
SUCCESS = “I didn’t expect it to understand that”
```

**Do not expose:** scene engines, AI processing, multi-mood blending, roadmap feature sprawl on the main path.

**Do keep (backend, invisible):** `POST /api/generate`, scoring, `getSceneFromInput()` → one dominant scene still.

---

## Cursor prompt (paste into Agent)

Copy everything inside the block below into Cursor when reshaping the Moment UI or reviewing PRs.

---

```
We are refactoring Kwalify to follow the STRUCTURE of Spotify Pet Playlist — adapted for human emotional moments, not pets. We are NOT copying Spotify branding or pet illustrations.

REFERENCE ANALYSIS (why Pet Playlist works):
- Personality mirror: user feels described, not instructed
- One concept, one flow, one outcome — no exploration tree
- Playful, human tone — never "AI", "engine", or "processing layers"
- One job per screen; fast input → transformation → reward (playlist)
- Visuals: simple, emotionally readable in under a second — no visual noise
- Dopamine is the personalised playlist, not the chrome

KWALIFY TRANSLATION:
- "What kind of moment are you in?" instead of "what kind of pet"
- moment → ONE dominant emotional read → playlist + ONE supporting still/loop
- Feels like: "this is for THIS exact weird moment I'm in"

---

# CORE PRODUCT RULE

Kwalify is a ONE-FLOW emotional generator:

User types a moment → system interprets ONE dominant emotion → returns playlist (primary) + one visual (secondary) → user feels understood within ~10 seconds.

Do not expose multi-step system thinking, cinema states, or technical explanations on the happy path.

---

# HARD CONSTRAINTS (DO NOT CHANGE WITHOUT EXPLICIT ASK)

- Do NOT change POST /api/generate or backend scoring contracts
- Do NOT reintroduce multi-stage user-visible states (compose/thinking/locked/reveal, perception engine, listen overlays, cinematic credits timing)
- Do NOT expand scene-engine complexity in the UI
- Scene pick: keep getSceneFromInput() — always ONE dominant scene, never blend moods in copy or UI

---

# EMULATE (PET PLAYLIST SUCCESS FACTORS)

1. Extreme simplicity — one input screen, one button, one result screen
2. Emotional identity mapping — moment text echoed back as headline; playlist feels "for this"
3. Playful tone — "Make playlist", friendly placeholders, no AI/system jargon on main path
4. Immediate reward loop — short loading (~1s perceived min), then playlist + Open in Spotify
5. Visual readability — one background still; static frame; no layered atmosphere, UI blur, or competing motion

---

# REMOVE / AVOID IN UX

- Multi-layer scene engines, vignette/grain stacks, camera drift/zoom/pan as "product"
- "Finding your moment", "vibe analysis", emotion bars, scene chips on the default result view
- Long staged reveals, uppercase cinematic title cards, blurred ambient album art as hero
- Copy that sounds like a platform ("scene engine", "moment understanding pipeline")

---

# UX STRUCTURE (USER-VISIBLE)

1. Home: single input ("Late night overthinking, motorway at 2am…") + whisper examples + optional Tune collapsed
2. Action: "Make playlist" (button state: "Making playlist…")
3. Result: user's moment as title + one subline + Spotify CTA + Reshuffle + "← again"
   Background: one scene still (still-first from /cinema/{id}/still.jpg)

Internal states only: home | loading | result — user must not feel a state machine.

---

# VISUAL DIRECTION

- Clean, soft UI (rounded button, space, readable type) over grounded photographic still
- ONE dominant visual per moment — reinforcement only, not the product
- No gradient/blob fallbacks as final art; flat emergency plate only if asset missing
- 16:9 still, object-fit cover, scene locked (no productized camera motion)

---

# EMOTIONAL INTERPRETATION (COPY + SCENE ONLY)

Parse time, motion, emotion, context internally but present ONE dominant read to the user.
Never show blended moods or multiple scene chips on the default result.

---

# OUTPUT PRIORITY

1. Spotify playlist emotional accuracy
2. Feeling of being understood (echo moment + accurate tracks)
3. Visual reinforcement
4. UI polish

---

# SUCCESS METRIC

User says: "I didn't expect it to understand that" → working correctly.

---

# IMPLEMENTATION CHECKLIST (index.html Moment UI)

- [ ] Single-flow states: moment-home, moment-loading, moment-result only
- [ ] No fullscreen listen overlay; loading = button + slight input dim
- [ ] showMomentResult: immediate after min loader; headline = user's words (sentence case)
- [ ] Hide insights / emotion bars / "Kwalify heard" on moment result by default
- [ ] Scene updates on type (debounced) and on generate; crossfade only, no cinema choreography
- [ ] README/docs: SIMPLE_MOMENT_PRODUCT.md is source of truth for UX scope

Read docs/SIMPLE_MOMENT_PRODUCT.md and docs/PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md before editing.
When in doubt: remove friction between emotion → playlist, not add architecture.
```

---

## Related docs

- [SIMPLE_MOMENT_PRODUCT.md](./SIMPLE_MOMENT_PRODUCT.md) — locked flow and internal states
- [CINEMATIC_SCENE_LIBRARY.md](./CINEMATIC_SCENE_LIBRARY.md) — asset rules (still-first, not UI complexity)
- [PRODUCT_PROMISE.md](./PRODUCT_PROMISE.md) — engine promise (backend; keep invisible on happy path)
