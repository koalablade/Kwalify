# Kwalify Visual Style (TL;DR)

**North Star:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) · **Style DNA:** [KWALIFY_VISUAL_STYLE_DNA.md](./KWALIFY_VISUAL_STYLE_DNA.md) · **Objects:** [OBJECT_EXPLORATION.md](./OBJECT_EXPLORATION.md)  
**Export:** `python scripts/export_scene_prompts.py --phase1` (fuel pump only)

**Spotify Pets = emotional personality through animals. Kwalify = emotional personality through objects.** Same system, ownable identity — do not copy mascots literally.

---

## Structural fidelity (why the AI batches failed)

On Pets landing art you instantly read **dog, cat, bird, iguana** — playful flat style, but **not over-simplified** into abstract blobs and **not given a forced persona** in the still (no “lonely pump face,” no campaign spots-on-pump).

| Pets does | Our bad batches did |
|-----------|---------------------|
| Faithful simplified **structure** (ears, tail, beak still read) | Generic “pump shape” or mascot blob |
| **Neutral** baseline illustration | Baked-in emotion (eyes, lean = personality, lime quiz energy) |
| Personality later (motion, UI, context) | Personality in the PNG via gimmicks |
| Muted field + bold character **color blocks** | Fan-art palette cosplay or dark HDR editorial |
| Recognisable at glance **without** being realistic | AI slop: smeared vector, mixed 3D, wrong proportions |

**Kwalify rule:** The object must pass the **“oh yeah, that’s a ___”** test (fuel pump, streetlight, ticket) the same way Pets passes **“oh yeah, that’s a dog.”** Mood comes from spacing, palette, and UI — not from making the object cute or sad in the drawing.

**Not:** childish, cheap Spotify fan art, wrong object abstraction.  
**Yes:** quiet flat illustration (Matisse calm), Pets **geometry discipline**, Kwalify **palette and void**.

---

## What Spotify Pets actually is (ignore the dogs)

### 1. Single emotional character per screen

- One **hero entity**
- One **emotional state**
- One **readable silhouette**

| Pets | Kwalify |
|------|---------|
| Dog = character | Fuel pump, train ticket, lighthouse = character |

**Rule:** Nothing competes with the hero object.

### 2. Soft geometric character design language

- Rounded geometry (no sharp realism)
- Simplified forms, exaggerated readability
- Minimal surface detail — **no micro-texture noise**

Designed for **instant recognition at ~200ms** glance speed.

### 3. Emotion through shape, not detail

**Not:** lighting complexity, photorealism, environment detail  
**Yes:** posture, proportions, spacing, silhouette tension

| Pets (anatomy) | Kwalify (object symbolism) |
|----------------|---------------------------|
| Small head = vulnerability | Leaning pump = loneliness |
| Large eyes = openness | Upright rigid pump = tension |
| Tilted posture = personality | Soft glowing signage = hope |
| — | Isolated object in empty space = introspection |

### 4. Flat but soft depth model

Hybrid — not 3D realism, not pure flat vector:

- Subtle gradients
- Soft shadow separation
- “Fake depth” via layering
- Minimal ambient shading

Feels like a **premium animated illustration system**, not a drawing or a render.

### 5. Limited motion language (UI)

Motion is **reactive**, personality-driven, micro-scale, slow — not cinematic.

**Yes:** cursor-adjacent subtle response, gentle bounce on interaction, soft “breathing” of the object  
**No:** camera systems, parallax worlds, scene animation layers

### 6. Silhouette-first design

Every object must pass the **black silhouette test**. Remove detail — still readable → passes. This is why Pets scale in UI.

### 7. High consistency across all characters

Same drawing language, stroke/curvature rules, shading logic across all 10 scenes → **one world**, not 10 art styles.

---

## Kwalify: emotional object characters

