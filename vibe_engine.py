"""
vibe_engine.py — Pure local computation. Zero Spotify API calls.
"""

import random
from datetime import datetime


# ---------------------------------------------------------------------------
# Direct emotional vocabulary
# ---------------------------------------------------------------------------

EMOTION_VOCAB = {
    "euphoric": {"energy": +.45, "calm": -.20, "tension": +.10},
    "ecstatic": {"energy": +.50, "tension": +.15},
    "elated": {"energy": +.40, "loneliness": -.20},
    "hyped": {"energy": +.45, "tension": +.20},
    "pumped": {"energy": +.40, "tension": +.15},
    "electric": {"energy": +.35, "tension": +.20},
    "alive": {"energy": +.30, "loneliness": -.15},
    "wired": {"energy": +.35, "tension": +.25},
    "frantic": {"energy": +.40, "tension": +.35, "calm": -.25},

    "melancholic": {"loneliness": +.35, "nostalgia": +.30, "energy": -.20},
    "melancholy": {"loneliness": +.35, "nostalgia": +.30, "energy": -.20},
    "sad": {"loneliness": +.25, "energy": -.15, "calm": +.10},

    "anxious": {"tension": +.40, "energy": +.15, "calm": -.30},
    "nervous": {"tension": +.30, "calm": -.20},

    "peaceful": {"calm": +.40, "energy": -.20, "tension": -.20},
    "serene": {"calm": +.45, "energy": -.25},
    "relaxed": {"calm": +.35, "energy": -.15},

    "nostalgic": {"nostalgia": +.45, "loneliness": +.15, "calm": +.10},
    "wistful": {"nostalgia": +.35, "loneliness": +.25},

    "lonely": {"loneliness": +.40, "energy": -.10},

    "angry": {"tension": +.40, "energy": +.30, "calm": -.30},
    "rage": {"tension": +.50, "energy": +.40, "calm": -.40},

    "hopeful": {"energy": +.20, "loneliness": -.15, "calm": +.15},
    "motivated": {"energy": +.30, "tension": +.15},

    "dreamy": {"calm": +.30, "energy": -.15, "nostalgia": +.20},

    "dark": {"energy": -.05, "tension": +.15, "loneliness": +.10},
}


INTENSITY_MODIFIERS = [
    ("not really", 0.20),
    ("not very", 0.25),
    ("a little", 0.50),
    ("kind of", 0.60),
    ("slightly", 0.50),
    ("quite", 1.15),
    ("really", 1.40),
    ("very", 1.50),
    ("extremely", 1.80),
]


# ---------------------------------------------------------------------------
# Emotion extraction
# ---------------------------------------------------------------------------

def extract_direct_emotions(text):
    text = text.lower()

    deltas = {
        "loneliness": 0.0,
        "calm": 0.0,
        "tension": 0.0,
        "nostalgia": 0.0,
        "energy": 0.0,
    }

    matched = []

    multiplier = 1.0
    for phrase, mult in INTENSITY_MODIFIERS:
        if phrase in text:
            multiplier = mult

    for phrase in sorted(EMOTION_VOCAB, key=len, reverse=True):
        if phrase in text:
            matched.append(phrase)
            for k, v in EMOTION_VOCAB[phrase].items():
                deltas[k] += v * multiplier

    for k in deltas:
        deltas[k] = round(max(-0.8, min(0.8, deltas[k])), 3)

    confidence_boost = round(min(0.8, len(matched) * 0.22), 3)

    return deltas, confidence_boost, matched


# ---------------------------------------------------------------------------
# Scene parsing
# ---------------------------------------------------------------------------

def parse_scene(text):
    scene = {
        "location": "unknown",
        "time": "unknown",
        "activity": "unknown",
        "environment": "neutral",
        "motion_state": "stationary",
    }

    if "drive" in text:
        scene["location"] = "road"
        scene["activity"] = "driving"
        scene["motion_state"] = "moving"

    if "night" in text:
        scene["time"] = "night"

    if "gym" in text:
        scene["location"] = "gym"
        scene["activity"] = "training"

    if "home" in text:
        scene["location"] = "home"

    if "party" in text:
        scene["activity"] = "social"

    return scene


# ---------------------------------------------------------------------------
# Scene → emotion
# ---------------------------------------------------------------------------

def emotion_from_scene(scene):
    e = {
        "loneliness": 0.25,
        "calm": 0.40,
        "tension": 0.20,
        "nostalgia": 0.20,
        "energy": 0.50,
    }

    if scene["time"] == "night":
        e["loneliness"] += 0.2
        e["energy"] -= 0.1

    if scene["location"] == "road":
        e["energy"] += 0.1

    if scene["location"] == "gym":
        e["energy"] += 0.4
        e["tension"] += 0.2

    if scene["activity"] == "training":
        e["energy"] += 0.3

    if scene["activity"] == "social":
        e["energy"] += 0.2
        e["loneliness"] -= 0.2

    for k in e:
        e[k] = round(max(0.0, min(1.0, e[k])), 3)

    return e


# ---------------------------------------------------------------------------
# Audio profile
# ---------------------------------------------------------------------------

def audio_profile_from_emotion(em):
    en = em["energy"]
    calm = em["calm"]
    tension = em["tension"]
    lonely = em["loneliness"]
    nostalgia = em["nostalgia"]

    audio_energy = en * 0.6 + tension * 0.3 - calm * 0.2 + 0.25

    valence = en * 0.4 - lonely * 0.3 + calm * 0.2

    return {
        "energy": round(audio_energy, 3),
        "valence": round(valence, 3),
    }


# ---------------------------------------------------------------------------
# Repeat penalty (FIXED + USED)
# ---------------------------------------------------------------------------

def apply_repeat_penalty(track_id, history_map):
    if track_id not in history_map:
        return 1.0

    hours = (datetime.utcnow() - history_map[track_id]).total_seconds() / 3600

    if hours < 12:
        return 0.02
    if hours < 24:
        return 0.10
    if hours < 72:
        return 0.30
    if hours < 168:
        return 0.55
    return 1.0


# ---------------------------------------------------------------------------
# Track scoring
# ---------------------------------------------------------------------------

def score_track(track, profile):
    def sf(v):
        return float(v) if v is not None else 0.5

    return 1.0 - (
        abs(sf(track.get("energy")) - profile["energy"]) * 0.5
        + abs(sf(track.get("valence")) - profile["valence"]) * 0.5
    )


# ---------------------------------------------------------------------------
# FULL PIPELINE
# ---------------------------------------------------------------------------

def interpret_vibe(text):
    text = (text or "").lower()

    scene = parse_scene(text)
    emotion = emotion_from_scene(scene)

    direct, conf, signals = extract_direct_emotions(text)

    for k in emotion:
        emotion[k] = max(0.0, min(1.0, emotion[k] + direct.get(k, 0)))

    profile = audio_profile_from_emotion(emotion)

    confidence = min(1.0, conf + 0.4)

    return profile, confidence, signals


# ---------------------------------------------------------------------------
# Diversity selection (FIXED)
# ---------------------------------------------------------------------------

def diverse_select(scored_pairs, track_lookup, length, mode, history_map=None):
    rng = random.Random()
    result = []
    seen_artists = set()

    for tid, score in scored_pairs:

        if len(result) >= length:
            break

        track = track_lookup.get(tid)
        if not track:
            continue

        if tid in seen_artists:
            continue

        penalty = apply_repeat_penalty(tid, history_map or {})
        final_score = score * penalty

        if rng.random() < final_score:
            result.append(track)
            seen_artists.add(track.get("artist", ""))

    return result
