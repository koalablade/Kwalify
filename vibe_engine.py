"""
vibe_engine.py — Pure local computation. Zero Spotify API calls.

Pipeline:
  text → parse_scene (Layer 1)
       → emotion_from_scene (Layer 2a)
       → extract_direct_emotions (Layer 2b)
       → merge
       → audio_profile_from_emotion (Layer 3)
       → interpret_vibe returns (profile, confidence, signals)

Scoring:
  score_track(track, profile) → float 0–1
  diverse_select(scored_pairs, lookup, length, mode) → [track_dict, ...]
"""

import random


# ---------------------------------------------------------------------------
# Direct emotional vocabulary
# ---------------------------------------------------------------------------

EMOTION_VOCAB = {
    # ── High energy / positive ──────────────────────────────────────────────
    "euphoric":     {"energy": +.45, "calm": -.20, "tension": +.10},
    "ecstatic":     {"energy": +.50, "tension": +.15},
    "elated":       {"energy": +.40, "loneliness": -.20},
    "hyped":        {"energy": +.45, "tension": +.20},
    "pumped":       {"energy": +.40, "tension": +.15},
    "electric":     {"energy": +.35, "tension": +.20},
    "alive":        {"energy": +.30, "loneliness": -.15},
    "wired":        {"energy": +.35, "tension": +.25},
    "frantic":      {"energy": +.40, "tension": +.35, "calm": -.25},
    "adrenaline":   {"energy": +.40, "tension": +.30},
    "hype":         {"energy": +.40, "tension": +.20},
    # ── Melancholic / sad ────────────────────────────────────────────────────
    "melancholic":  {"loneliness": +.35, "nostalgia": +.30, "energy": -.20},
    "melancholy":   {"loneliness": +.35, "nostalgia": +.30, "energy": -.20},
    "sad":          {"loneliness": +.25, "energy": -.15, "calm": +.10},
    "depressed":    {"loneliness": +.40, "energy": -.30, "calm": -.10},
    "blue":         {"loneliness": +.20, "nostalgia": +.15, "energy": -.10},
    "heartbreak":   {"loneliness": +.40, "tension": +.20, "nostalgia": +.25},
    "heartbroken":  {"loneliness": +.40, "tension": +.20, "nostalgia": +.25},
    "crying":       {"loneliness": +.35, "energy": -.20},
    "grief":        {"loneliness": +.45, "energy": -.30, "calm": -.10},
    "hurt":         {"loneliness": +.30, "tension": +.15, "energy": -.10},
    "miserable":    {"loneliness": +.40, "energy": -.30},
    # ── Anxious / tense ──────────────────────────────────────────────────────
    "anxious":      {"tension": +.40, "energy": +.15, "calm": -.30},
    "anxiety":      {"tension": +.40, "energy": +.15, "calm": -.30},
    "nervous":      {"tension": +.30, "calm": -.20},
    "stressed":     {"tension": +.35, "energy": +.10, "calm": -.25},
    "overwhelmed":  {"tension": +.30, "energy": -.10, "calm": -.20},
    "uneasy":       {"tension": +.25, "loneliness": +.10},
    "paranoid":     {"tension": +.35, "loneliness": +.20},
    "restless":     {"tension": +.25, "energy": +.15, "calm": -.20},
    "tense":        {"tension": +.35, "calm": -.20},
    "on edge":      {"tension": +.35, "calm": -.25},
    # ── Calm / peaceful ──────────────────────────────────────────────────────
    "peaceful":     {"calm": +.40, "energy": -.20, "tension": -.20},
    "serene":       {"calm": +.45, "energy": -.25},
    "tranquil":     {"calm": +.45, "energy": -.30},
    "relaxed":      {"calm": +.35, "energy": -.15},
    "zen":          {"calm": +.40, "energy": -.10, "tension": -.25},
    "mellow":       {"calm": +.30, "energy": -.15},
    "chill":        {"calm": +.25, "energy": -.10},
    "content":      {"calm": +.20, "loneliness": -.10},
    "comfortable":  {"calm": +.20, "tension": -.10},
    "cosy":         {"calm": +.25, "loneliness": -.10},
    "cozy":         {"calm": +.25, "loneliness": -.10},
    "soothing":     {"calm": +.30, "tension": -.15, "energy": -.10},
    # ── Nostalgic ────────────────────────────────────────────────────────────
    "nostalgic":    {"nostalgia": +.45, "loneliness": +.15, "calm": +.10},
    "wistful":      {"nostalgia": +.35, "loneliness": +.25, "calm": +.10},
    "bittersweet":  {"nostalgia": +.30, "loneliness": +.20, "energy": -.05},
    "reminiscing":  {"nostalgia": +.40, "calm": +.10},
    "throwback":    {"nostalgia": +.35},
    "memories":     {"nostalgia": +.30, "loneliness": +.10},
    "memory":       {"nostalgia": +.30, "loneliness": +.10},
    "longing":      {"nostalgia": +.30, "loneliness": +.30},
    "homesick":     {"nostalgia": +.40, "loneliness": +.30, "energy": -.15},
    "reminds me":   {"nostalgia": +.30},
    # ── Lonely / isolated ────────────────────────────────────────────────────
    "lonely":       {"loneliness": +.40, "energy": -.10},
    "isolated":     {"loneliness": +.40, "tension": +.10},
    "empty":        {"loneliness": +.35, "energy": -.20, "calm": +.10},
    "hollow":       {"loneliness": +.30, "energy": -.15},
    "disconnected": {"loneliness": +.35, "tension": +.10},
    "numb":         {"loneliness": +.20, "energy": -.20, "tension": -.10},
    "invisible":    {"loneliness": +.30, "energy": -.10},
    # ── Angry / intense ──────────────────────────────────────────────────────
    "angry":        {"tension": +.40, "energy": +.30, "calm": -.30},
    "rage":         {"tension": +.50, "energy": +.40, "calm": -.40},
    "furious":      {"tension": +.50, "energy": +.45},
    "intense":      {"tension": +.25, "energy": +.25},
    "aggressive":   {"tension": +.35, "energy": +.35, "calm": -.20},
    "pissed":       {"tension": +.40, "energy": +.30, "calm": -.25},
    "villain arc":  {"tension": +.35, "energy": +.40, "calm": -.30},
    # ── Hopeful / inspired ───────────────────────────────────────────────────
    "hopeful":      {"energy": +.20, "loneliness": -.15, "calm": +.15},
    "inspired":     {"energy": +.25, "tension": +.10},
    "motivated":    {"energy": +.30, "tension": +.15},
    "determined":   {"energy": +.25, "tension": +.20, "calm": -.05},
    "confident":    {"energy": +.20, "tension": +.10, "loneliness": -.10},
    "unstoppable":  {"energy": +.35, "tension": +.20, "loneliness": -.15},
    # ── Dreamy / ethereal ────────────────────────────────────────────────────
    "dreamy":       {"calm": +.30, "energy": -.15, "nostalgia": +.20},
    "ethereal":     {"calm": +.25, "energy": -.10},
    "floaty":       {"calm": +.25, "energy": -.15},
    "hazy":         {"calm": +.20, "energy": -.10, "nostalgia": +.15},
    "surreal":      {"tension": +.10, "calm": +.10, "nostalgia": +.15},
    "detached":     {"calm": +.15, "loneliness": +.20, "energy": -.10},
    "spaced out":   {"calm": +.20, "energy": -.20, "tension": -.10},
    # ── Dark / moody ─────────────────────────────────────────────────────────
    "dark":         {"energy": -.05, "tension": +.15, "loneliness": +.10},
    "gloomy":       {"energy": -.15, "loneliness": +.25, "calm": +.05},
    "brooding":     {"tension": +.20, "loneliness": +.20, "energy": -.05},
    "moody":        {"tension": +.15, "loneliness": +.15},
    "somber":       {"loneliness": +.25, "energy": -.15, "calm": +.10},
    "bleak":        {"loneliness": +.30, "energy": -.20, "tension": +.10},
    "ominous":      {"tension": +.30, "loneliness": +.10, "energy": +.05},
    "sinister":     {"tension": +.35, "loneliness": +.10},
    # ── Romantic ─────────────────────────────────────────────────────────────
    "romantic":     {"calm": +.15, "loneliness": -.10, "nostalgia": +.15},
    "love":         {"calm": +.10, "loneliness": -.15, "energy": +.05},
    "infatuated":   {"energy": +.15, "tension": +.15, "loneliness": -.20},
    # ── Low energy / tired ───────────────────────────────────────────────────
    "bored":        {"energy": -.25, "calm": +.10},
    "tired":        {"energy": -.30, "calm": +.15},
    "exhausted":    {"energy": -.40, "calm": +.10},
    "sleepy":       {"energy": -.35, "calm": +.25},
    "burnt out":    {"energy": -.35, "tension": +.10, "loneliness": +.15},
    "drained":      {"energy": -.35, "tension": +.05},
    # ── Social / dance ───────────────────────────────────────────────────────
    "euphoria":     {"energy": +.45, "calm": -.15, "tension": +.10},
    "party":        {"energy": +.35, "loneliness": -.25},
    "dance":        {"energy": +.30, "loneliness": -.15},
}

