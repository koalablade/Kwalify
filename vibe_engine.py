"""
vibe_engine.py — K_WALAH semantic + emotional + fast scoring engine
Render-safe, no heavy ML dependencies
"""

import time
import hashlib
import numpy as np
from collections import defaultdict, deque

# =========================================================
# CONFIG
# =========================================================

EMBED_DIM = 32
CACHE_SIZE = 2000

# =========================================================
# MEMORY (FAST LOOKUPS ONLY)
# =========================================================

_user_memory = defaultdict(lambda: {
    "recent_tracks": deque(maxlen=50),
    "last_seen": {}
})

_user_emotion_history = defaultdict(lambda: deque(maxlen=12))

_embedding_cache = {}

# =========================================================
# FAST EMBEDDING (NO ML LIBS)
# =========================================================

def _hash(text: str):
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)


def embed_text(text: str):
    """
    Fast deterministic embedding (cached).
    """
    text = text.lower().strip()

    if text in _embedding_cache:
        return _embedding_cache[text]

    seed = _hash(text)
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    vec = vec / (np.linalg.norm(vec) + 1e-9)

    if len(_embedding_cache) > CACHE_SIZE:
        _embedding_cache.clear()

    _embedding_cache[text] = vec
    return vec


# =========================================================
# TRACK VECTOR (NORMALISED FEATURES)
# =========================================================

def track_vector(track):
    return np.array([
        track.energy or 0.5,
        track.valence or 0.5,
        track.danceability or 0.5,
        track.acousticness or 0.5,
        track.instrumentalness or 0.0,
        track.speechiness or 0.0,
        track.liveness or 0.0,
        (track.tempo or 120) / 200
    ], dtype=float)


# =========================================================
# COSINE SIMILARITY
# =========================================================

def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# =========================================================
# EMOTION CLASSIFICATION (NEW)
# =========================================================

def detect_emotion(vec):
    energy = vec[0]
    valence = vec[1]
    acoustic = vec[3]

    if valence > 0.65 and energy > 0.6:
        return "happy"
    if valence < 0.35 and energy < 0.4:
        return "sad"
    if acoustic > 0.7 and valence < 0.55:
        return "nostalgic"
    if energy > 0.75:
        return "energetic"
    return "calm"


# =========================================================
# REPETITION CONTROL (FIXED + STRONGER)
# =========================================================

def apply_repeat_penalty(user_id, score, track_vec):
    history = _user_emotion_history[user_id]
    emotion = detect_emotion(track_vec)

    if len(history) >= 3 and history[-1] == emotion:
        score *= 0.78

    if len(history) >= 6 and list(history)[-3:] == [emotion] * 3:
        score *= 0.55

    history.append(emotion)
    return score


# =========================================================
# MEMORY UPDATE (FAST)
# =========================================================

def update_memory(user_id, track_id, track_vec):
    mem = _user_memory[user_id]
    mem["recent_tracks"].append(track_id)
    mem["last_seen"][track_id] = time.time()


# =========================================================
# FAST NOVELTY SCORE (O(1))
# =========================================================

def novelty_score(user_id, track_id):
    mem = _user_memory[user_id]

    if track_id in mem["recent_tracks"]:
        idx = list(mem["recent_tracks"]).index(track_id)
        return max(0.0, 1.0 - idx / 50)

    return 1.0


# =========================================================
# FRESHNESS SCORE (TIME-BASED)
# =========================================================

def freshness_score(user_id, track_id):
    mem = _user_memory[user_id]
    last = mem["last_seen"].get(track_id)

    if not last:
        return 0.3  # slight bias for new tracks

    age_days = (time.time() - last) / 86400
    return max(0.0, 1.0 - age_days / 10)


# =========================================================
# VIBE INTERPRETER
# =========================================================

def interpret_vibe(vibe_text: str):
    return embed_text(vibe_text)


# =========================================================
# HYBRID SCORING (FAST + SMART)
# =========================================================

def hybrid_score(user_id, vibe_vec, track):
    t_vec = track_vector(track)

    # semantic match
    semantic = cosine(vibe_vec, t_vec)

    # fast signals
    novelty = novelty_score(user_id, track.spotify_id)
    freshness = freshness_score(user_id, track.spotify_id)

    # emotion shaping
    semantic = apply_repeat_penalty(user_id, semantic, t_vec)

    # weighted blend (stable + tunable)
    score = (
        semantic * 0.68 +
        novelty * 0.20 +
        freshness * 0.12
    )

    return score


# =========================================================
# BATCH FAST SCORING (IMPORTANT OPTIMIZATION)
# =========================================================

def score_tracks_fast(user_id, vibe_vec, tracks):
    """
    Avoid heavy recompute loops elsewhere.
    Single-pass scoring.
    """
    results = []

    for t in tracks:
        score = hybrid_score(user_id, vibe_vec, t)
        results.append((score, t))

    results.sort(key=lambda x: x[0], reverse=True)
    return results


# =========================================================
# OPTIONAL LOGGING
# =========================================================

def log_interaction(user_id, track):
    vec = track_vector(track)
    update_memory(user_id, track.spotify_id, vec)
