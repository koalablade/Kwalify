"""
dj_engine.py — AI DJ ORCHESTRATOR (FINAL LAYER)

This is the missing link:
- pulls tracks
- enriches with features
- scores them
- ranks them
- returns final playlist
"""

from spotify_service import get_audio_features
from dj_scoring import rank_tracks
from mood_model import predict_mood


# ---------------------------------------------------
# BUILD AI DJ PLAYLIST
# ---------------------------------------------------

def generate_ai_playlist(sp, tracks, vibe="balanced", limit=25):
    """
    MAIN ENTRY POINT:
    takes raw Spotify tracks → returns ranked AI playlist
    """

    enriched_tracks = []

    for t in tracks:
        track_obj = type("Track", (), {})()

        track_obj.name = t.get("name")
        track_obj.artist = t.get("artist")

        # IMPORTANT: fallback defaults
        track_obj.energy = 0.5
        track_obj.valence = 0.5
        track_obj.danceability = 0.5
        track_obj.acousticness = 0.5
        track_obj.instrumentalness = 0.0
        track_obj.tempo = 120

        track_id = t.get("id")

        # -----------------------------
        # ENRICH WITH AUDIO FEATURES
        # -----------------------------
        if sp and track_id:
            features = get_audio_features(sp, track_id)

            if features:
                track_obj.energy = features.get("energy", 0.5)
                track_obj.valence = features.get("valence", 0.5)
                track_obj.danceability = features.get("danceability", 0.5)
                track_obj.acousticness = features.get("acousticness", 0.5)
                track_obj.instrumentalness = features.get("instrumentalness", 0.0)
                track_obj.tempo = features.get("tempo", 120)

        enriched_tracks.append(track_obj)

    # -----------------------------
    # SCORE + RANK
    # -----------------------------
    ranked = rank_tracks(enriched_tracks, vibe=vibe, limit=limit)

    return ranked