# Intensity modifiers — listed longest-phrase-first so "not very" wins over "very"
INTENSITY_MODIFIERS = [
    ("not really",  0.20),
    ("not very",    0.25),
    ("a little",    0.50),
    ("a bit",       0.55),
    ("kind of",     0.60),
    ("kinda",       0.60),
    ("sorta",       0.65),
    ("slightly",    0.50),
    ("somewhat",    0.70),
    ("quite",       1.15),
    ("so",          1.30),
    ("totally",     1.30),
    ("really",      1.40),
    ("deeply",      1.50),
    ("super",       1.50),
    ("very",        1.50),
    ("incredibly",  1.60),
    ("absolutely",  1.65),
    ("extremely",   1.80),
    ("insanely",    1.80),
]


def extract_direct_emotions(text):
    """
    Scan lowercased vibe text for emotional vocabulary + intensity modifiers.
    Returns (deltas, confidence_boost, matched_signals).
    """
    deltas = {
        "loneliness": 0.0, "calm": 0.0,
        "tension": 0.0, "nostalgia": 0.0, "energy": 0.0,
    }
    matched = []

    # Strongest intensity modifier present (largest |mult - 1.0|)
    multiplier = 1.0
    for phrase, mult in INTENSITY_MODIFIERS:
        if phrase in text and abs(mult - 1.0) > abs(multiplier - 1.0):
            multiplier = mult

    # Multi-word emotion phrases first (longest match first)
    for phrase in sorted(EMOTION_VOCAB, key=len, reverse=True):
        if " " in phrase and phrase in text and phrase not in matched:
            matched.append(phrase)
            for k, v in EMOTION_VOCAB[phrase].items():
                deltas[k] += v * multiplier

    # Single-word emotions
    already = set(matched)
    for word in text.split():
        if word in EMOTION_VOCAB and word not in already:
            already.add(word)
            matched.append(word)
            for k, v in EMOTION_VOCAB[word].items():
                deltas[k] += v * multiplier

    for k in deltas:
        deltas[k] = round(max(-0.8, min(0.8, deltas[k])), 3)

    confidence_boost = round(min(0.8, len(matched) * 0.22), 3)
    return deltas, confidence_boost, matched


