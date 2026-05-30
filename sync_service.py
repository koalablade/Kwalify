import datetime
import random
import time
import traceback
from spotipy.exceptions import SpotifyException
from log import log

LIKED_SONGS_LIMIT = 50
CONSECUTIVE_KNOWN_THRESHOLD = 20

def _jitter_sleep():
    time.sleep(random.uniform(0.3, 0.9))

def _fetch_page_safe(sp, offset, limit):
    _jitter_sleep()
    try:
        page = sp.current_user_saved_tracks(limit=limit, offset=offset)
        return (page or {}).get("items") or [], None
    except Exception as e:
        log("WARN", "sync", f"Spotify fetch failed: {str(e)}")
        return [], "error"

def _get_audio_features(sp, track_id):
    try:
        features = sp.audio_features([track_id])[0]
        return features if features else {}
    except:
        return {}

def _write_tracks_to_db(new_tracks, user, db):
    from models import Track, UserTrack
    
    # Wrap entire write operation in a single transaction
    try:
        for t in new_tracks:
            # Check for existing
            track_row = db.query(Track).filter_by(spotify_id=t["id"]).first()
            if not track_row:
                track_row = Track(
                    spotify_id=t["id"],
                    name=t["name"],
                    artist=t["artist"],
                    album=t.get("album", ""),
                    energy=t.get("energy", 0.5),
                    valence=t.get("valence", 0.5),
                    danceability=t.get("danceability", 0.5),
                    acousticness=t.get("acousticness", 0.5),
                    instrumentalness=t.get("instrumentalness", 0.0),
                    tempo=t.get("tempo", 120.0),
                )
                db.add(track_row)
                db.flush()

            # Create association
            exists = db.query(UserTrack).filter_by(user_id=user.id, track_id=track_row.id).first()
            if not exists:
                db.add(UserTrack(user_id=user.id, track_id=track_row.id, liked_at=t.get("liked_at")))
        
        db.commit()
    except Exception as e:
        db.rollback()
        log("ERROR", "sync", f"DB Write Failed: {str(e)}")
        raise e

def run_incremental_sync(spotify_user_id, sp, db):
    from models import User
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user: return

    new_tracks = []
    offset = 0
    
    while True:
        items, error = _fetch_page_safe(sp, offset, LIKED_SONGS_LIMIT)
        if error or not items: break
        
        for item in items:
            track = item.get("track") or {}
            tid = track.get("id")
            if not tid: continue
            
            features = _get_audio_features(sp, tid)
            new_tracks.append({
                "id": tid,
                "name": track.get("name", ""),
                "artist": (track.get("artists") or [{}])[0].get("name", ""),
                "album": (track.get("album") or {}).get("name", ""),
                "liked_at": item.get("added_at"),
                **features
            })
            
        offset += len(items)
        if len(items) < LIKED_SONGS_LIMIT: break
        
    if new_tracks:
        _write_tracks_to_db(new_tracks, user, db)
