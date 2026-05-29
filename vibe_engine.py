"""
vibe_engine.py — stable production version

Fixes:
- restores missing score_track + apply_repeat_penalty
- keeps smarter interpretation
- ensures app.py imports never break again
"""

import re
import random
from datetime import datetime


# ---------------------------------------------------------------------------
# Emotion model (lightweight but expressive)
# ---------------------------------------------------------------------------

EMOTION_VOCAB = {
    "happy": {"energy": 0.4, "calm": -0.1},
    "sad": {"loneliness": 0.4, "energy": -0.2},
    "chill": {"calm": 0.4, "energy": -0.1},
    "angry": {"tension": 0.4, "energy": 0.3},
    "nostalgic": {"nostalgia": 0.4, "loneliness": 0.2},
    "anxious": {"tension": 0.4, "calm": -0.3},
    "love": {"calm": 0.2, "loneliness": -0.2},
    "party": {"energy": 0.4},
    "sleep": {"energy": -0.4, "calm": 0.3},
}

MODIFIERS = {
    "very": 1.4,
    "really": 1.3,
    "super": 1.5,
    "a bit": 0.7,
    "slightly": 0.6,
}


# ---------------------------------------------------------------------------
# INTERPRET VIBE (smarter semantic + still stable)
# ---------------------------------------------------------------------------

def interpret_vibe(text):
    text = (text or "").lower()

    base = {
        "energy": 0.5,
        "calm": 0.4,
        "tension": 0.2,
        "loneliness": 0.2,
        "nostalgia": 0.2,
    }

    modifier = 1.0
    for k, v in MODIFIERS.items():
        if k in text:
            modifier = v

    signals = []

    # phrase matching
    for phrase in sorted(EMOTION_VOCAB, key=len, reverse=True):
        if phrase in text:
            signals.append(phrase)
            for k, v in EMOTION_VOCAB[phrase].items():
                base[k] = max(0, min(1, base[k] + v * modifier))

    # token matching
    tokens = re.findall(r"\w+", text)
    for t in tokens:
        if t in EMOTION_VOCAB:
            signals.append(t)
            for k, v in EMOTION_VOCAB[t].items():
                base[k] = max(0, min(1, base[k] + v * modifier))

    confidence = min(1.0, len(signals) * 0.25 + 0.2)

    profile = {
        "energy": round(base["energy"], 3),
        "calm": round(base["calm"], 3),
        "tension": round(base["tension"], 3),
        "loneliness": round(base["loneliness"], 3),
        "nostalgia": round(base["nostalgia"], 3),
    }

    return profile, round(confidence, 2), signals


# ---------------------------------------------------------------------------
# REQUIRED FOR app.py (RESTORED)
# ---------------------------------------------------------------------------

def score_track(track, profile):
    """
    Simple similarity scoring between track audio features and vibe profile.
    Keeps your system stable even without heavy ML.
    """

    def f(x, default=0.5):
        try:
            return float(x)
        except:
            return default

    energy_diff = abs(f(track.get("energy")) - profile["energy"])
    valence_diff = abs(f(track.get("valence")) - profile.get("calm", 0.5))

    distance = (
        energy_diff * 0.6 +
        valence_diff * 0.4
    )

    return max(0.0, 1.0 - distance)


# ---------------------------------------------------------------------------
# REQUIRED FOR app.py (REPEAT CONTROL)
# ---------------------------------------------------------------------------

def apply_repeat_penalty(track_id, history_map):
    """
    Penalises repeated tracks based on last seen time.
    Keeps playlist fresh.
    """

    if track_id not in history_map:
        return 1.0

    last_seen = history_map[track_id]

    hours = (datetime.utcnow() - last_seen).total_seconds() / 3600

    if hours < 12:
        return 0.02
    if hours < 24:
        return 0.10
    if hours < 72:
        return 0.30
    if hours < 168:
        return 0.55

    return 1.0