# ---------------------------------------------------------------------------
# Layer 1 — scene parsing
# ---------------------------------------------------------------------------

def parse_scene(text):
    """Extract structured scene from free-text vibe."""
    scene = {
        "location": "unknown",
        "time": "unknown",
        "activity": "unknown",
        "environment": "neutral",
        "motion_state": "stationary",
    }

    if any(k in text for k in ["petrol station", "gas station", "service station", "services"]):
        scene["location"] = "liminal"
        scene["environment"] = "urban"
    elif any(k in text for k in ["motorway", "highway", "freeway"]):
        scene["location"] = "road"
        scene["environment"] = "urban"
    elif any(k in text for k in ["drive", "driving", "car", "road"]):
        scene["location"] = "road"
    elif any(k in text for k in ["gym", "training", "weights"]):
        scene["location"] = "gym"
        scene["environment"] = "indoor"
    elif any(k in text for k in ["bedroom", "room", "home", "house", "flat"]):
        scene["location"] = "home"
        scene["environment"] = "indoor"
    elif any(k in text for k in ["outside", "outdoor", "park", "beach", "forest"]):
        scene["location"] = "outdoor"
        scene["environment"] = "open_air"
    elif any(k in text for k in ["bar", "club", "party", "venue"]):
        scene["location"] = "social_venue"
        scene["environment"] = "indoor"

    if any(k in text for k in ["2am", "3am", "4am", "2 am", "3 am", "4 am",
                                "midnight", "late night", "dead of night"]):
        scene["time"] = "late_night"
    elif any(k in text for k in ["night", "evening", "dark"]):
        scene["time"] = "night"
    elif any(k in text for k in ["sunset", "golden hour", "dusk"]):
        scene["time"] = "sunset"
    elif any(k in text for k in ["sunrise", "dawn", "early morning"]):
        scene["time"] = "morning"
    elif any(k in text for k in ["morning", "afternoon", "daytime", "midday"]):
        scene["time"] = "day"

    if any(k in text for k in ["drive", "driving", "motorway", "road trip", "car"]):
        scene["activity"] = "driving"
        scene["motion_state"] = "moving"
    elif any(k in text for k in ["gym", "workout", "training", "exercise",
                                  "lifting", "run", "running", "jogging",
                                  "rage", "villain arc", "hype"]):
        scene["activity"] = "training"
        scene["motion_state"] = "high_motion"
    elif any(k in text for k in ["sleep", "sleeping", "falling asleep"]):
        scene["activity"] = "sleeping"
        scene["motion_state"] = "stationary"
    elif any(k in text for k in ["study", "studying", "work", "coding",
                                  "focus", "office", "desk", "commute"]):
        scene["activity"] = "focused_work"
        scene["motion_state"] = "stationary"
    elif any(k in text for k in ["party", "dance", "dancing", "club", "rave"]):
        scene["activity"] = "social"
        scene["motion_state"] = "moving"
    elif any(k in text for k in ["walk", "walking", "stroll"]):
        scene["activity"] = "walking"
        scene["motion_state"] = "slow_motion"
    elif any(k in text for k in ["alone", "lonely", "by myself", "solo"]):
        scene["activity"] = "solitary"
        scene["motion_state"] = "stationary"

    if any(k in text for k in ["rain", "raining", "rainy"]):
        scene["environment"] = "rainy"
    elif any(k in text for k in ["fog", "foggy", "misty", "mist"]):
        scene["environment"] = "foggy"
    elif any(k in text for k in ["summer", "sunny", "hot"]):
        scene["environment"] = "summer"
    elif any(k in text for k in ["winter", "cold", "freezing", "snow"]):
        scene["environment"] = "cold"

    # Common shorthand combos
    if any(k in text for k in ["night drive", "driving alone", "alone on the motorway",
                                "sunset drive", "drive home", "driving home"]):
        scene.update({
            "location": "road",
            "time": "night" if "night" in text else scene["time"],
            "activity": "driving",
            "motion_state": "moving",
        })
        if "sunset" in text:
            scene["time"] = "sunset"

    return scene


