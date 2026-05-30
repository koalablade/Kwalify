"""
sync_service.py — Incremental sync logic (AI-DJ ENABLED VERSION)
Fixed: Transaction handling and explicit database writing.
"""

import datetime
import random
import time

from spotipy.exceptions import SpotifyException
from log import log

LIKED_SONGS_LIMIT = 50
CONSECUTIVE_KNOWN_THRESHOLD = 20
RETRY_DELAY_MIN_MINUTES = 60
RETRY_DELAY_MAX_MINUTES = 120

# ---------------------------------------------------------------------------
# INTERNAL HELPERS
# ---------------------------------------------------------------------------

def _jitter_sleep():
    time.sleep(random.uniform(0.3, 0.9))

def _fetch_page_safe(sp, offset, limit):
    _jitter_sleep()
    try:
        page = sp.current_user_saved_tracks(limit=limit, offset=offset)
        return (page or {}).get("items") or [], None
    except SpotifyException as exc:
        status = getattr(exc, "http_status", None)
        if status == 429:
            return [], "429"
        if status == 403:
            log("WARN", "sync", "403 skipped", offset=offset)
            return [], "403"
        log("WARN", "sync", "Spotify error", offset=offset, status=status)
        return [], "other"
    except Exception as exc:
        log("ERROR", "sync", "Unexpected error", offset=offset, exc=str(exc))
        return [], "other"

def _parse_added_at(added_at_str):
    if not added_at_str:
        return None
    try:
        dt = datetime.datetime.fromisoformat(added_at_str.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    except Exception:
        return None

def _get_audio_features(sp, track_id):
    try:
        features = sp.audio_features([track_id])[0]
        if not features:
            return None
        return {
            "energy": features.get("energy", 0.5),
            "valence": features.get("valence", 0.5),
            "danceability": features.get("danceability", 0.5),
            "acousticness": features.get("acousticness", 0.5),
            "instrumentalness": features.get("instrumentalness", 0.0),
            "speechiness": features.get("speechiness", 0.0),
            "liveness": features.get("liveness", 0.0),
            "tempo": features.get("tempo", 120.0),
        }
    except Exception:
        return None

# ---------------------------------------------------------------------------
# WRITE TO DB (PATCHED)
# ---------------------------------------------------------------------------

def _write_tracks_to_db(new_tracks, user, existing_spotify_ids, db):
    from models import Track, UserTrack
    
    written_count = 0
    try:
        for t in new_tracks:
            tid = t["id"]
            if tid in existing_spotify_ids:
                continue

            # Ensure track exists in Tracks table
            track_row = db.query(Track).filter_by(spotify_id=tid).first()
            if not track_row:
                track_row = Track(
                    spotify_id=tid,
                    name=t["name"],
                    artist=t["artist"],
                    album=t.get("album", ""),
                    energy=t.get("energy", 0.5),
                    valence=t.get("valence", 0.5),
                    danceability=t.get("danceability", 0.5),
                    acousticness=t.get("acousticness", 0.5),
                    instrumentalness=t.get("instrumentalness", 0.0),
                    speechiness=t.get("speechiness", 0.0),
                    liveness=t.get("liveness", 0.0),
                    tempo=t.get("tempo", 120.0),
                )
                db.add(track_row)
                db.flush() # Essential: Generate ID before linking

            # Explicitly add the link
            new_link = UserTrack(
                user_id=user.id,
                track_id=track_row.id,
                liked_at=t.get("liked_at"),
            )
            db.add(new_link)
            
            existing_spotify_ids.add(tid)
            written_count += 1
        
        db.flush() # Validate all operations
        log("INFO", "sync", f"Successfully flushed {written_count} tracks to DB")
        return written_count

    except Exception as e:
        db.rollback()
        log("ERROR", "sync", f"Transaction failed: {str(e)}")
        raise e

# ---------------------------------------------------------------------------
# MAIN SYNC ENGINE
# ---------------------------------------------------------------------------

def run_incremental_sync(spotify_user_id, sp, db):
    from models import Track, User, UserTrack

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return

    if user.sync_retry_after and user.sync_retry_after > datetime.datetime.utcnow():
        return

    user.sync_status = "syncing"
    user.sync_retry_after = None
    db.commit()

    # Pre-fetch existing IDs
    existing_spotify_ids = {
        row[0] for row in db.query(Track.spotify_id)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    }

    new_tracks = []
    offset = 0
    consecutive_known = 0
    stop_reason = None
    last_sync_at = user.last_sync_at

    while True:
        items, error = _fetch_page_safe(sp, offset, LIKED_SONGS_LIMIT)

        if error == "429":
            user.sync_status = "rate_limited"
            user.sync_retry_after = datetime.datetime.utcnow() + datetime.timedelta(minutes=60)
            db.commit()
            return

        if error in ("403", "other"):
            break

        if not items:
            break

        for item in items:
            track = item.get("track") or {}
            tid = track.get("id")
            if not tid:
                continue

            liked_at = _parse_added_at(item.get("added_at"))

            if last_sync_at and liked_at and liked_at <= last_sync_at:
                stop_reason = "time_cutoff"
                break

            if tid in existing_spotify_ids:
                consecutive_known += 1
                if consecutive_known >= CONSECUTIVE_KNOWN_THRESHOLD:
                    stop_reason = "overlap"
                    break
                continue
            else:
                consecutive_known = 0

            features = _get_audio_features(sp, tid)
            new_tracks.append({
                "id": tid,
                "name": track.get("name", ""),
                "artist": (track.get("artists") or [{}])[0].get("name", ""),
                "album": (track.get("album") or {}).get("name", ""),
                "liked_at": liked_at,
                "energy": features["energy"] if features else 0.5,
                "valence": features["valence"] if features else 0.5,
                "danceability": features["danceability"] if features else 0.5,
                "acousticness": features["acousticness"] if features else 0.5,
                "instrumentalness": features["instrumentalness"] if features else 0.0,
                "tempo": features["tempo"] if features else 120.0,
            })

        user.sync_done = len(existing_spotify_ids) + len(new_tracks)
        db.commit()

        if stop_reason:
            break

        offset += len(items)
        if len(items) < LIKED_SONGS_LIMIT:
            break

    # Final write to DB
    if new_tracks:
        _write_tracks_to_db(new_tracks, user, existing_spotify_ids, db)

    user.sync_total = db.query(UserTrack).filter_by(user_id=user.id).count()
    user.sync_done = user.sync_total
    user.sync_status = "done"

    if stop_reason:
        user.last_sync_at = datetime.datetime.utcnow()

    db.commit()