You are **not** building Pets with objects. You are building **Emotional Object Characters** — each object behaves like a pet equivalent (personality through symbolism, not anthropomorphic faces unless deliberately minimal like variation D gauge “eyes”).

**Reality check:** Copy Pets too closely → lose originality. Follow this **system** → same emotional effect, ownable identity.

---

## Visual rules (summary)

| Rule | Target |
|------|--------|
| Hero | One object, ~20–40% of frame |
| Space | Large negative space, background never competes |
| Colour | One dominant, one accent, neutral support |
| Depth | Soft matte, subtle gradients only where needed |
| Avoid | Photorealism, HDR cinema, cyberpunk, Pixar, stock photo, clutter, animals, humans |

---

## Master prompt template (image generation)

Paste **universal block** + **scene line** (from `--phase1` or full export). The repo concatenates these automatically in `scenes.manifest.json`.

### CORE STYLE

```
A single emotional object treated as a character in a minimalist, soft geometric illustration system inspired by modern interactive product design. The object should feel alive emotionally without being anthropomorphic. Simplified shapes, rounded geometry, clean forms with subtle depth. No realism, no photorealistic textures, no complex environments.
```

### CHARACTER RULE

```
One object only. The object must feel like a personality, not a prop. Emotion through posture, scale, spacing, silhouette, simplicity.
```

### VISUAL STRUCTURE

```
Central object composition, large negative space, no clutter, soft separation between foreground and background, subtle ambient depth not realistic lighting, smooth curves and simplified geometry.
```

### STYLE LANGUAGE

```
Modern digital illustration, product design aesthetic, soft geometric shapes, minimal detail, clean edges, gentle shadows, subtle gradients only where needed for form, instant recognition at 200ms glance.
```

### OUTPUT GOAL

```
Premium interactive emotional system where objects act like characters — not illustration art, concept art, environment design, or film still.
```

### STRICT AVOID

```
Photorealism, 3D render realism, busy environments, cinematic lighting, hyper detail, rust scratches grain noise overlays, multiple focal points, complex backgrounds, human characters, animals, storytelling scenes.
```

### Pets reference (landing — structural, not campaign cosplay)

From [Spotify Pet Playlists](https://www.awwwards.com/sites/spotify-pet-playlists):

- **Read:** simplified anatomy still reads true (dog = floppy ear, snout, spots)
- **Eyes (on animals only):** concentric circles, deadpan neutral — not “cute emotion”
- **Surface:** flat colour blocks, no gradients/shading/fur noise
- **Field:** muted desaturated blue (not required: lime wave, picker UI chrome)
- **Objects for Kwalify:** do **not** put pet eyes on pumps; fidelity = hose, canopy silhouette, pump proportions

### Phase 1 scene line (`petrol_station_2am`)

```
Single fuel pump illustration, structurally faithful simplified form so it reads immediately as a petrol pump not a mascot, flat vector soft geometry, neutral deadpan baseline no facial personality no spots no lime campaign look, muted blue-grey field large negative space, loneliness through scale and emptiness only, Matisse-calm not editorial HDR not childish fan art, 20-40% frame.
```

**One-shot export:** `python scripts/export_scene_prompts.py --phase1`

---

## Phase 1 workflow (Figma-first)

**Checklist:** [PHASE1_FIGMA_PUMP_CHECKLIST.md](./PHASE1_FIGMA_PUMP_CHECKLIST.md)

1. Trace a real pump → silhouette at 48px must read “pump”
2. Flat neutral fills → Figma test at **18% / 38%** on `#060608` + overlay
3. Export 1920×1080 → `publish_cinema_still.py` → browser smoke test
4. Lock style sheet → Phase 2 objects

AI batches in `concepts/` are exploratory only; do not finalise other scenes until the Figma pump defines the world.

---

## Motion (after still is locked)

Spec for `index.html` scene layer only: opacity fades, optional subtle scale/breathe on hero zone, no camera or parallax. See North Star motion rules.
