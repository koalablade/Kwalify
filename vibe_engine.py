import os
import time
import math
import hashlib
import numpy as np
from collections import defaultdict, deque

# =========================================================
# CONFIG
# =========================================================

EMBED_DIM = 32  # lightweight + stable for Render

# =========================================================
# MEMORY (in-memory, Render-safe fallback)
# =========================================================

_user_memory = defaultdict(lambda: {
    "recent_tracks": deque(maxlen=50),
    "recent_emotions": deque(maxlen=20),
    "last_seen": {}
})

_user_emotion_history = defaultdict(lambda: deque(maxlen=10))

# =========================================================
# EMBEDDINGS (NO ML LIBS — SAFE FALLBACK)
# =========================================================

def _stable_hash(text: str):
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)


def embed_text(text: str):
    """
    Deterministic pseudo-embedding.
    Replaces sentence-transformers safely.
    """
    seed = _stable_hash(text.lower())
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    vec = vec / (np.linalg.norm(vec) + 1e-9)
    return vec


# =========================================================
# TRACK VECTOR
# =========================================================

def track_vector(track):
    features = np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        track.instrumentalness or 0.5,
        track.speechiness or 0.0,
        track.liveness or 0.0,
        (track.tempo or 120) / 200
    ], dtype=float)

    return features / (np.linalg.norm(features) + 1e-9)


# =========================================================
# SEMANTIC INTERPRETER
# =========================================================

def interpret_vibe(vibe_text: str):
    return embed_text(vibe_text)


# =========================================================
# COSINE SIMILARITY
# =========================================================

def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# =========================================================
# EMOTION BUCKETING
# =========================================================

def _emotion_bucket(vec):
    energy = vec[0]
    valence = vec[1]

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


def apply_repeat_penalty(user_id, score, track_vec):
    bucket = _emotion_bucket(track_vec)

    history = _user_emotion_history[user_id]

    if len(history) >= 3 and history[-1] == bucket:
        score *= 0.75

    if len(history) >= 5 and list(history)[-2:] == [bucket, bucket]:
        score *= 0.6

    history.append(bucket)
    return score


# =========================================================
# MEMORY UPDATES
# =========================================================

def update_memory(user_id, track_id, track_vec):
    memory = _user_memory[user_id]
    bucket = _emotion_bucket(track_vec)

    now = time.time()

    memory["recent_tracks"].append(track_id)
    memory["recent_emotions"].append(bucket)
    memory["last_seen"][track_id] = now


# =========================================================
# NOVELTY SCORE
# =========================================================

def novelty_score(user_id, track_id):
    memory = _user_memory[user_id]

    if track_id in memory["recent_tracks"]:
        idx = list(memory["recent_tracks"]).index(track_id)
        return max(0.0, 1.0 - (idx / 50))

    return 1.0


# =========================================================
# FRESHNESS SCORE
# =========================================================

def freshness_score(user_id, track_id):
    memory = _user_memory[user_id]
    last_seen = memory["last_seen"].get(track_id)

    if not last_seen:
        return 0.0

    age_days = (time.time() - last_seen) / 86400
    return max(0.0, 1.0 - (age_days / 7))


# =========================================================
# HYBRID SCORING ENGINE
# =========================================================

def hybrid_score(user_id, vibe_vec, track):
    t_vec = track_vector(track)

    # semantic match
    semantic = cosine(vibe_vec, t_vec)

    # diversity + freshness
    novelty = novelty_score(user_id, track.spotify_id)
    freshness = freshness_score(user_id, track.spotify_id)

    # emotional repetition penalty
    semantic = apply_repeat_penalty(user_id, semantic, t_vec)

    # final blend
    final = (
        semantic * 0.65 +
        novelty * 0.20 +
        freshness * 0.15
    )

    return final


# =========================================================
# OPTIONAL HELPERS
# =========================================================

def log_interaction(user_id, track):
    vec = track_vector(track)
    update_memory(user_id, track.spotify_id, vec)


def normalize_scores(scores):
    if not scores:
        return scores

    mx = max(scores)
    mn = min(scores)

    return [(s - mn) / (mx - mn + 1e-9) for s in scores]
