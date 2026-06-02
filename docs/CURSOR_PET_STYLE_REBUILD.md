# Cursor master prompt — Kwalify Pet-style rebuild

> **Shipped logged-in UI (canonical):** [EMOTION_GRID_UI_ENTRY.md](./EMOTION_GRID_UI_ENTRY.md) — 5-card Pets illustration grid + fullscreen object.  
> **Docs:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md) · [KWALIFY_FINAL_UI_BLUEPRINT.md](./KWALIFY_FINAL_UI_BLUEPRINT.md)

Legacy moment-compose wireframe below is **not** the logged-in homepage. **Do not modify** `POST /api/generate`, Spotify backend, or server scene scoring.

**Wireframe (legacy):** [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) · **Prompts:** [SCENE_IMAGE_PROMPTS.md](./SCENE_IMAGE_PROMPTS.md)

---

## Product principle

Kwalify is an **experience**, not a system.

> Type a moment → something understands it → music appears

Not: AI engine, cinematic generator, multi-stage UX, configurable panels.

---

## UX flow (only these states)

| State | User sees |
|-------|-----------|
| **home** | Full-bleed scene + “What moment are you in?” + chips + Make playlist → |
| **typing** | Same layout; scene opacity shifts slightly; no loaders |
| **loading** | Button “Making playlist…”; scene dims; **1–1.5s max**; same screen |
| **result** | Refined moment title + Spotify (primary) + short track preview + Try another moment |

Internal classes: `moment-home`, `moment-loading`, `moment-result` (+ `moment-typing` while input non-empty).

---

## Visual rules (scenes)

One subject · soft realism · single light mood · 1 dominant + 1 accent colour · one atmosphere layer · static wide camera.

Ten IDs only: `night_drive`, `petrol_station_2am`, `sunset_coast`, `urban_midnight_walk`, `train_journey`, `summer_afternoon_drift`, `rainy_city_interior`, `memory_road`, `club_exit_dawn`, `open_highway_daylight`.

Frontend mapping: `getSceneFromInput()` (+3 direct, +2 emotion, +1 context, single winner).

---

## Remove / never reintroduce

Perception states · cinematic engines · atmosphere stacks · blur UI · DJ/progress loaders · staged reveals · any state beyond home → loading → result.

---

## Implementation rule

If it does not improve **type moment → get playlist → feel understood**, delete it.

**Primary file:** `artifacts/api-server/public/index.html` (`moment-app`).

---

## Success criteria

- Understood in &lt;3 seconds  
- Feels instant and emotionally accurate  
- UI invisible; scene + music carry the moment  
