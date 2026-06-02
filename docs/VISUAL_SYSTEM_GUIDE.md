# Kwalify — 10-scene visual system (one brand)

Every scene must feel like **the same camera in different places** — not ten unrelated styles.

**Wireframe:** [MOMENT_UI_WIREFRAME.md](./MOMENT_UI_WIREFRAME.md) · **Image prompts:** [SCENE_IMAGE_PROMPTS.md](./SCENE_IMAGE_PROMPTS.md) · **Manifest:** [../artifacts/api-server/public/cinema/scenes.manifest.json](../artifacts/api-server/public/cinema/scenes.manifest.json)

---

## Core brand idea

> A held emotional moment captured by the same camera, in different places.

Soft realism grade: slightly softened, gently desaturated blacks, memory-like — *what it felt like, not documentary fact.*

---

## Global constraints (all 10)

Break any → reject the asset.

| Rule | Allowed | Forbidden |
|------|---------|-----------|
| **Same camera** | Wide static; centred vanishing points; consistent lens family (~35mm feel) | Zoom drama; distortion; mixed photo styles |
| **Soft realism grade** | Emotional grade; muted blacks | Sharp HDR; hyperdetail |
| **Colour** | 1 dominant tone + 1 accent + neutral base | Rainbow palettes; competing accents |
| **One subject** | Single focal point | Clutter; secondary stories |
| **One atmosphere** | fog OR rain OR haze OR clean air OR interior glow | Stacked weather FX |

**UI:** never add vignette/grain stacks in CSS on top of scenes.

---

## Scene bible

### `night_drive` — detached reflection

- **Visual:** Motorway vanishing point; dashboard glow foreground; sodium rhythm.
- **Light:** Sodium streetlights.
- **Colour:** Deep navy + warm orange.
- **Atmosphere:** Light rain or dry night haze (one only).

### `petrol_station_2am` — liminal stillness

- **Visual:** Static wide forecourt; fluorescent canopy; empty geometry.
- **Light:** Harsh artificial white.
- **Colour:** Green-white + red accents.
- **Atmosphere:** Still air.

### `sunset_coast` — emotional release

- **Visual:** Horizon dominates; minimal sea texture; open sky gradient.
- **Light:** Soft golden diffusion.
- **Colour:** Gold + soft cyan.
- **Atmosphere:** Clean air.

### `urban_midnight_walk` — isolation in density

- **Visual:** Empty street corridor; distant lit windows; wet reflections.
- **Light:** Sodium + restrained neon.
- **Colour:** Blue base + magenta accents.
- **Atmosphere:** Light mist.

### `train_journey` — transition / introspection

- **Visual:** Window reflection; blurred landscape; seat glow.
- **Light:** Interior tungsten vs exterior blur.
- **Colour:** Muted green + warm amber.
- **Atmosphere:** Glass reflection (not fog + rain).

### `summer_afternoon_drift` — nostalgia without sadness

- **Visual:** Suburban stillness; soft overexposure; washed trees.
- **Light:** Daylight bloom.
- **Colour:** Washed yellow + pale green.
- **Atmosphere:** Subtle heat haze.

### `rainy_city_interior` — safe isolation

- **Visual:** Interior foreground; rain-streaked window; blurred city.
- **Light:** Warm lamp vs cold exterior.
- **Colour:** Amber + deep blue.
- **Atmosphere:** Rain only.

### `memory_road` — reflective nostalgia

- **Visual:** Centred road vanishing point; empty countryside; soft horizon.
- **Light:** Late golden hour.
- **Colour:** Faded green + warm gold.
- **Atmosphere:** Light atmospheric softness.

### `club_exit_dawn` — exhaustion → clarity

- **Visual:** Empty post-night street; blue hour; fading neon remnants.
- **Light:** Blue hour + pale dawn edge.
- **Colour:** Cold blue + pale cyan.
- **Atmosphere:** Still air.

### `open_highway_daylight` — freedom

- **Visual:** Symmetrical highway; dominant sky; minimal clutter.
- **Light:** High daylight clarity.
- **Colour:** Bright blue + warm asphalt.
- **Atmosphere:** Clean sharp air.

---

## Production

1. Use `scenes.manifest.json` prompts (include global soft-realism suffix).
2. Export `cinema/{id}/still.jpg` 16:9.
3. Optional video: `night_drive`, `urban_midnight_walk`, `rainy_city_interior` only.
4. `python scripts/validate_cinema_assets.py`

---

## QA (3-second test)

User names the **feeling**, not the technology. Scenes feel **curated together**, not “generated collection.”
