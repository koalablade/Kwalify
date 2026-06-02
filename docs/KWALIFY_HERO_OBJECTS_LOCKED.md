# Locked hero objects (first 5) — Pets illustration

**Style:** Spotify Pets–inspired **soft illustrations** — friendly, rounded, simplified.  
**Not:** industrial icons, geometric UI marks, technical diagrams.  
**Build:** [KWALIFY_OBJECT_CONSTRUCTION_MODE.md](./KWALIFY_OBJECT_CONSTRUCTION_MODE.md)  
**Live UI:** `artifacts/api-server/public/index.html` · `PETS_ILLUST_DEFS` · `EMOTION_MOODS`

---

## Shared language (all 5)

| Rule | Value |
|------|--------|
| Count | **One** illustrated object per screen |
| Feel | Soft, rounded, slightly exaggerated for readability |
| Read | Instant “oh yeah, that’s a ___” at card and hero size |
| Background | Soft gradient only — no scenery |
| Light | Calm ambient, gentle shading on object |
| Detail | Minimal — no micro-texture, no realism |

**Non-negotiables:** NO environments · NO multiple focal points · NO mascot faces · NO industrial/CNC look

---

## 1. Night Refuel (`petrol_station_2am` · `pump`)

**Object:** Soft friendly fuel pump illustration.

**SVG construction (locked):** [KWALIFY_PETROL_PUMP_SVG_LOCKED.md](./KWALIFY_PETROL_PUMP_SVG_LOCKED.md)  
**Assets:** `fuel-pump-hero.svg` · `fuel-pump-silhouette.svg` · `PETS_ILLUST_DEFS.pump`

- Six layers only: body → head → screen → hose → nozzle → accent  
- Feels like a **character-like pump**, not a forecourt diagram  

**Forbidden:** canopy, station, cars, realism, sharp metal edges  

**Emotion:** Pause, late-night stillness  

---

## 2. Motorway Drive (`night_drive` · `road`)

**Object:** Flowing curved ribbon road.

- One thick soft stroke/path, gentle S-curve, subtle highlight along length  
- Suggests motion without drawing a landscape  

**Forbidden:** horizon line, sky, lane markings as technical diagram  

**Emotion:** Flow, distance, night drive  

---

## 3. Late London Walk (`urban_midnight_walk` · `lamp`)

**Object:** Soft glowing streetlight.

- Rounded lamp head, warm glow halo, simple rounded pole  
- Light feels **warm and calm**, not street infrastructure CAD  

**Forbidden:** buildings, pavement, people  

**Emotion:** Solitude, quiet walk  

---

## 4. Old Car Project (`memory_road` · `car`)

**Object:** Simplified rounded car silhouette.

- Inflated body capsule, soft cabin bump, simple disc wheels  
- Garage **implied** by object only — no room  

**Forbidden:** tools, lift machinery detail, photoreal car  

**Emotion:** Patience, unfinished work  

---

## 5. End of Summer Drive (`summer_afternoon_drift` · `horizon`)

**Object:** Soft gradient horizon band.

- Warm elliptical glow + softer lower band  
- Reads as **ending light**, not a technical chart  

**Forbidden:** sun disc with rays, clouds, landscape strip  

**Emotion:** Nostalgia, calm drift  

---

## Card → scene mapping

| Card title | `illust` | `sceneId` |
|------------|----------|-----------|
| Night Refuel | `pump` | `petrol_station_2am` |
| Motorway Drive | `road` | `night_drive` |
| Late London Walk | `lamp` | `urban_midnight_walk` |
| Old Car Project | `car` | `memory_road` |
| End of Summer Drive | `horizon` | `summer_afternoon_drift` |

Phase 2: add moods using the **same illustration discipline** — swap object only, keep soft language.
