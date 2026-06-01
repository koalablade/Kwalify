# How vibe layers combine

Kwalify builds one mood profile from **independent layers** that merge — not one keyword bulldozing the rest.

## Layers

| Layer | Examples | Resolves via |
|-------|----------|----------------|
| **Time** | `2am`, `10am`, `golden hour`, `late night` | `detectTimeOfDay()` — highest-specificity match wins |
| **Place** | `petrol station`, `city`, `bedroom`, `gym` | `detectEnvironment()` — weather beats vague "city" |
| **Atmosphere** | `rainy`, `fog`, `snow`, `sunny` | Same as place scoring (rain/snow score high) |
| **Motion** | `driving`, `walking`, `train` | `detectMotionState()` |
| **Emotion** | `sad`, `anxious`, `hopeful`, `drained` | Keyword weights |
| **Era** | `60s`, `90s`, `motown` | Keyword weights (`artistOrGenreCue`) |
| **Compound** | `2am petrol station`, `rainy night drive` | Long phrases in keyword bank |

## Rules (avoid petrol-station-at-2am vs 10am bugs)

1. **Places do not imply time** — `petrol station` alone does not force `late_night`.
2. **Clock times win** — `10am` beats generic `night` if both appear.
3. **Long phrases win** — `10am petrol station` applies as one compound hit.
4. **Per-layer caps** — max 3 time + 4 place + 8 emotion hits so words do not stack into nonsense.
5. **Scene hints only override when the matched phrase mentions that dimension** — e.g. time hint only applies if the phrase contains `am`/`morning`/etc.

## Example

`10am petrol station in a city`

- Time → **morning** (10am, score 90)
- Place → **urban** (petrol station 78, city 45 → petrol wins)
- Profile → morning urban mood (brighter, steadier than 2am)

`2am petrol station in a city`

- Time → **late_night**
- Place → **urban**
- Profile → low energy, more tension/nostalgia

Different playlists expected.

## Code

- `emotion-scene-layers.ts` — time/place/motion detection
- `emotion.ts` `analyzeVibe()` — keyword layers + merge
