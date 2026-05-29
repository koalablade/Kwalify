"""
mood_model.py — V3 lightweight mood prediction engine
(no training required, production-safe)
"""

import numpy as np


MOOD_LABELS = [
    "euphoric",
    "happy",
    "neutral",
    "nostalgic",
    "melancholy",
    "intense",
    "chill",
]


# =========================
# CORE MOOD VECTOR LOGIC
# =========================
def build_feature_vector(track):
    return np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        (track.tempo or 120) / 200,
    ], dtype=float)


# =========================
# RULE-BASED "LEARNED" MODEL
# =========================
def predict_mood(track):
    v = build_feature_vector(track)

    energy = v[0]
    valence = v[1]
    dance = v[2]
    acoustic = v[3]

    # simple emotional geometry (this is your "model")
    if valence > 0.75 and energy > 0.7:
        return "euphoric"

    if valence > 0.6 and energy > 0.55:
        return "happy"

    if energy < 0.35 and valence < 0.4:
        return "melancholy"

    if acoustic > 0.6 and valence < 0.6:
        return "nostalgic"

    if energy > 0.8:
        return "intense"

    if energy < 0.4 and valence > 0.5:
        return "chill"

    return "neutral"