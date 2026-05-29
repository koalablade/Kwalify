"""
vibe_engine.py — semantic embedding-based vibe system
(no keyword rules, real meaning comparison)
"""

import numpy as np
from sentence_transformers import SentenceTransformer


# ---------------------------------------------------------
# lightweight model (fast + good enough for vibe matching)
# ---------------------------------------------------------

_model = SentenceTransformer("all-MiniLM-L6-v2")


# ---------------------------------------------------------
# vibe anchors (semantic meaning buckets)
# ---------------------------------------------------------

VIBE_ANCHORS = {
    "chill": "calm relaxed soft mellow peaceful music",
    "focus": "study concentration deep work instrumental minimal",
    "happy": "uplifting joyful bright positive energetic fun",
    "sad": "emotional melancholic deep reflective sorrowful",
    "gym": "high energy workout aggressive pumping intense fast",
    "party": "dance upbeat club electronic energetic loud",
    "night_drive": "late night driving atmospheric reflective ambient",
}


# pre-encode anchors once (FAST at runtime)
_anchor_embeddings = {
    k: _model.encode(v)
    for k, v in VIBE_ANCHORS.items()
}


# ---------------------------------------------------------
# helpers
# ---------------------------------------------------------

def _cosine(a, b):
    a = np.array(a)
    b = np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


# ---------------------------------------------------------
# MAIN VIBE INTERPRETER
# ---------------------------------------------------------

def interpret_vibe(text: str):
    """
    Returns:
    - profile (energy/valence-like mapping)
    - confidence
    - signals
    """

    if not text:
        text = "chill music"

    emb = _model.encode(text)

    # find closest vibe anchor
    best_vibe = None
    best_score = -1

    for vibe, v_emb in _anchor_embeddings.items():
        score = _cosine(emb, v_emb)
        if score > best_score:
            best_score = score
            best_vibe = vibe

    # map vibe → numeric profile
    profile = _vibe_to_profile(best_vibe)

    confidence = max(0.4, min(0.95, best_score))

    signals = {
        "input": text,
        "matched_vibe": best_vibe,
        "similarity": best_score,
    }

    return profile, confidence, signals


# ---------------------------------------------------------
# vibe → spotify feature profile
# ---------------------------------------------------------

def _vibe_to_profile(vibe):
    mapping = {
        "chill":        (0.3, 0.5),
        "focus":        (0.2, 0.4),
        "happy":        (0.7, 0.8),
        "sad":          (0.2, 0.3),
        "gym":          (0.95, 0.6),
        "party":        (0.9, 0.8),
        "night_drive":  (0.5, 0.4),
    }

    energy, valence = mapping.get(vibe, (0.5, 0.5))

    return {
        "energy": energy,
        "valence": valence,
        "danceability": energy * 0.8,
        "acousticness": 1.0 - energy,
    }


# ---------------------------------------------------------
# scoring (unchanged logic, now driven by semantics)
# ---------------------------------------------------------

def score_track(track, profile):
    return (
        track.get("energy", 0.5) * profile["energy"] +
        track.get("valence", 0.5) * profile["valence"] +
        track.get("danceability", 0.5) * profile["danceability"]
    )


def apply_repeat_penalty(track_id, history_map):
    return 0.4 if track_id in history_map else 1.0
