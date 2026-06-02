# Kwalify Film Engine v3 — Scene Pack v1



12 emotional micro-film loops. Each scene is a **repeatable cinematic moment** (6–10s), not UI decoration.



## Timeline (enforced in app)



| Phase | Time | User sees |

|-------|------|-----------|

| Load | 0ms | Scene selected instantly |

| Fade in | 0–300ms | World fades in |

| World alone | 300ms–2.5s | Full-screen scene only — no dominant UI |

| Stabilize + reveal | 2.5s+ | Playlist UI (title → Play) |



Mood CSS (`atmo-*`) = **film grade only** while cinema is active.



## Video files (Option 1 — preferred)



Drop one loop per scene at **`public/cinema/`** (flat):



```

public/cinema/

  rain_highway_pov.mp4

  rain_highway_pov-overlay.mp4    # optional windshield streaks

  neon_city_walk.mp4

  golden_field_drift.mp4

  desert_wide_solo.mp4

  memory_hallway.mp4

  ocean_night_fog.mp4

  empty_motorway_aerial.mp4

  apartment_night_window.mp4

  sun_flare_overexpose.mp4

  abstract_light_field.mp4

  train_window_rain.mp4

  club_afterglow_empty.mp4

```



**Fallback paths** (also tried automatically):



- `public/cinema/{scene_id}/base.mp4`

- `public/cinema/{scene_id}/loop.mp4`



## Specs



- **Duration:** 6–10 seconds, seamless loop

- **Format:** MP4 H.264, **muted**

- **Resolution:** 1920×1080 or 1280×720 (`object-fit: cover`)

- **Content:** POV or slow cinematic b-roll matching scene id



## Scene Pack v1



| # | Scene id | Example input |

|---|----------|----------------|

| 1 | `rain_highway_pov` | rain + night + drive, 2am motorway |

| 2 | `neon_city_walk` | london, neon, city at night |

| 3 | `golden_field_drift` | sun, happy, golden field |

| 4 | `desert_wide_solo` | cowboy, desert, alone |

| 5 | `memory_hallway` | memory, nostalgia, hallway |

| 6 | `ocean_night_fog` | calm, soft, ocean, fog |

| 7 | `empty_motorway_aerial` | motorway, drive, aerial |

| 8 | `apartment_night_window` | apartment, window, rain, lonely |

| 9 | `sun_flare_overexpose` | overexposed, joy, sun flare |

| 10 | `abstract_light_field` | **fallback** — no keyword match |

| 11 | `train_window_rain` | train, rain, leaving |

| 12 | `club_afterglow_empty` | club, afterparty, empty |



Classifier: `SCENE_TRANSLATION_RULES` + `SCENE_NARRATIVES` in `index.html`. Pack list: `CINEMA_SCENE_PACK_V1`.

Film v3: compose preview behind text; Go dissolves UI; 800ms entry shot; reactive `--film-intensity`; playlist emerges inside film.



## Without video



Layered CSS parallax + subject motion runs per scene (backup only). Add `.mp4` files to unlock real micro-film.


