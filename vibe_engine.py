"""
vibe_engine.py — stable emotional + semantic scoring (no ML cost)
"""

import numpy as np
import hashlib

EMBED_DIM = 32


# =========================================================
# EMBEDDING (stable + fast, no external ML)
# =========================================================

def _hash(text):
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)


def embed(text: str):
    seed = _hash(text.lower())
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    return vec / (np.linalg.norm(vec) + 1e-9)


# =========================================================
# TRACK VECTOR
# =========================================================

def track_vector(track):
    vec = np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        track.instrumentalness or 0.0,
        track.speechiness or 0.0,
        track.liveness or 0.0,
        (track.tempo or 120) / 200
    ], dtype=float)

    return vec / (np.linalg.norm(vec) + 1e-9)


# =========================================================
# VIBE
# =========================================================

def interpret_vibe(text):
    return embed(text)


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# =========================================================
# EMOTION DETECTION (improved)
# =========================================================

def get_emotion(vec):
    energy = vec[0]
    valence = vec[1]

    if valence > 0.7 and energy > 0.6:
        return "euphoric"
    if valence < 0.35 and energy < 0.4:
        return "melancholy"
    if energy > 0.75:
        return "intense"
    if valence > 0.65 and energy < 0.5:
        return "nostalgic"
    if valence > 0.6:
        return "warm"
    if energy < 0.3:
        return "nostalgic"

    return "neutral"


# =========================================================
# REPEAT / EMOTION LOOP PREVENTION
# =========================================================

def apply_repeat_penalty(history, track_id, score):
    """
    Prevents emotional repetition loops properly.
    """

    recent_tracks = [h.track_id for h in history[-10:]]

    if track_id in recent_tracks[-3:]:
        score *= 0.55   # hard repeat penalty

    if len(recent_tracks) >= 5:
        if len(set(recent_tracks[-5:])) <= 2:
            score *= 0.75  # emotional loop detection

    return score


# =========================================================
# NOSTALGIA BOOST (NEW FEATURE)
# =========================================================

def nostalgia_boost(track_vec, emotion):
    """
    Boosts nostalgic / warm / low-energy emotional signals
    """

    energy = track_vec[0]
    valence = track_vec[1]

    boost = 0.0

    # classic nostalgia feel: low energy + mid/low valence
    if energy < 0.45 and 0.35 < valence < 0.7:
        boost += 0.08

    # emotional memory trigger
    if emotion == "nostalgic":
        boost += 0.12

    # soft warmth memory effect
    if emotion == "warm":
        boost += 0.05

    return boost


# =========================================================
# MAIN SCORING (HYBRID)
# =========================================================

def hybrid_score(vibe_vec, track_vec, track, emotion=None):
    """
    Final scoring system:
    semantic + emotional shaping + nostalgia boost
    """

    semantic = cosine(vibe_vec, track_vec)

    # emotion-aware adjustment
    if emotion is None:
        emotion = get_emotion(track_vec)

    emotional_weight = 0.08 if emotion == "neutral" else 0.12

    nostalgia = nostalgia_boost(track_vec, emotion)

    return semantic + emotional_weight + nostalgia
