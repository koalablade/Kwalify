# Kwalify — Scene visual style (Emotional Editorial Symbolism)

Source of truth for **moment** backgrounds: [KWALIFY_DESIGN_SYSTEM.md](../../../../docs/KWALIFY_DESIGN_SYSTEM.md).

## Intent

Each scene is an **emotional visual metaphor**, not a simulated world. One frame, one dominant feeling, readable in under half a second.

## Composition

- Single subject or one environmental focus
- Centred or slightly off-centre
- Strong negative space; no clutter

## Lighting & colour

- One dominant light source; soft falloff
- One dominant tone + at most one accent
- Desaturated backgrounds preferred; subtle grade only

## Materials

- Soft matte / clay / editorial illustration feel
- No hyperrealism, no noisy detail, no abstract gradient blobs

## Motion (optional video only)

- Almost none: subtle loop acceptable for `night_drive`, `urban_midnight_walk`, `rainy_city_interior`
- No camera drift systems, no continuous animation layers on the UI

## Delivery

| Requirement | Value |
|-------------|--------|
| Aspect ratio | 16:9 |
| Primary asset | `{scene_id}/still.jpg` (required) |
| Optional video | `{scene_id}.mp4` or `{scene_id}/base.mp4` (three scenes above) |
| Frontend load order | still → video (if allowed) → flat `#060608` emergency plate |

Per-scene prompts: `scenes.manifest.json`.
