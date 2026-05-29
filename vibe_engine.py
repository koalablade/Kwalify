import numpy as np
import hashlib

EMBED_DIM = 32


# -------------------------
# EMBEDDING (FAST + STABLE)
# -------------------------

def _hash(text):
    return int(hashlib.md5(text.encode()).hexdigest(), 16)


def embed(text):
    seed = _hash(text.lower())
    rng = np.random.default_rng(seed)

    vec = rng.normal(0, 1, EMBED_DIM)
    return vec / (np.linalg.norm(vec) + 1e-9)


# -------------------------
# TRACK VECTOR
# -------------------------

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
    ])

    return vec / (np.linalg.norm(vec) + 1e-9)


# -------------------------
# VIBE
# -------------------------

def interpret_vibe(text):
    return embed(text)


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


# -------------------------
# EMOTION TAGGING
# -------------------------

def get_emotion(vec):
    energy = vec[0]
    valence = vec[1]

    if valence > 0.7 and energy > 0.6:
        return "euphoric"
    if valence < 0.4 and energy < 0.4:
        return "melancholy"
    if energy > 0.75:
        return "intense"
    if valence > 0.65:
        return "warm"
    if energy < 0.3:
        return "nostalgic"

    return "neutral"


# -------------------------
# REPEAT PENALTY
# -------------------------

def apply_repeat_penalty(history, track_id, score):
    recent = [h.track_id for h in history[:10]]

    if track_id in recent:
        score *= 0.6

    return score


# -------------------------
# MAIN SCORING
# -------------------------

def hybrid_score(vibe_vec, track_vec, track):
    semantic = cosine(vibe_vec, track_vec)
    return semantic
