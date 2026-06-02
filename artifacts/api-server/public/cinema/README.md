# Kwalify cinematic scene library

Owned moment imagery: constitution, prompts, and assets — not third-party references.

| Doc | Purpose |
|-----|---------|
| [VISUAL_STYLE.md](./VISUAL_STYLE.md) | Global visual rules (film still, natural light, grounded tone) |
| [scenes.manifest.json](./scenes.manifest.json) | Per-scene generation prompts + `videoScenes` flags |

## Runtime load order

1. `/cinema/{scene_id}/still.jpg` (required for production)
2. Video **only** if still missing **and** scene ∈ `videoScenes` in manifest
3. Emergency flat plate `#060608` (never gradient art)

Scene changes: **350ms crossfade**.

## Add or replace assets

1. Generate from manifest `prompt` (16:9, photorealistic, no text/watermark).
2. Save as `cinema/{scene_id}/still.jpg` (1920×1080 recommended).
3. Optional loop: `cinema/{scene_id}.mp4` or `cinema/{scene_id}/base.mp4` (video scenes only).
4. Run `python scripts/validate_cinema_assets.py` from repo root.

## Dev placeholder generator (non-production)

`scripts/generate_cinema_stills.py` draws procedural placeholders for layout testing only. **Do not ship** those as final art — replace with manifest prompts.

See [docs/CINEMATIC_SCENE_LIBRARY.md](../../docs/CINEMATIC_SCENE_LIBRARY.md).
