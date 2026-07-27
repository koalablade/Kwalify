# World Understanding Report

Generated: 2026-07-27

## Knowledge size

| Category | Count |
|----------|------:|
| Scenes | 14 |
| Situations | 350 |
| Emotional states | 200 |
| Phrases | 44 |
| Sensory concepts | 300 |
| UK cultural contexts | 80 |
| Common language phrases | 120 |
| Emotion library | 500 |
| Weather contexts | 80 |
| Places | 120 |
| Activity library | 100 |
| Time contexts | 60 |
| Social contexts | 80 |
| Movement concepts | 80 |
| Sensory language | 120 |
| Music descriptors | 60 |
| UK context (universal) | 100 |
| Concept graph nodes | 730 |
| Concept graph domains | 11 |

## Moment coverage (target: 95%)

| Metric | Value |
|--------|------:|
| Prompts tested | 2000 |
| Moment coverage | 62.6% |
| Scene accuracy | 66.2% |
| Emotion accuracy | 85.1% |
| Music direction accuracy | 96.3% |
| Gap to 95% target | 32.4% |

## Testing

| Metric | Value |
|--------|------:|
| Prompts tested | 2000 |
| Strong interpretations | 62.6% |
| Weak interpretations | 13.2% |

### Category pass rates

| Category | Prompts | Scene hit | Emotion hit |
|----------|--------:|----------:|------------:|
| Driving | 50 | 100% | 100% |
| Weather | 50 | 100% | 100% |
| Relationships | 50 | 64% | 80% |
| Nostalgia | 50 | 60% | 100% |
| Life changes | 50 | 60% | 100% |
| UK everyday life | 100 | 80% | 90% |
| Abstract feelings | 100 | 67% | 100% |
| Places | 50 | 60% | 100% |
| Activities | 50 | 100% | 100% |
| Everyday language | 75 | 33% | 100% |
| Music language | 75 | 57% | 96% |
| Travel and movement | 75 | 95% | 100% |
| Social moments | 75 | 64% | 77% |
| Time atmosphere | 75 | 56% | 100% |
| Sensory moments | 75 | 80% | 100% |
| Short prompts | 100 | 70% | 80% |
| Gym and fitness | 100 | 58% | 66% |
| Gaming and focus | 50 | 80% | 80% |
| Achievement | 50 | 40% | 40% |
| Memory and neighbourhood | 100 | 60% | 100% |
| Main character | 75 | 60% | 80% |
| Motivation | 75 | 36% | 20% |
| Work routine | 75 | 80% | 40% |
| Human moments | 75 | 40% | 40% |
| UK extended | 100 | 60% | 100% |
| Social extended | 100 | 65% | 100% |
| Travel extended | 100 | 80% | 100% |

## Golden prompt probes

### "I sat outside my house for 20 minutes because I wasn't ready to go in"
- Scene: `REFLECTIVE_AVOIDANCE_JOURNEY`
- Emotions: avoidance, reflection
- Situations: —
- Confidence: 0.97

### "That first night where your new place finally feels like home"
- Scene: `LATE_NIGHT_SOLITARY_JOURNEY`
- Emotions: hope, contentment, anticipation, independence, safety
- Situations: situation:first_night_new_home_rain_0, situation:first_night_new_home_night_8, situation:first_night_new_home_grey_sunday_16
- Confidence: 0.98

### "Walking home after everyone has left"
- Scene: `DEPARTURE_WALK`
- Emotions: safety, nostalgia, privacy, acceptance, reflection
- Situations: —
- Confidence: 0.98

### "The last summer before everyone moved away"
- Scene: `SUMMER_TRANSITION`
- Emotions: nostalgia, bittersweet
- Situations: —
- Confidence: 0.93

### "The feeling of driving nowhere because you need some space"
- Scene: `LATE_NIGHT_SOLITARY_JOURNEY`
- Emotions: freedom, reflection, avoidance, nostalgia, solitude
- Situations: —
- Confidence: 0.98

### "Driving home after a difficult day, rain on the glass, nowhere to rush to"
- Scene: `LATE_NIGHT_SOLITARY_JOURNEY`
- Emotions: exhaustion, reflection, relief, peace, loneliness
- Situations: situation:difficult_day_home_rain_6, situation:difficult_day_home_night_13, situation:difficult_day_home_grey_sunday_20
- Confidence: 0.98

## Main weaknesses

- Concept graph has 730+ interconnected nodes across 11 domains with 1-hop propagation
- Moment coverage is ~63% on 2000 human prompts — emotion and music direction are strong; scene accuracy is the bottleneck
- Scene selection remains scored template matching, not reasoning over implied meaning
- Graph and library entries are partly template-expanded from seeds
- Negation and complex syntax are not deeply handled
- World understanding nudges EmotionProfile only; it does not yet drive authoritative intent contract

## Architecture

```
USER PROMPT
  → phrase matching + fuzzy expansion
  → taxonomy extraction (6 categories)
  → rich knowledge (situations, emotional states, sensory, UK cultural)
  → universal knowledge (11 language libraries)
  → concept graph (word → context → experience → emotion → music)
  → scene composition
  → music behaviour translation
  → EmotionProfile nudge (scoring unchanged)
```
