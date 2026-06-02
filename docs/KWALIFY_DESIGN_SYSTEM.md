# Kwalify — Master Design System (source of truth)

**Highest priority:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) — overrides this doc where they differ. Check North Star before implementation.

**Hierarchy:** [DOCUMENT_HIERARCHY.md](./DOCUMENT_HIERARCHY.md)

## Product in one line

Kwalify turns a human **moment** into a **playlist** + a **single emotional visual** that reflects how it feels.

It is **not** a cinematic engine, an AI system, or a scene simulator. It is a **one-input emotional mirror**.

---

## Core principles (non-negotiable)

### 1. One input → one output moment

```
User types moment → click → result (feels instant)
```

No stages. No system awareness.

### 2. One emotion per result

Each result has exactly:

- 1 dominant emotion
- 1 dominant visual idea
- 1 playlist mood direction

Never blend emotional states.

### 3. No system visibility

The user must never see engines, states, processing steps, or loading as “experience layers.”

Only: **input**, **button**, **result**.

### 4. Visuals are interpretation, not world-building

We do not simulate environments. We use **emotional visual metaphors**.

---

## Visual language — Emotional Editorial Worlds

See North Star for dream objects and Phase 1 (`petrol_station_2am`). Summary:

| Rule | Guidance |
|------|----------|
| **Composition** | Single subject; centred or slightly off-centre; generous negative space; no clutter |
| **Lighting** | One dominant source; soft falloff; cinematic but simple |
| **Colour** | One dominant tone; one accent max; desaturated backgrounds preferred |
| **Materials** | Soft matte / clay / editorial illustration feel — no hyperrealism, no noisy detail |
| **Motion** | Almost none; subtle fade only; no continuous animation systems |

---

## Ten moment visual entities

Each maps to **one** dominant emotion. Scene selection uses weighted keyword matching (+3 direct, +2 emotion, +1 context); **one winner only**, no blending.

| ID | Dominant emotion | Visual idea |
|----|------------------|-------------|
| `night_drive` | Detached reflection | Dark motorway ribbon, distant sodium lights, dashboard glow |
| `petrol_station_2am` | Liminal stillness | Fluorescent canopy, empty forecourt, isolated car |
| `sunset_coast` | Emotional release | Wide horizon, warm gradient sky, soft water reflection |
| `urban_midnight_walk` | Isolation in density | Empty street, lit windows, wet pavement |
| `train_journey` | Introspection / transition | Window reflections, motion blur outside, soft interior light |
| `summer_afternoon_drift` | Nostalgia / lightness | Warm suburban glow, soft overexposure, light haze |
| `rainy_city_interior` | Safe isolation | Interior lamp warmth, rain on glass, blurred city outside |
| `memory_road` | Reflective nostalgia | Long empty road, fading light, soft horizon depth |
| `club_exit_dawn` | Exhaustion → clarity | Blue-hour street, faint sunrise, quiet urban stillness |
| `open_highway_daylight` | Freedom | Bright sky, centred road symmetry, minimal clutter |

Implementation: `getSceneFromInput()` in `artifacts/api-server/public/index.html` (frontend mapping only). Playlist generation stays on the server (`POST /api/generate`) — do not change scoring backend when aligning UI.

Assets: `artifacts/api-server/public/cinema/{scene_id}/still.jpg` (+ optional loop video for three scenes). Style brief: [../artifacts/api-server/public/cinema/VISUAL_STYLE.md](../artifacts/api-server/public/cinema/VISUAL_STYLE.md).

---

## UX structure (final product)

### Home

- Brand
- Single input
- Optional suggestion chips (3–5)
- **Make playlist →**

### Loading (minimal)

- Button text: **Making playlist…**
- Slight dim on input/chips
- Scene may fade in softly
- **No** overlays, **no** “thinking” UI

### Result

- Full-screen scene (one layer)
- User input (subtle, lowercase)
- Emotional playlist title (not the Spotify name)
- **Play on Spotify**
- **Try another moment**

Internal states only: `home` → `loading` → `result`.

---

## Hard removal rules

Must **not** exist in the moment product:

- Cinematic engine / perception state machines
- Camera drift, zoom, pan choreography
- Layered atmosphere (vignette stacks, grain stacks, world physics, blur fog)
- Multi-stage transitions (thinking / locked / reveal / credits)
- “AI explanation” panels on the default result path
- System language (engine, processing, scene generation, perception)

Prefer **deletion** over abstraction. If the system is noticeable, it is over-designed.

---

## Success criteria

The user feels: *“This understood my moment instantly.”*

Not: *“This is an interesting system.”*

---

## Build order

1. **[MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md)** — single-screen loop (structure first)
2. **[UNIFIED_VISUAL_SYSTEM.md](./UNIFIED_VISUAL_SYSTEM.md)** — enforced rules (scenes + UI + motion)
3. **[VISUAL_SYSTEM_GUIDE.md](./VISUAL_SYSTEM_GUIDE.md)** + **[SCENE_IMAGE_PROMPTS.md](./SCENE_IMAGE_PROMPTS.md)** — one brand across 10 scene characters

## Related docs

- [SIMPLE_MOMENT_PRODUCT.md](./SIMPLE_MOMENT_PRODUCT.md) — locked 3-state flow
- [PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md](./PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md) — product analogy + agent prompt
- [REFACTOR_PET_PLAYLIST_UI.md](./REFACTOR_PET_PLAYLIST_UI.md) — frontend cleanup checklist
