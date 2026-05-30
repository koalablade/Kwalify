from dj_scoring import rank_tracks

def generate_ai_playlist(sp, tracks, vibe="balanced", limit=25):
    # 1. Extract all IDs
    track_ids = [t.get("id") for t in tracks if t.get("id")]
    
    # 2. Batch fetch features (100 at a time is the Spotify limit)
    all_features = {}
    for i in range(0, len(track_ids), 100):
        chunk = track_ids[i:i + 100]
        results = sp.audio_features(chunk)
        
        # results is a list; map them back to their IDs
        for feature in results:
            if feature:
                all_features[feature['id']] = feature

    # 3. Enrich the tracks using the pre-fetched features
    enriched_tracks = []
    for t in tracks:
        track_id = t.get("id")
        # Get features from our dictionary, or default to standard values
        features = all_features.get(track_id, {})
        
        track_obj = {
            "id": track_id,
            "name": t.get("name"),
            "artist": t.get("artist"),
            "energy": features.get("energy", 0.5),
            "valence": features.get("valence", 0.5),
            "danceability": features.get("danceability", 0.5),
            "acousticness": features.get("acousticness", 0.5),
            "instrumentalness": features.get("instrumentalness", 0.0),
            "tempo": features.get("tempo", 120)
        }
        enriched_tracks.append(track_obj)

    # 4. Rank and return
    return rank_tracks(enriched_tracks, vibe=vibe, limit=limit)
