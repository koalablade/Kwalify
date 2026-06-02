# Kwalify — 10 scene image prompts (master brand set)

**Enforcement:** [UNIFIED_VISUAL_SYSTEM.md](./UNIFIED_VISUAL_SYSTEM.md) · **Manifest:** [scenes.manifest.json](../artifacts/api-server/public/cinema/scenes.manifest.json)  
**Export full prompts:** `python scripts/export_scene_prompts.py`  
**Publish stills:** `python scripts/publish_cinema_still.py <image> <scene_id>`  
**Validate:** `python scripts/validate_cinema_assets.py`

---

## Global style prefix (every scene)

```
soft editorial cinematic photography, minimal composition, single subject focus, muted film color grading, shallow atmospheric detail, natural lighting, subtle grain, 35mm lens look, calm emotional tone, high clarity subject separation, not hyper-realistic, not HDR, not overly detailed, designed for UI background use
```

**Suffix (auto-appended in manifest export):** `16:9 aspect ratio, 1920x1080, no text, no watermark.`

---

## Brand consistency

Every image must feel like **different emotional states of the same world** — not different photography styles, grading systems, or realism levels.

### Do not generate

- Hyper-detailed AI scenes
- Fantasy lighting · neon overload · cyberpunk
- Busy compositions · multiple focal subjects
- Per-scene stylization drift

---

## Scenes

### 1. `night_drive` — detached reflection

**Rule:** only road + car + light

```
driver perspective inside a car at night on an empty motorway, wet asphalt reflecting sodium street lights, dashboard glow softly illuminating hands on steering wheel, distant highway lights fading into darkness, calm isolation, centered composition, minimal distractions, soft rain streaks on windshield, deep blacks and warm orange highlights
```

### 2. `petrol_station_2am` — liminal stillness

**Rule:** emptiness is the subject

```
empty petrol station at 2am, wide static shot, fluorescent canopy lights glowing harsh white, wet concrete reflecting green and red signage, one empty parked car far in background, vending machine light glowing inside small shop, strong negative space, slightly off-centre composition, quiet liminal atmosphere
```

### 3. `sunset_coast` — release

**Rule:** horizon is everything

```
quiet coastal road overlooking ocean at sunset, wide horizon dominating frame, soft waves reflecting orange and pink sky, no people, subtle sea mist, minimal foreground elements, cinematic still frame, warm fading light, calm expansive atmosphere, centered horizon composition
```

### 4. `urban_midnight_walk` — isolation in density

**Rule:** city feels alive but empty

```
empty city street at night, wet pavement reflecting neon signage and streetlights, distant blurred traffic bokeh, tall buildings framing a narrow corridor, subtle steam from vents, cool blue and magenta tones, human presence implied but not visible, eye-level perspective, symmetrical framing
```

### 5. `train_journey` — transition

**Rule:** inside vs outside duality

```
train interior at night looking out window, layered reflections of empty seats and passing lights, blurred city streaks outside, warm tungsten cabin lighting contrasting cool exterior darkness, soft motion blur implied, calm introspective mood, window frame as natural composition border
```

### 6. `summer_afternoon_drift` — nostalgia without sadness

**Rule:** warm emptiness

```
quiet suburban street in late summer afternoon, soft sunlight overexposing edges slightly, gentle heat haze, trees casting long soft shadows, open windows with curtains moving slightly, empty street, warm washed tones, nostalgic calm, static wide framing
```

### 7. `rainy_city_interior` — safe isolation

**Rule:** inside warmth vs outside chaos

```
interior room looking out through rain-covered window at blurred city lights, warm desk lamp glow inside, condensation on glass, heavy rain streaks running down window, deep blues outside contrasting amber interior light, still composition, intimate quiet mood, no visible people
```

### 8. `memory_road` — reflection

**Rule:** vanishing point = emotion

```
long empty countryside road stretching into soft foggy distance, fading golden-hour light, muted green fields on both sides, subtle atmospheric haze, vanishing point centered composition, emotional softness, minimal detail, calm forward perspective, nostalgic tone
```

### 9. `club_exit_dawn` — exhaustion + clarity

**Rule:** after-energy silence

```
empty city street at blue hour just before sunrise, faint neon signs still glowing, wet pavement reflecting fading nightlife, distant silhouettes barely visible, soft pale cyan sky transitioning to warm horizon, quiet post-night atmosphere, cinematic still framing, restrained lighting
```

### 10. `open_highway_daylight` — freedom

**Rule:** symmetry + openness

```
endless open highway in bright daylight, centered symmetrical road leading into horizon, clear blue sky, minimal cars or none, strong sense of space and freedom, warm asphalt tones, crisp visibility, calm expansive composition, cinematic wide framing
```

---

## Cursor / image generation workflow

1. Run `python scripts/export_scene_prompts.py` and paste into your image model.
2. Generate all 10 with **strict shared prefix** — do not restyle per scene.
3. Publish each to `artifacts/api-server/public/cinema/{scene_id}/still.jpg` at 1920×1080.
4. Run `python scripts/validate_cinema_assets.py`.

**Cursor instruction:**

> Generate 10 images using the exported prompts exactly. Maintain strict consistency across all outputs. Do not stylize individually per scene. Output as `/cinema/{scene_id}/still.jpg` at 1920×1080.

---

## What this achieves

- Pet Playlist–level readability (one emotional frame)
- One brand universe across scenes
- Fast UI load, clear emotion, no clutter
- Scalable scene additions later
