# Kwalify scene clips (SceneRendererCore)

Single renderer: `getSceneFromInput()` → `renderScene(sceneId)`.

**Deployment:** MP4 files are optional. If none are present, the app probes once per session, then uses CSS gradients on `#cinemaFallback` (no blank screen). Set `SCENE_SKIP_VIDEO=true` in `index.html` to skip probes entirely.

## Video paths (tried in order)

1. `/cinema/{scene_id}.mp4`
2. `/cinema/{scene_id}/base.mp4`
3. `/cinema/abstract_light_field.mp4` (final fallback)

If all fail, **CSS animated gradient** on `#cinemaFallback` runs (never a blank screen).

## Scene ids

| id | triggers |
|----|----------|
| `rain_highway_pov` | rain, night, drive |
| `neon_city_walk` | city, london, neon |
| `golden_field_drift` | sun, happy |
| `desert_wide_solo` | desert, cowboy |
| `memory_hallway` | memory, nostalgia |
| `ocean_night_fog` | calm, soft |
| `abstract_light_field` | default |

Debug: open console — logs `Scene:` and `Video src:` when `SCENE_DEBUG` is true in `index.html`.
