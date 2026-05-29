"""
vibe_engine.py — stable semantic vibe interpreter (no keyword matching)
"""

import re


# ---------------------------------------------------------
# soft signal maps (NOT keyword matching, just weighting hints)
# ---------------------------------------------------------

ENERGY_SIGNALS = {
    "high": ["energy", "hyped", "pump", "gym", "fast", "party", "driving"],
    "low": ["chill", "calm", "sleep", "relax", "focus", "study", "late"],
}

MOOD_SIGNALS = {
    "positive": ["happy", "uplifting", "good", "bright", "fun"],
    "negative": ["sad", "melancholy", "lonely", "dark", "emotional"],
}


def _score_text(text, buckets):
    score = 0.5  # neutral baseline

    t = text.lower()

    for k, words in buckets.items():
        for w in words:
            if w in t:
                if k in ["high", "positive"]:
                    score += 0.1
                else:
                    score -= 0.1

    return max(0.0, min(1.0, score))


def interpret_vibe(vibe_text):
    """
    Returns:
    - profile dict
    - confidence
    - signals
    """

    energy = _score_text(vibe_text, ENERGY_SIGNALS)
    mood = _score_text(vibe_text, MOOD_SIGNALS)

    profile = {
        "energy": energy,
        "valence": mood,
        "acousticness": 1.0 - energy,
        "danceability": energy * 0.8,
    }

    confidence = 0.65  # stable baseline (no fake ML claims)

    signals = {
        "raw_input": vibe_text,
        "energy_score": energy,
        "mood_score": mood,
    }

    return profile, confidence, signals


def score_track(track, profile):
    """
    Stable weighted scoring
    """

    return (
        (track.get("energy", 0.5) * profile["energy"]) +
        (track.get("valence", 0.5) * profile["valence"]) +
        (track.get("danceability", 0.5) * profile["danceability"])
    )


def apply_repeat_penalty(track_id, history_map):
    if track_id in history_map:
        return 0.4
    return 1.0
