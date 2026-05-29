# vibe_engine.py

import numpy as np
from functools import lru_cache
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


# =========================================================
# MODEL (loaded once, Render-safe)
# =========================================================

@lru_cache(maxsize=1)
def get_model():
    return SentenceTransformer("all-MiniLM-L6-v2")


# =========================================================
# VIBE → EMBEDDING
# =========================================================

def interpret_vibe(vibe_text: str):
    model = get_model()
    return model.encode(vibe_text, normalize_embeddings=True)


# =========================================================
# TRACK → SEMANTIC TEXT
# =========================================================

def track_to_text(track):
    return (
        f"{track.name}. "
        f"{track.artist}. "
        f"{track.album}. "
        f"energy {track.energy}. "
        f"valence {track.valence}. "
        f"tempo {track.tempo}. "
        f"danceability {track.danceability}. "
        f"acousticness {track.acousticness}. "
        f"instrumentalness {track.instrumentalness}. "
        f"speechiness {track.speechiness}. "
        f"liveness {track.liveness}."
    )


# =========================================================
# SCORING (semantic similarity)
# =========================================================

def score_track(vibe_embedding, track):
    model = get_model()

    track_text = track_to_text(track)
    track_embedding = model.encode(track_text, normalize_embeddings=True)

    score = cosine_similarity(
        [vibe_embedding],
        [track_embedding]
    )[0][0]

    return float(score)


# =========================================================
# REPETITION PENALTY
# =========================================================

def apply_repeat_penalty(score, already_used, track_id):
    if track_id in already_used:
        return score * 0.15
    return score
