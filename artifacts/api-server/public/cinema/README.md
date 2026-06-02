# Kwalify cinematic scenes (Moment Engine)

Single renderer: `getSceneFromInput()` → `renderScene(sceneId)`.

## Load order

1. `/cinema/{scene_id}.mp4`
2. `/cinema/{scene_id}/base.mp4`
3. `/cinema/{scene_id}/still.jpg` (or `.webp`, or `{scene_id}.jpg` at root)
4. **Structured composite still** on `#cinemaFallback` (never a blank screen)

Pure gradient-only scenes are not used as the final layer when stills are missing — composites use horizon/road/light cues per archetype.

## Scene ids (filmScene payload)

| id | vibe cues |
|----|-----------|
| `night_drive` | rain, lonely, night, drive, tunnel |
| `petrol_station_2am` | petrol, gas station, 2am, forecourt |
| `sunset_coast` | sunset, coast, beach |
| `urban_midnight_walk` | city, london, neon, walk |
| `train_journey` | train, leaving, journey |
| `summer_afternoon_drift` | sun, summer, afternoon, happy |
| `rainy_city_interior` | rain + window, apartment, interior |
| `memory_road` | memory, nostalgic, country |
| `club_exit_dawn` | club, afterparty, dawn |
| `open_highway_daylight` | highway, motorway, open road (default) |

## Deploy assets (recommended)

For each `scene_id`, add either:

- `{scene_id}.mp4` or `{scene_id}/base.mp4`
- `{scene_id}/still.jpg` (1920×1080 cinematic still)

Optional: set `SCENE_SKIP_VIDEO=true` in `index.html` to skip video probes.
