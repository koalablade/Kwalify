# vibe_engine.py

import numpy as np
from functools import lru_cache
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


# =========================================================
# MODEL (cached for Render stability)
# =========================================================

@lru_cache(maxsize=1)
def get_model():
    return SentenceTransformer("all-MiniLM-L6-v2")


# =========================================================
# VIBE EMBEDDING
# =========================================================

def interpret_vibe(vibe_text: str):
    model = get_model()
    return model.encode(vibe_text, normalize_embeddings=True)


# =========================================================
# TRACK TEXT CONVERSION
# =========================================================

def track_to_text(track):
    return (
        f"{track.name}. {track.artist}. {track.album}. "
        f"energy {track.energy}. valence {track.valence}. "
        f"danceability {track.danceability}. acoustic {track.acousticness}. "
        f"instrumental {track.instrumentalness}."
    )


# =========================================================
# BASE SEMANTIC SCORE
# =========================================================

def score_track(vibe_embedding, track):
    model = get_model()

    track_embedding = model.encode(
        track_to_text(track),
        normalize_embeddings=True
    )

    score = cosine_similarity(
        [vibe_embedding],
        [track_embedding]
    )[0][0]

    return float(score)


# =========================================================
# 🔥 EMOTIONAL REPETITION PREVENTION
# =========================================================

def emotional_diversity_penalty(track_embedding, recent_embeddings):
    """
    Reduces score if track is too emotionally similar
    to already selected tracks.
    """

    if not recent_embeddings:
        return 1.0

    similarities = cosine_similarity(
        [track_embedding],
        recent_embeddings
    )[0]

    max_similarity = np.max(similarities)

    # If too similar → reduce score
    if max_similarity > 0.88:
        return 0.65
    elif max_similarity > 0.80:
        return 0.80
    elif max_similarity > 0.72:
        return 0.92

    return 1.0


# =========================================================
# FINAL SCORING WRAPPER
# =========================================================

def score_track_with_diversity(vibe_embedding, track, recent_embeddings):
    model = get_model()

    base = score_track(vibe_embedding, track)

    track_embedding = model.encode(
        track_to_text(track),
        normalize_embeddings=True
    )

    diversity_multiplier = emotional_diversity_penalty(
        track_embedding,
        recent_embeddings
    )

    return base * diversity_multiplier


# =========================================================
# REPEAT PENALTY (existing safety layer)
# =========================================================

def apply_repeat_penalty(score, already_used, track_id):
    if track_id in already_used:
        return score * 0.15
    return score
