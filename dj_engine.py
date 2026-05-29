from spotify_service import get_audio_features
from dj_scoring import rank_tracks


def generate_ai_playlist(sp, tracks, vibe="balanced", limit=25):
    enriched_tracks = []

    for t in tracks:

        track_obj = {
            "id": t.get("id"),
            "name": t.get("name"),
            "artist": t.get("artist"),

            # defaults
            "energy": 0.5,
            "valence": 0.5,
            "danceability": 0.5,
            "acousticness": 0.5,
            "instrumentalness": 0.0,
            "tempo": 120
        }

        track_id = t.get("id")

        if sp and track_id:
            features = get_audio_features(sp, track_id)
            if features:
                track_obj.update(features)

        enriched_tracks.append(track_obj)

    ranked = rank_tracks(enriched_tracks, vibe=vibe, limit=limit)

    return ranked
