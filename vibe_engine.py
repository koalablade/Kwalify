# vibe_engine.py

import numpy as np
from functools import lru_cache
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Load once (critical for Render stability)
@lru_cache(maxsize=1)
def get_model():
    return SentenceTransformer("all-MiniLM-L6-v2")


def interpret_vibe(vibe_text: str):
    """
    Converts any user input into semantic embedding.
    """
    model = get_model()
    return model.encode([vibe_text])[0]


def track_to_text(track):
    """
    Converts Spotify track + audio features into semantic text.
    """
    return f"""
    song: {track.name}
    artist: {track.artist}
    album: {track.album}
    energy: {track.energy}
    valence: {track.valence}
    tempo: {track.tempo}
    danceability: {track.danceability}
    acousticness: {track.acousticness}
    instrumentalness: {track.instrumentalness}
    speechiness: {track.speechiness}
    liveness: {track.liveness}
    """.strip()


def score_track(vibe_embedding, track):
    """
    Returns semantic similarity score (0-1)
    """
    model = get_model()

    track_text = track_to_text(track)
    track_embedding = model.encode([track_text])[0]

    score = cosine_similarity(
        [vibe_embedding],
        [track_embedding]
    )[0][0]

    return float(score)


def apply_repeat_penalty(score, already_used, track_id):
    """
    Prevents spam repetition in playlists
    """
    if track_id in already_used:
        return score * 0.2
    return score
