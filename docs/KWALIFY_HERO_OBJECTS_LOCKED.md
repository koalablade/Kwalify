# Locked hero objects (first 5)

**Industrial design for emotions** — not illustration, not environments.  
**Build order:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) (silhouette first)  
**Style DNA:** [KWALIFY_VISUAL_STYLE_DNA.md](./KWALIFY_VISUAL_STYLE_DNA.md)  
**Figma build:** [KWALIFY_FIGMA_EMOTION_SCENE_UI.md](./KWALIFY_FIGMA_EMOTION_SCENE_UI.md)  
**Live CSS reference:** `artifacts/api-server/public/index.html` (`.hero-pump`, `.hero-road`, `.hero-lamp`, `.hero-car`, `.hero-horizon`)

---

## Shared language (all 5)

| Rule | Value |
|------|--------|
| Count | **One** hero object per screen |
| Shape | Geometric / semi-geometric only |
| Read | Silhouette in **1 second** |
| Background | Abstract gradient field — no scenery |
| Light | **Single** source; edge glow on hero only (10–40% opacity, 20–80px blur) |
| Material | Matte + soft metal; **no** texture noise |

**Non-negotiables:** NO environmental storytelling · NO multiple focal points · NO blob chaos.

---

## 1. Petrol station (night refuel)

**Scene id:** `petrol_station_2am` · **Hero key:** `pump`

**Object:** Single fuel pump monolith.

| Part | Form |
|------|------|
| Body | Tall rounded rectangle |
| Display | One central glowing rectangle |
| Hose | Smooth curved tube (not rope) |
| Nozzle | Simplified block |

**Forbidden:** canopy, station, cars, environment.

**Emotion:** Pause, isolation, late-night stillness.

---

## 2. Motorway drive (long distance flow)

**Scene id:** `night_drive` · **Hero key:** `road`

**Object:** Floating ribbon-road segment.

| Part | Form |
|------|------|
| Strip | One long curved ribbon |
| Markers | Minimal repeating dashed lines |
| Perspective | Wide front → narrow back |

**Optional:** 2–3 tiny light nodes in strip (abstract passing cars).

**Forbidden:** landscape, horizon line, sky.

**Emotion:** Motion, flow, time slipping.

---

## 3. Late London walk (urban light pole)

**Scene id:** `urban_midnight_walk` · **Hero key:** `lamp`

**Object:** Single streetlight monolith.

| Part | Form |
|------|------|
| Pole | Tall thin slightly tapered cylinder |
| Head | Rounded rectangular cap |
| Light | Soft cone beneath (subtle gradient only) |

**Forbidden:** buildings, streets, people.

**Emotion:** Solitude, quiet observation, nighttime thinking.

---

## 4. Old car project (garage lift core)

**Scene id:** `memory_road` (API placeholder until dedicated scene) · **Hero key:** `car`

**Object:** Simplified lifted car silhouette.

| Part | Form |
|------|------|
| Body | Single smooth capsule |
| Lift | Two minimal jack stands |
| Wheels | Simple discs, no spokes |

**Forbidden:** garage room, tools, clutter.

**Detail:** Soft underside glow; edges slightly worn — no grain.

**Emotion:** Unfinished work, mechanical intimacy, patience.

---

## 5. End of summer drive (horizon light strip)

**Scene id:** `summer_afternoon_drift` · **Hero key:** `horizon`

**Object:** Thin horizon light band.

| Part | Form |
|------|------|
| Strip | Single horizontal glowing band |
| Colour | Warm → cool along length |
| Shape | Slight curve (atmospheric lens) |

**Forbidden:** sun disc, sky detail, clouds.

**Emotion:** Nostalgia, ending, calm drift.

---

## Card → scene mapping

| Card title | `hero` | `sceneId` |
|------------|--------|-----------|
| Night Refuel | `pump` | `petrol_station_2am` |
| Motorway Drive | `road` | `night_drive` |
| Late London Walk | `lamp` | `urban_midnight_walk` |
| Old Car Project | `car` | `memory_road` |
| End of Summer Drive | `horizon` | `summer_afternoon_drift` |

Phase 2: add remaining five dream objects using **same** primitives — swap geometry only.
