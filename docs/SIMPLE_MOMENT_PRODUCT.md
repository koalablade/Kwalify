# Kwalify — Simple Moment Product (locked)

Pet Playlist **structure**, not branding: one input → one emotional result.

**UI wireframe (Step 1):** [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) · **Visual system (Step 2):** [VISUAL_SYSTEM_GUIDE.md](./VISUAL_SYSTEM_GUIDE.md)  
**Master design system (source of truth):** [KWALIFY_DESIGN_SYSTEM.md](./KWALIFY_DESIGN_SYSTEM.md)  
**Why this shape works (analysis + full Cursor prompt):** [PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md](./PET_PLAYLIST_PRINCIPLES_FOR_KWALIFY.md)  
**Implementation checklist (Agent):** [REFACTOR_PET_PLAYLIST_UI.md](./REFACTOR_PET_PLAYLIST_UI.md)

## Model

```
INPUT  = moment (natural language)
OUTPUT = playlist (primary) + one still/loop (reinforcement)
```

## User flow

1. **Type a moment** (label + placeholder + 5 inspiration chips)
2. **Make playlist →**
3. Input dims slightly; scene brightens (~800ms min); no processing overlay
4. **Wow result** (full-bleed scene + centered copy):
   - Echo: user’s moment (lowercase, ~72% opacity)
   - Title: abstract emotional name (e.g. “Midnight Distance”) — Pet Playlist moment
   - Micro: “From your liked songs.”
   - **Play on Spotify** (only primary CTA)
   - **Try another moment** (ghost)
5. Repeat or leave

No visible multi-stage cinema UX (no thinking / locked / reveal states).

## Technical states (internal only)

| State | User sees |
|-------|-----------|
| `home` | Input + examples + scene preview while typing |
| `loading` | Dimmed input, button “Making playlist…” |
| `result` | Playlist card over scene |

## Do not expand

- Perception / cinematic state machines
- Layered atmosphere or UI blur
- Roadmap-driven UI complexity

## Scene assets

See [KWALIFY_DESIGN_SYSTEM.md](./KWALIFY_DESIGN_SYSTEM.md) (10 entities + visual rules) and [CINEMATIC_SCENE_LIBRARY.md](./CINEMATIC_SCENE_LIBRARY.md) — still-first, `getSceneFromInput()` weighted match unchanged.

## Engine

Playlist generation stays server-side (`POST /api/generate`). Frontend does not add scoring or scene-engine logic.
