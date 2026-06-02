# Kwalify — Object exploration

**North Star:** [KWALIFY_CREATIVE_NORTH_STAR.md](./KWALIFY_CREATIVE_NORTH_STAR.md) · **Visual TL;DR:** [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md) · **Phase 1 scene:** `petrol_station_2am` · **Style refs:** [Spotify Pet Playlists (Awwwards SOTD)](https://www.awwwards.com/sites/spotify-pet-playlists)

---

## Purpose

Explore **dream objects** — symbolic emotional anchors — before building full scenes. Objects should feel memorable like Spotify Pets characters (“the fuel pump world”), not like stock photography.

---

## 50 dream objects by emotion

### Nostalgia (7)

| # | Object | Why it reads |
|---|--------|----------------|
| 1 | Garden chair | Suburban summer memory, stillness |
| 2 | Polaroid camera | Captured moment, fading instant |
| 3 | Cassette tape | Personal era, tactile recall |
| 4 | Faded road sign | Distance already travelled |
| 5 | Worn diary | Private past, handwritten self |
| 6 | Vinyl record | Slow rotation, ritual listening |
| 7 | Childhood bicycle | Small freedom, earlier life |

### Freedom (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 8 | Mile marker | Open road, forward motion |
| 9 | Car window frame | Escape, wind, leaving |
| 10 | Highway centre line | Path without end |
| 11 | Passport stamp | New territory |
| 12 | Kite tail | Lift, sky, release |
| 13 | Horizon strip | Unlimited ahead |

### Loneliness (7)

| # | Object | Why it reads |
|---|--------|----------------|
| 14 | Empty bench | Waiting, no one arrived |
| 15 | Unanswered phone | Connection missed |
| 16 | Streetlight | Alone in dark street |
| 17 | Late bus stop sign | Transit without company |
| 18 | Vacant café chair | Seat meant for two |
| 19 | Hallway bulb | Domestic isolation |
| 20 | Closed umbrella | Rain without shelter shared |

### Comfort (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 21 | Lamp beside window | Safe interior glow |
| 22 | Warm mug | Held calm, morning ritual |
| 23 | Folded blanket | Soft boundary, rest |
| 24 | Worn armchair | Body remembered |
| 25 | Night light plug | Low fear, childlike safety |
| 26 | Knitted scarf | Care, warmth given |

### Excitement (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 27 | Concert wristband | Event peak, belonging |
| 28 | Stadium light beam | Crowd energy implied |
| 29 | Sparkler stick | Brief bright burst |
| 30 | Roller climb silhouette | Anticipation before drop |
| 31 | Neon arrow sign | Direction, nightlife pull |
| 32 | Pulse line | Body alive, now |

### Romance (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 33 | Wine glass (one) | Intimacy, evening pair implied |
| 34 | Wax seal on letter | Intent, vulnerability |
| 35 | Single candle flame | Focused warmth |
| 36 | Rose in simple vase | Classic tenderness |
| 37 | Dance shoe pair | Closeness, movement |
| 38 | Matchbook heart | Small gesture, spark |

### Reflection (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 39 | Mirror corner | Self regard |
| 40 | Still lake surface | Doubled world, pause |
| 41 | Train ticket stub | Journey already taken |
| 42 | Open diary page | Words to self |
| 43 | Glasses on closed book | Thought, study, age |
| 44 | Pocket watch | Time weighed |

### Melancholy (6)

| # | Object | Why it reads |
|---|--------|----------------|
| 45 | Wilted flower | Loss, decay gentle |
| 46 | Rain on glass pane | Barrier, grey outside |
| 47 | Empty swing | Childhood absence |
| 48 | Faded photo frame | Memory eroding |
| 49 | Closed shop shutter | Day ended, hope deferred |
| 50 | Last cigarette | Habit, finality |

---

## Phase 1 selection: fuel pump

**Chosen object:** **fuel pump** (`petrol_station_2am`)

**Emotion cluster:** liminal stillness · loneliness · reflection (2am pause)

**North Star alignment:** User should say **“the fuel pump scene”** — not “a petrol station photo.”

**Spotify Pets lessons applied:**

| Pets trait | Kwalify translation |
|------------|---------------------|
| Character-first | Pump is the “character”; forecourt is minimal stage |
| Flat, friendly shapes | Rounded housing, simplified nozzle, no mechanical detail noise |
| Limited palette | 1 dominant + 1 accent (e.g. teal/navy + Spotify-green or warm amber) |
| Personality optional | Gauge “face” or hover blink — micro only, not mascot cosplay |
| Instant read | Silhouette readable in &lt;1s at phone width |
| Playful motion | Subtle opacity pulse on screen glow; no camera drift |

**Awwwards reference notes (interaction inspiration only):**

- [Eyes follow cursor](https://www.awwwards.com/inspiration/cursor-animation-pets-by-spotify) → optional: dial eyes track input focus lightly
- [Drag bar](https://www.awwwards.com/inspiration/drag-bar-animation-pets-by-spotify) → trait sliders are **out of scope** for moment MVP; keep for future
- [Loading animation](https://www.awwwards.com/inspiration/loading-animation-pets-by-spotify) → button text change only on Kwalify
- Site palette reference: restrained blue-teal family — adapt to Kwalify green accent on neutral dark base

---

## Fuel pump — design variations (exploration)

Concept stills for Phase 1. Path: `artifacts/api-server/public/cinema/petrol_station_2am/concepts/`

| ID | Name | Description |
|----|------|-------------|
| A | **Friendly icon** | Centered pump, flat editorial illustration, soft teal background, rounded forms, green accent stripe, generous negative space — closest to Pets “character on stage” |
| B | **Night forecourt** | Pump dominant left-third; simplified canopy shapes as soft blobs; wet ground reflection minimal; navy + sodium orange |
| C | **Liminal wide** | Tiny pump center-bottom; vast empty upper frame; fluorescent wash from top; emptiness as subject |
| D | **Gauge personality** | Pump with simplified dial “eyes” (Pets-like charm); still minimal; avoid cartoon excess |
| E | **Silhouette mark** | Bold pump silhouette only; single colour field; maximum icon potential for UI chip |

### Generated concept files (repo)

| Variation | File |
|-----------|------|
| Canonical (`--phase1` prompt) | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-canonical.png` |
| A — Friendly icon | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-a-friendly.png` |
| B — Night forecourt | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-b-forecourt.png` |
| C — Liminal wide | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-c-liminal.png` |
| D — Gauge personality | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-d-personality.png` |
| E — Silhouette mark | `artifacts/api-server/public/cinema/petrol_station_2am/concepts/fuel-pump-example-e-silhouette.png` |

**Pets-adjacent batch** (flat vector, wave background, lime + blue-grey):

| File | Notes |
|------|--------|
| `fuel-pump-pets-style-hero.png` | Center hero, white + red spots, wave BG |
| `fuel-pump-pets-style-friendly-green.png` | Green blocky pump, lime ground |
| `fuel-pump-pets-style-bold-red.png` | Red + black stripe graphic |
| `fuel-pump-pets-style-silhouette-pop.png` | Black silhouette + red accent |
| `fuel-pump-pets-style-picker-layout.png` | Multi-pump picker layout (UI ref) |

Open these locally to compare. Publish the winner to `still.jpg` after Phase 1 review.

### Canonical Phase 1 prompt

```bash
python scripts/export_scene_prompts.py --phase1
```

Matches [KWALIFY_VISUAL_STYLE_TLDR.md](./KWALIFY_VISUAL_STYLE_TLDR.md) example prompt.

### Next steps

1. Review concepts A–E; pick one direction for **30–50** refinements (fuel pump only).
2. Extract palette + corner radius + line weight → Phase 2 mini style guide.
3. Publish winner as `still.jpg` (1920×1080) via `scripts/publish_cinema_still.py`.

---

## Rejection checklist (any object or variation)

- Hyper-detail or HDR photography look
- Multiple competing focal points
- Cyberpunk / neon soup
- Reads as “AI art wallpaper” not “emotional object”
- Fails 1-second emotion test from North Star
