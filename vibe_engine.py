import numpy as np

# -------------------------------------------------
# SIMPLE SEMANTIC VIBE ENGINE (NO TRANSFORMERS)
# -------------------------------------------------

VIBE_MAP = {
    "chill": np.array([0.2, 0.8, 0.3]),
    "happy": np.array([0.8, 0.7, 0.6]),
    "sad": np.array([0.2, 0.2, 0.3]),
    "energetic": np.array([0.9, 0.6, 0.9]),
    "focus": np.array([0.3, 0.4, 0.2]),
}


def interpret_vibe(vibe_text: str):
    """
    Turns text into semantic-ish vector WITHOUT ML models.
    Stable, fast, deploy-safe.
    """

    v = vibe_text.lower().strip()

    # soft matching instead of keywords-only logic
    if any(x in v for x in ["chill", "relax", "calm"]):
        profile = VIBE_MAP["chill"]
        confidence = 0.7
        signals = ["relaxation cluster"]

    elif any(x in v for x in ["happy", "uplift", "good", "fun"]):
        profile = VIBE_MAP["happy"]
        confidence = 0.7
        signals = ["positive mood cluster"]

    elif any(x in v for x in ["sad", "down", "melancholy"]):
        profile = VIBE_MAP["sad"]
        confidence = 0.7
        signals = ["low mood cluster"]

    elif any(x in v for x in ["energy", "hype", "workout", "gym"]):
        profile = VIBE_MAP["energetic"]
        confidence = 0.8
        signals = ["high energy cluster"]

    elif any(x in v for x in ["focus", "study", "deep"]):
        profile = VIBE_MAP["focus"]
        confidence = 0.8
        signals = ["focus cluster"]

    else:
        profile = VIBE_MAP["chill"]
        confidence = 0.4
        signals = ["fallback cluster"]

    return profile, confidence, signals


def score_track(track, profile_vector):
    """
    Lightweight scoring using Spotify audio features.
    """

    features = np.array([
        track.get("energy", 0.5),
        track.get("valence", 0.5),
        track.get("danceability", 0.5),
    ])

    # cosine similarity (manual)
    dot = np.dot(features, profile_vector)
    norm = (np.linalg.norm(features) * np.linalg.norm(profile_vector)) + 1e-9

    return float(dot / norm)


def apply_repeat_penalty(track_id, history_map):
    """
    Penalise recently used tracks.
    """

    if track_id not in history_map:
        return 1.0

    days_old = (np.datetime64("now") - np.datetime64(history_map[track_id])).astype(int)

    if days_old < 1:
        return 0.2
    elif days_old < 7:
        return 0.6
    else:
        return 1.0
