# Refactor: Pet Playlist–style Kwalify UI

Canonical paste target for Cursor Agent. Implementation lives in `artifacts/api-server/public/index.html`.

## Locked model

**Single emotional transformation:** text → music + one image. Not a simulation of environments.

## User states (only three)

| State | Visible behavior |
|-------|------------------|
| `home` | Input + chips + CTA. **No scene visible.** |
| `loading` | Input dims; button “Making playlist…”; scene fades in (~50% opacity). No overlays. |
| `result` | Full-bleed scene + echo + emotional title + micro line + Play on Spotify + Try another moment |

## Deleted / do not reintroduce

- thinking / locked / reveal / perception states
- Camera drift, zoom, pan, scene-camera-lock choreography
- `#sceneAtmosphere` grain/vignette on moment-app (hidden)
- Listen overlay, “Finding your moment”, progress copy on moment path
- `applyWorldEmotion` on moment-app (no-op)
- Staggered emerge animations, revealing class choreography
- Reshuffle / insights / emotion bars on default result

## Kept

- `getSceneFromInput()` → one scene
- `POST /api/generate` unchanged
- `MOMENT_EMOTIONAL_TITLES` + `showMomentResult()`
- Scene crossfade only (`SCENE_CROSSFADE_MS`)
- Still-first `/cinema/{id}/still.jpg`

## Result layout

1. Background — one still, full-bleed  
2. `#momentEcho` — user input, lowercase, ~72% opacity  
3. `#resultName` — abstract title (e.g. Midnight Distance)  
4. `#resultSummary` — From your liked songs.  
5. Play on Spotify — sole primary CTA  
6. Try another moment — ghost  

## Home layout

- Label: Type a moment  
- Placeholder: e.g. driving home at 2am after seeing someone  
- 5 chips (inspiration only)  
- Make playlist →  

## Success

User feels recognised in &lt;10s without noticing a “system”.

See also: [SIMPLE_MOMENT_PRODUCT.md](./SIMPLE_MOMENT_PRODUCT.md), [PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md](./PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md).
