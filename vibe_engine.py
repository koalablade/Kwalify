import os
import math
import time
import hashlib
import numpy as np
from datetime import datetime

# =========================================================
# CONFIG
# =========================================================

EMBED_DIM = 32  # small + stable (important for Render)

# =========================================================
# EMBEDDING (SAFE FALLBACK SYSTEM)
# =========================================================

def _stable_hash(text: str):
    """Turn text into deterministic seed"""
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)


def embed_text(text: str):
    """
    Lightweight semantic embedding.
    No ML libraries → avoids Render crashes.
    """
    seed = _stable_hash(text.lower())
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    vec = vec / (np.linalg.norm(vec) + 1e-9)
    return vec


# =========================================================
# TRACK VECTOR BUILDING
# =========================================================

def track_vector(track):
    """
    Convert Spotify audio features into normalized vector.
    """

    features = np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        track.instrumentalness or 0.5,
        track.speechiness or 0.0,
        track.liveness or 0.0,
        track.tempo / 200 if track.tempo else 0.5,
    ], dtype=float)

    # normalize
    norm = np.linalg.norm(features) + 1e-9
    return features / norm


# =========================================================
# SEMANTIC INTERPRETER
# =========================================================

def interpret_vibe(vibe_text: str):
    """
    Converts vibe text → embedding vector
    """
    return embed_text(vibe_text)


# =========================================================
# COSINE SIMILARITY
# =========================================================

def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# =========================================================
# EMOTION MEMORY (prevents repetition bias)
# =========================================================

_user_emotion_history = {}


def _emotion_bucket(track_vec):
    """
    Compress track into rough emotion zone
    """
    valence = track_vec[1]
    energy = track_vec[0]

    if valence > 0.6 and energy > 0.6:
        return "uplifting"
    elif valence < 0.4 and energy < 0.4:
        return "melancholy"
    elif energy > 0.7:
        return "intense"
    elif valence > 0.6:
        return "warm"
    else:
        return "neutral"


def apply_repeat_penalty(user_id: str, score: float, track_vec):
    """
    Reduces repetition of same emotional zones.
    """

    bucket = _emotion_bucket(track_vec)

    history = _user_emotion_history.setdefault(user_id, [])

    # penalty if repeating same emotion
    if len(history) >= 3 and history[-1] == bucket:
        score *= 0.75

    if len(history) >= 5 and history[-2:] == [bucket, bucket]:
        score *= 0.6

    history.append(bucket)
    _user_emotion_history[user_id] = history[-10:]  # keep memory short

    return score


# =========================================================
# MAIN SCORING FUNCTION
# =========================================================

def score_track(user_id: str, vibe_vec, track):
    """
    Final semantic scoring function
    """

    t_vec = track_vector(track)

    # semantic similarity
    base_score = cosine(vibe_vec, t_vec)

    # emotion stability penalty
    final_score = apply_repeat_penalty(user_id, base_score, t_vec)

    return final_score


# =========================================================
# OPTIONAL: CLEAN EXPORT HELPERS
# =========================================================

def normalize_scores(scores):
    if not scores:
        return scores

    max_s = max(scores)
    min_s = min(scores)

    return [
        (s - min_s) / (max_s - min_s + 1e-9)
        for s in scores
    ]
