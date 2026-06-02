# Kwalify — Scene visual style

**Creative North Star (supreme direction):** [KWALIFY_CREATIVE_NORTH_STAR.md](../../../../docs/KWALIFY_CREATIVE_NORTH_STAR.md)

We are building **Emotional Editorial Worlds** — symbolic small worlds with a **dream object** anchor — not realistic cinematic photography.

**Enforcement:** [UNIFIED_VISUAL_SYSTEM.md](../../../../docs/UNIFIED_VISUAL_SYSTEM.md) · **Prompts:** [scenes.manifest.json](./scenes.manifest.json) · **Export:** `python scripts/export_scene_prompts.py`

---

## Dream object rule

Each scene has one iconic object (fuel pump, dashboard glow, lighthouse, etc.). Environment supports the object. User should remember **“the fuel pump scene”**, not a stock photo.

---

## Art direction

- Editorial illustration · premium music-brand feel
- Simplified forms · strong silhouettes · negative space
- Limited palette · subtle texture · emotional atmosphere

**Avoid:** hyper realism · HDR · photobashing · cyberpunk · visual noise

---

## Asset phases

| Phase | Scope |
|-------|--------|
| **1** | `petrol_station_2am` only — 30–50 concepts to find the language |
| **2** | Extract style guide from winners |
| **3** | Remaining 9 scenes in locked style |

Do not polish all 10 scenes before Phase 1 completes.

---

## Delivery

| Requirement | Value |
|-------------|--------|
| Aspect ratio | 16:9 |
| Primary asset | `{scene_id}/still.jpg` (1920×1080) |
| Optional video | Only `night_drive`, `urban_midnight_walk`, `rainy_city_interior` until style lock |

Frontend: still → optional video → flat `#060608` emergency plate. UI stays neutral on top (glass on reality).
