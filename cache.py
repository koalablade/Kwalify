"""
cache.py — SAFE STABLE VERSION (no UI changes, rate-limit protected)
"""

import datetime
import json
import threading
import time

from log import log
from models import Track, User, UserTrack


# =========================================================
# USER TRACKS
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
        }
        for t in rows
    ]


def get_or_create_user(spotify_user_id, db, display_name=None, token_info=None):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()

    if not user:
        user = User(spotify_id=spotify_user_id, sync_status="idle")
        db.add(user)

    if display_name:
        user.display_name = display_name

    if token_info:
        user.token_json = json.dumps(token_info)

    db.commit()
    return user


def needs_sync(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return True

    # prevents constant re-sync spam (IMPORTANT FOR SPOTIFY 429 PROTECTION)
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
# SIMPLE SAFE SYNC CONTROL
# =========================================================

_sync_lock = threading.Lock()
_sync_running = set()


def _run_sync(user_id, sp, db_factory, sync_fn):
    """safe wrapper for ANY sync function"""

    with _sync_lock:
        if user_id in _sync_running:
            log("INFO", "cache", "Sync already running — skipping", user=user_id)
            return False
        _sync_running.add(user_id)

    db = db_factory()

    try:
        sync_fn(user_id, sp, db)
        return True

    except Exception as e:
        log("ERROR", "cache", "Sync failed", user=user_id, exc=str(e))
        return False

    finally:
        db.close()
        with _sync_lock:
            _sync_running.discard(user_id)


# =========================================================
# PUBLIC SYNC FUNCTIONS (NO UI CHANGE REQUIRED)
# =========================================================

def start_sync_if_needed(user_id, sp, db_factory):
    from sync_service import run_incremental_sync

    db = db_factory()
    try:
        if not needs_sync(user_id, db):
            log("INFO", "cache", "No sync needed", user=user_id)
            return False
    finally:
        db.close()

    return _run_sync(user_id, sp, db_factory, run_incremental_sync)


def start_manual_sync(user_id, sp, db_factory):
    from sync_service import run_incremental_sync
    return _run_sync(user_id, sp, db_factory, run_incremental_sync)


def start_full_reset_sync(user_id, sp, db_factory):
    from sync_service import run_full_reset_sync
    return _run_sync(user_id, sp, db_factory, run_full_reset_sync)
