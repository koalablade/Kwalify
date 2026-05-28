"""
cache.py — DB-backed cache helpers and background sync orchestration.
"""

import datetime
import json
import threading
import time
import traceback

from log import log
from models import Track, User, UserTrack


# =========================================================
# LOAD TRACKS
# =========================================================

def load_user_tracks(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return []

    rows = (
        db.query(Track)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    )

    return [
        {
            "id": t.spotify_id,
            "name": t.name or "",
            "artist": t.artist or "",
            "album": t.album or "",
            "energy": t.energy,
            "valence": t.valence,
            "tempo": t.tempo,
            "danceability": t.danceability,
            "acousticness": t.acousticness,
            "speechiness": t.speechiness,
            "instrumentalness": t.instrumentalness,
        }
        for t in rows
    ]


# =========================================================
# USER
# =========================================================

def get_or_create_user(spotify_user_id, db, display_name=None, token_info=None):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()

    if not user:
        user = User(spotify_id=spotify_user_id, sync_status="idle")
        db.add(user)

    if display_name is not None:
        user.display_name = display_name

    if token_info is not None:
        user.token_json = json.dumps(token_info)

    db.commit()
    return user


def needs_sync(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return True

    if user.sync_retry_after and user.sync_retry_after > datetime.datetime.utcnow():
        return False

    count = db.query(UserTrack).filter_by(user_id=user.id).count()
    if count == 0:
        return True

    if not user.last_sync_at:
        return True

    return False


def get_sync_status(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return {"status": "no_user", "track_count": 0}

    track_count = db.query(UserTrack).filter_by(user_id=user.id).count()

    return {
        "status": user.sync_status or "idle",
        "track_count": track_count,
        "sync_total": user.sync_total or 0,
        "sync_done": user.sync_done or 0,
        "last_sync_at": user.last_sync_at.isoformat() if user.last_sync_at else None,
        "sync_retry_after": user.sync_retry_after.isoformat() if user.sync_retry_after else None,
    }


# =========================================================
# SIMPLE SYNC RUNNER (CLEAN VERSION)
# =========================================================

def run_sync(spotify_user_id, sp, db_factory, reset=False):
    """
    Single unified sync function:
    - reset=False → incremental sync
    - reset=True  → full reset sync
    """

    db = db_factory()

    try:
        if reset:
            from sync_service import run_full_reset_sync
            log("INFO", "cache", "Starting FULL RESET sync", user=spotify_user_id)
            run_full_reset_sync(spotify_user_id, sp, db)
        else:
            from sync_service import run_incremental_sync
            log("INFO", "cache", "Starting INCREMENTAL sync", user=spotify_user_id)
            run_incremental_sync(spotify_user_id, sp, db)

        log("INFO", "cache", "Sync finished", user=spotify_user_id)
        return True

    except Exception as exc:
        log("ERROR", "cache", "Sync failed", user=spotify_user_id, exc=str(exc))
        traceback.print_exc()

        try:
            user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
            if user:
                user.sync_status = "error"
                db.commit()
        except Exception:
            pass

        return False

    finally:
        db.close()


# =========================================================
# BACKWARDS COMPAT (so your app.py doesn’t break)
# =========================================================

def start_sync_if_needed(spotify_user_id, sp, db_factory):
    if not needs_sync(spotify_user_id, db_factory()):
        log("INFO", "cache", "No sync needed", user=spotify_user_id)
        return False

    return run_sync(spotify_user_id, sp, db_factory, reset=False)


def start_full_reset_sync(spotify_user_id, sp, db_factory):
    return run_sync(spotify_user_id, sp, db_factory, reset=True)

import time
import threading

_sync_lock = threading.Lock()
_sync_start_times = {}
_syncing_users = set()

def get_active_syncs():
    now = time.time()
    with _sync_lock:
        return {
            uid: round(now - start, 1)
            for uid, start in _sync_start_times.items()
        }
