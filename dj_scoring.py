"""
dj_scoring.py — AI DJ ranking engine (CORE BRAIN)

Takes raw tracks + user vibe → returns ranked playlist
No randomness. Fully deterministic scoring.
"""

from mood_model import predict_mood, build_feature_vector


# ---------------------------------------------------
# VIBE → TARGET PROFILE MAP
# ---------------------------------------------------

VIBE_PROFILES = {
    "chill": {
        "energy": 0.3,
        "valence": 0.5,
        "danceability": 0.4,
    },
    "balanced": {
        "energy": 0.55,
        "valence": 0.55,
        "danceability": 0.5,
    },
    "happy": {
        "energy": 0.7,
        "valence": 0.85,
        "danceability": 0.7,
    },
    "sad": {
        "energy": 0.3,
        "valence": 0.2,
        "danceability": 0.3,
    },
    "intense": {
        "energy": 0.9,
        "valence": 0.6,
        "danceability": 0.8,
    }
}


# ---------------------------------------------------
# CORE SCORING FUNCTION
# ---------------------------------------------------

def score_track(track, vibe="balanced", user_history=None):
    """
    Returns a single AI DJ score for a track.
    Higher = better match.
    """

    profile = VIBE_PROFILES.get(vibe, VIBE_PROFILES["balanced"])

    # -------------------------
    # AUDIO VECTOR MATCH
    # -------------------------
    energy_diff = abs(track.energy - profile["energy"])
    valence_diff = abs(track.valence - profile["valence"])
    dance_diff = abs(track.danceability - profile["danceability"])

    audio_score = 1 - (
        (energy_diff * 0.4) +
        (valence_diff * 0.4) +
        (dance_diff * 0.2)
    )

    # -------------------------
    # MOOD ALIGNMENT BONUS
    # -------------------------
    mood = predict_mood(track)

    mood_bonus = {
        "euphoric": 0.15 if vibe in ["happy", "intense"] else 0.05,
        "happy": 0.12 if vibe in ["happy", "balanced"] else 0.03,
        "chill": 0.1 if vibe == "chill" else 0.02,
        "melancholy": 0.12 if vibe == "sad" else 0.03,
        "nostalgic": 0.08 if vibe in ["sad", "chill"] else 0.02,
        "intense": 0.12 if vibe == "intense" else 0.03,
        "neutral": 0.01,
    }.get(mood, 0.0)

    # -------------------------
    # TEMPO COHESION (soft control)
    # -------------------------
    tempo_score = 1 - min(abs(track.tempo - 120) / 120, 1)

    # -------------------------
    # FINAL SCORE
    # -------------------------
    score = (
        audio_score * 0.65 +
        tempo_score * 0.10 +
        mood_bonus
    )

    # clamp
    return max(0.0, min(1.0, score))


# ---------------------------------------------------
# RANKING ENGINE
# ---------------------------------------------------

def rank_tracks(tracks, vibe="balanced", limit=25):
    """
    Takes list of Track ORM objects or dicts
    Returns sorted list (best first)
    """

    scored = []

    for t in tracks:
        score = score_track(t, vibe=vibe)
        scored.append((t, score))

    scored.sort(key=lambda x: x[1], reverse=True)

    return [t for t, _ in scored[:limit]]


# ---------------------------------------------------
# SIMPLE DEBUG VIEW (optional)
# ---------------------------------------------------

def explain_track(track, vibe="balanced"):
    """
    Returns human-readable reasoning (for UI later)
    """

    profile = VIBE_PROFILES.get(vibe, VIBE_PROFILES["balanced"])

    return {
        "energy": track.energy,
        "valence": track.valence,
        "danceability": track.danceability,
        "tempo": track.tempo,
        "mood": predict_mood(track),
        "target_vibe": profile,
        "score": score_track(track, vibe),
    }