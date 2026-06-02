# Cinematic Moment Library (Kwalify)

Owned, consistent scene system: lighting, composition, lens, emotional intent, and constraints — not references to third-party media.

## Constitution

See [VISUAL_STYLE.md](../artifacts/api-server/public/cinema/VISUAL_STYLE.md).

## Scene manifest

Machine-readable prompts and flags: [scenes.manifest.json](../artifacts/api-server/public/cinema/scenes.manifest.json).

## Asset pipeline

1. Generate or photograph each scene using the manifest `prompt` (Midjourney, DALL·E, Stable Diffusion, or graded photography).
2. Export **16:9** at 1920×1080 (or higher, same ratio).
3. Save as `artifacts/api-server/public/cinema/{scene_id}/still.jpg`.
4. Optional video loops (only `night_drive`, `urban_midnight_walk`, `rainy_city_interior`): `{scene_id}.mp4` or `{scene_id}/base.mp4`.
5. Validate: `python scripts/validate_cinema_assets.py`

## Runtime behaviour

- Still image always preferred
- Video only for manifest `videoScenes` when still is missing
- No gradient or procedural “scene art” — emergency flat plate only if assets are absent

## QA checklist (per scene)

- [ ] Photorealistic, film-still feel
- [ ] Single clear focal / emotional read
- [ ] Natural light sources visible
- [ ] Subtle grade, not synthetic neon soup
- [ ] 16:9, fills frame at `object-fit: cover`
