import numpy as np

# =========================================================
# SAFE SEMANTIC VIBE ENGINE (NO EXTERNAL ML DEPENDENCIES)
# =========================================================

VIBE_VECTORS = {
    "chill": np.array([0.2, 0.8, 0.3]),
    "happy": np.array([0.9, 0.7, 0.6]),
    "sad": np.array([0.2, 0.2, 0.3]),
    "energetic": np.array([0.9, 0.6, 0.9]),
    "focus": np.array([0.3, 0.4, 0.2]),
}


def interpret_vibe(vibe_text: str):
    """
    Lightweight semantic mapping (NO transformers, NO embeddings libs).
    Stable for Render.
    """

    v = vibe_text.lower()

    if any(x in v for x in ["chill", "relax", "calm", "lofi"]):
        return VIBE_VECTORS["chill"], 0.75, ["relax cluster"]

    if any(x in v for x in ["happy", "uplift", "fun", "good vibes"]):
        return VIBE_VECTORS["happy"], 0.75, ["positive cluster"]

    if any(x in v for x in ["sad", "melancholy", "down"]):
        return VIBE_VECTORS["sad"], 0.75, ["low mood cluster"]

    if any(x in v for x in ["gym", "workout", "energy", "hype"]):
        return VIBE_VECTORS["energetic"], 0.85, ["high energy cluster"]

    if any(x in v for x in ["focus", "study", "deep"]):
        return VIBE_VECTORS["focus"], 0.85, ["focus cluster"]

    return VIBE_VECTORS["chill"], 0.4, ["fallback"]


def score_track(track, vibe_vector):
    """
    Uses Spotify audio features only.
    No ML required.
    """

    features = np.array([
        track.get("energy", 0.5),
        track.get("valence", 0.5),
        track.get("danceability", 0.5),
    ])

    dot = np.dot(features, vibe_vector)
    norm = (np.linalg.norm(features) * np.linalg.norm(vibe_vector)) + 1e-9

    return float(dot / norm)


def apply_repeat_penalty(track_id, history_map):
    """
    Simple decay-based penalty.
    """

    if track_id not in history_map:
        return 1.0

    return 0.3  # simple safe penalty for now