# ---------------------------------------------------------------------------
# Layer 2a — scene → emotion baseline
# ---------------------------------------------------------------------------

def emotion_from_scene(scene):
    """Map scene dict to emotional intensity weights (all in [0, 1])."""
    e = {
        "loneliness": 0.25,
        "calm": 0.40,
        "tension": 0.20,
        "nostalgia": 0.20,
        "energy": 0.50,
    }

    t = scene.get("time")
    if t == "late_night":
        e["loneliness"] += 0.40
        e["calm"] += 0.10
        e["energy"] -= 0.30
        e["nostalgia"] += 0.25
    elif t == "night":
        e["loneliness"] += 0.20
        e["energy"] -= 0.10
        e["nostalgia"] += 0.10
    elif t == "sunset":
        e["nostalgia"] += 0.30
        e["calm"] += 0.15
        e["energy"] += 0.10
    elif t == "morning":
        e["energy"] += 0.10
        e["calm"] += 0.10

    loc = scene.get("location")
    if loc == "liminal":
        e["loneliness"] += 0.35
        e["tension"] += 0.25
        e["nostalgia"] += 0.20
        e["calm"] -= 0.10
    elif loc == "road":
        e["energy"] += 0.10
        e["nostalgia"] += 0.10
        e["tension"] += 0.08
    elif loc == "gym":
        e["energy"] += 0.40
        e["tension"] += 0.25
        e["loneliness"] -= 0.10
        e["calm"] -= 0.20
    elif loc == "home":
        e["calm"] += 0.20
    elif loc == "social_venue":
        e["energy"] += 0.25
        e["loneliness"] -= 0.20

    env = scene.get("environment")
    if env == "rainy":
        e["calm"] += 0.20
        e["loneliness"] += 0.20
        e["energy"] -= 0.20
        e["nostalgia"] += 0.15
    elif env == "foggy":
        e["tension"] += 0.20
        e["loneliness"] += 0.15
    elif env == "summer":
        e["energy"] += 0.20
        e["nostalgia"] += 0.20
        e["calm"] += 0.10
    elif env == "cold":
        e["loneliness"] += 0.20
        e["energy"] -= 0.10

    motion = scene.get("motion_state")
    if motion == "high_motion":
        e["energy"] += 0.30
        e["tension"] += 0.15
        e["calm"] -= 0.15
    elif motion == "moving":
        e["energy"] += 0.15
    elif motion == "stationary":
        e["calm"] += 0.05

    act = scene.get("activity")
    if act == "training":
        e["energy"] += 0.30
        e["tension"] += 0.20
        e["calm"] -= 0.15
    elif act == "sleeping":
        e["calm"] += 0.30
        e["energy"] -= 0.35
    elif act == "focused_work":
        e["calm"] += 0.10
        e["tension"] += 0.10
    elif act == "social":
        e["energy"] += 0.20
        e["loneliness"] -= 0.25
    elif act == "solitary":
        e["loneliness"] += 0.25
        e["nostalgia"] += 0.10

    for k in e:
        e[k] = round(max(0.0, min(1.0, e[k])), 3)
    return e


