# Kwalify — Unified visual system (enforced)

**Highest priority:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) — check before implementation; overrides this doc on conflict.

**One emotional brand world** across 10 scenes + moment UI. Not a cinematic engine.

**Product:** moment → playlist · **Wireframe:** [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) · **Prompts:** [SCENE_IMAGE_PROMPTS.md](./SCENE_IMAGE_PROMPTS.md)

---

## Core principle

Every scene is **a single emotional moment frozen in time**.

Not: a location · a cinematic shot · a generated artwork · a stylistic experiment.

**Shift:** from “cinematic music engine” → **emotional mirror that outputs music**.

---

## Global visual rules (non-negotiable)

| # | Rule | Requirement |
|---|------|-------------|
| 1 | **Single subject** | One emotional subject per frame; no competing focal points |
| 2 | **Soft realism** | Photographic, softened, emotionally graded; memory-of-a-place; no HDR / hyper-AI detail |
| 3 | **Lighting** | One lighting condition per scene; no mixed types |
| 4 | **Colour** | 1 dominant + 1 supporting + neutral shadows; no rainbow grading |
| 5 | **Atmosphere** | rain OR fog OR haze OR dry air — never combined |
| 6 | **Camera** | Static wide or locked perspective; no drift / zoom rigs |

---

## Ten scene characters (not places)

| ID | Emotion | Lighting | Composition |
|----|---------|----------|-------------|
| `night_drive` | detached calm | sodium + dashboard glow | centered highway perspective |
| `petrol_station_2am` | liminal stillness | harsh fluorescent white | empty wide negative space |
| `sunset_coast` | release | warm golden horizon | horizon-dominant |
| `urban_midnight_walk` | isolation in presence | neon reflections | corridor street geometry |
| `train_journey` | transition | interior tungsten vs exterior dark | window dual-layer |
| `summer_afternoon_drift` | nostalgic ease | soft overexposed daylight | suburban openness |
| `rainy_city_interior` | safe isolation | warm interior vs cold exterior | inside-out framing |
| `memory_road` | reflection | fading golden light | vanishing-point road |
| `club_exit_dawn` | exhaustion → clarity | blue-hour dawn mix | empty street symmetry |
| `open_highway_daylight` | freedom | bright clear daylight | centered symmetry |

Full generation prompts: [scenes.manifest.json](../artifacts/api-server/public/cinema/scenes.manifest.json).

---

## Forbidden (assets + UI)

Cyberpunk · neon overload · fantasy light · surreal objects · multiple focal points · extreme DOF blur · procedural gradient “art” · per-scene UI theming.

---

## UI + scene relationship

UI = **glass on top of reality**.

- Minimal, readable, **never stylised per scene**
- Scene `data-scene` must not tint buttons, type, or chrome
- No blur stacks on input; opacity only
- Playlist is the product; visuals are background emotion

---

## Motion policy

**Allowed:** fade in/out 200–400ms · subtle opacity on scene/overlay.

**Forbidden:** camera drift · parallax · multi-layer animation · bounce / staged reveals.

Implemented in `moment-app` CSS in `index.html`.

---

## Brand consistency test

> Show the frame for **1 second**. Is the emotion obvious?

If no → reject asset.

---

## Success definition

- Scenes feel like emotional **memory snapshots**
- User does not think about “design”
- Playlist feels primary; visuals stay quiet

---

## Implementation rule

If a visual, animation, or UI feature does not improve **clarity**, **emotional recognition**, or **speed to playlist** — **delete it**.

**Enforcement files:** `artifacts/api-server/public/index.html` (moment-app), `cinema/scenes.manifest.json`, `scripts/export_scene_prompts.py`.
