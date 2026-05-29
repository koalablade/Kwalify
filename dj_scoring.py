"""
dj_scoring.py — AI DJ TRACK RANKING ENGINE
"""

import math


# =========================
# CORE SCORING FUNCTION
# =========================
def score_track(track, vibe="balanced"):
    """
    Converts audio features into a single score.
    """

    energy = getattr(track, "energy", 0.5)
    valence = getattr(track, "valence", 0.5)
    danceability = getattr(track, "danceability", 0.5)
    acousticness = getattr(track, "acousticness", 0.5)
    tempo = getattr(track, "tempo", 120)

    # -------------------------
    # VIBE WEIGHTS
    # -------------------------
    if vibe == "hype":
        score = (energy * 0.5) + (danceability * 0.3) + (valence * 0.2)

    elif vibe == "chill":
        score = (acousticness * 0.4) + (valence * 0.4) + ((1 - energy) * 0.2)

    elif vibe == "focus":
        score = (acousticness * 0.5) + ((1 - valence) * 0.2) + (energy * 0.3)

    else:  # balanced
        score = (energy + valence + danceability) / 3

    # small tempo smoothing
    score += math.exp(-abs(tempo - 120) / 200) * 0.05

    return score


# =========================
# RANK TRACKS (THIS FIXES YOUR ERROR)
# =========================
def rank_tracks(tracks, vibe="balanced", limit=25):
    """
    Main AI DJ ranking function.
    """

    scored = []

    for t in tracks:
        s = score_track(t, vibe=vibe)
        scored.append((s, t))

    scored.sort(key=lambda x: x[0], reverse=True)

    return [t for _, t in scored][:limit]


# =========================
# OPTIONAL MOOD DETECTION (SAFE)
# =========================
def detect_session_mood(tracks):
    """
    Simple mood guess based on average energy/valence.
    """

    if not tracks:
        return "balanced_session"

    avg_energy = sum(getattr(t, "energy", 0.5) for t in tracks) / len(tracks)
    avg_valence = sum(getattr(t, "valence", 0.5) for t in tracks) / len(tracks)

    if avg_energy > 0.7:
        return "hype_session"

    if avg_energy < 0.4:
        return "sad_session"

    if avg_valence < 0.4:
        return "focus_session"

    return "balanced_session"