# ---------------------------------------------------------------------------
# Layer 3 — emotions → audio profile
# ---------------------------------------------------------------------------

def audio_profile_from_emotion(em):
    """Convert emotion weights to target audio feature ranges."""
    en, calm, tension, lonely, nostalgia = (
        em["energy"],
        em["calm"],
        em["tension"],
        em["loneliness"],
        em["nostalgia"],
    )

    audio_energy = max(0.05, min(0.98, en * 0.55 + tension * 0.30 - calm * 0.20 + 0.25))
    valence = max(
        0.05, min(0.98, en * 0.35 - lonely * 0.35 - tension * 0.20 + calm * 0.15 + 0.45)
    )
    tempo_center = 60 + audio_energy * 105
    tempo_spread = 12 + tension * 10
    acousticness = max(0.0, min(1.0, lonely * 0.30 + nostalgia * 0.30 - en * 0.30 + 0.30))
    instrumentalness = max(0.0, min(1.0, calm * 0.25 + lonely * 0.15 - en * 0.40 + 0.20))

    return {
        "energy": round(audio_energy, 3),
        "valence": round(valence, 3),
        "tempo_min": int(max(55, tempo_center - tempo_spread)),
        "tempo_max": int(min(200, tempo_center + tempo_spread)),
        "acousticness": round(acousticness, 3),
        "instrumentalness": round(instrumentalness, 3),
    }


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def interpret_vibe(vibe_text):
    """
    Full 3-layer pipeline.
    Returns (profile, confidence, signals).

    confidence — float 0–1:
      ≥ 0.65  strong match (clear scene + emotional vocabulary)
      0.35–0.64  good match
      < 0.35  broad match (vague text)
    """
    text = (vibe_text or "").strip().lower()

    scene = parse_scene(text)
    scene_signals = [v for v in scene.values() if v not in ("unknown", "neutral", "stationary")]
    scene_conf = round(min(0.7, len(scene_signals) * 0.22), 3)

    emotion = emotion_from_scene(scene)

    direct_deltas, emo_conf, emo_signals = extract_direct_emotions(text)

    for k in emotion:
        emotion[k] = round(max(0.0, min(1.0, emotion[k] + direct_deltas.get(k, 0.0))), 3)

    profile = audio_profile_from_emotion(emotion)

    confidence = round(min(1.0, scene_conf + emo_conf * 0.65), 2)
    all_signals = emo_signals + scene_signals

    return profile, confidence, all_signals


# ---------------------------------------------------------------------------
# Track scoring
# ---------------------------------------------------------------------------

def _normalize_tempo(bpm):
    if not bpm:
        return 0.5
    return max(0.0, min(1.0, (float(bpm) - 60.0) / 140.0))


def score_track(track, profile):
    """Score a track dict against an audio profile. Pure local math."""

    def sf(val, default=0.5):
        try:
            return float(val) if val is not None else default
        except (TypeError, ValueError):
            return default

    energy_diff = abs(sf(track.get("energy")) - sf(profile.get("energy")))
    valence_diff = abs(sf(track.get("valence")) - sf(profile.get("valence")))
    tempo_mid = (
        sf(profile.get("tempo_min"), 95) + sf(profile.get("tempo_max"), 120)
    ) / 2.0
    tempo_diff = abs(
        _normalize_tempo(track.get("tempo")) - _normalize_tempo(tempo_mid)
    )
    acousticness_diff = abs(
        sf(track.get("acousticness")) - sf(profile.get("acousticness"))
    )
    instrumentalness_diff = abs(
        sf(track.get("instrumentalness"), 0.0) - sf(profile.get("instrumentalness"), 0.0)
    )

    distance = (
        energy_diff * 0.35
        + valence_diff * 0.30
        + tempo_diff * 0.15
        + acousticness_diff * 0.12
        + instrumentalness_diff * 0.08
    )
    return 1.0 - max(0.0, min(1.0, distance))


def _energy_band(track):
    e = track.get("energy")
    if e is None:
        return "mid"
    e = float(e)
    if e < 0.38:
        return "low"
    if e < 0.68:
        return "mid"
    return "high"


def diverse_select(scored_pairs, track_lookup, length, mode, rng_seed=None):
    """
    Pick `length` tracks with diversity rules.

    scored_pairs: [(track_id, score), ...] sorted descending
    track_lookup: {track_id: track_dict}
    mode: strict | balanced | chaotic
    """
    rng = random.Random(rng_seed)
    length = max(10, min(100, length))

    if mode == "strict":
        pool = scored_pairs[:max(length * 2, 40)]
    elif mode == "chaotic":
        pool = scored_pairs[:]
        rng.shuffle(pool)
    else:
        top_n = max(length * 3, 60)
        pool = scored_pairs[:top_n]

    seen_artists = {}
    seen_energy_bands = {"low": 0, "mid": 0, "high": 0}
    result = []

    for tid, score in pool:
        if len(result) >= length:
            break
        track = track_lookup.get(tid)
        if not track:
            continue

        artist = track.get("artist", "")
        band = _energy_band(track)

        if mode == "balanced":
            artist_count = seen_artists.get(artist, 0)
            if artist_count >= 2:
                continue
            total = len(result) or 1
            band_ratio = seen_energy_bands[band] / total
            if band_ratio > 0.55 and len(result) > 10:
                continue

        seen_artists[artist] = seen_artists.get(artist, 0) + 1
        seen_energy_bands[band] += 1
        result.append(track)

    # Pad with remaining tracks if we didn't hit length
    if len(result) < length:
        used_ids = {t["id"] for t in result}
        for tid, _ in scored_pairs:
            if len(result) >= length:
                break
            if tid not in used_ids:
                track = track_lookup.get(tid)
                if track:
                    result.append(track)
                    used_ids.add(tid)

    return result
