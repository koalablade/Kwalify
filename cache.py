"""
cache.py — DB-backed cache helpers and background sync orchestration.
"""

import datetime
import json
import os
import threading
import time
import traceback

from log import log
from models import Track, User, UserTrack


# =========================================================
# DB HELPERS
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

    tracks_with_features = (
        db.query(Track)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id, Track.energy.isnot(None))
        .count()
    )

    return {
        "status": user.sync_status or "idle",
        "track_count": track_count,
        "tracks_with_features": tracks_with_features,
        "sync_total": user.sync_total or 0,
        "sync_done": user.sync_done or 0,
        "last_sync_at": user.last_sync_at.isoformat() if user.last_sync_at else None,
        "sync_retry_after": user.sync_retry_after.isoformat() if user.sync_retry_after else None,
    }


# =========================================================
# SYNC STATE
# =========================================================

_sync_lock = threading.Lock()
_syncing_users = set()
_sync_start_times = {}
_STALE_TIMEOUT = 7200


def get_active_syncs():
    now = time.time()
    with _sync_lock:
        return {
            uid: round(now - start, 0)
            for uid, start in _sync_start_times.items()
        }


def _launch_sync_thread(user_id, fn):
    with _sync_lock:
        now = time.time()

        stale = [
            u for u, t in _sync_start_times.items()
            if now - t > _STALE_TIMEOUT
        ]
        for u in stale:
            _syncing_users.discard(u)
            _sync_start_times.pop(u, None)

        if user_id in _syncing_users:
            return False

        _syncing_users.add(user_id)
        _sync_start_times[user_id] = now

    def runner():
        try:
            fn()
        except Exception as exc:
            log("ERROR", "cache", "Sync thread crash", user=user_id, exc=str(exc))
            traceback.print_exc()
        finally:
            with _sync_lock:
                _syncing_users.discard(user_id)
                _sync_start_times.pop(user_id, None)

    threading.Thread(target=runner, daemon=True).start()
    return True


# =========================================================
# SYNC STARTERS
# =========================================================

def start_sync_if_needed(user_id, sp, db_factory):
    from sync_service import run_incremental_sync

    tmp = db_factory()
    try:
        if not needs_sync(user_id, tmp):
            return
    finally:
        tmp.close()

    def fn():
        db = db_factory()
        try:
            run_incremental_sync(user_id, sp, db)
        finally:
            db.close()

    _launch_sync_thread(user_id, fn)


def start_manual_sync(user_id, sp, db_factory):
    from sync_service import run_incremental_sync

    def fn():
        db = db_factory()
        try:
            run_incremental_sync(user_id, sp, db)
        finally:
            db.close()

    return _launch_sync_thread(user_id, fn)


def start_full_reset_sync(user_id, sp, db_factory):
    from sync_service import run_full_reset_sync

    def fn():
        db = db_factory()
        try:
            run_full_reset_sync(user_id, sp, db)
        finally:
            db.close()

    return _launch_sync_thread(user_id, fn)


# =========================================================
# LEGACY MIGRATION
# =========================================================

def migrate_json_cache(json_path, user_id, db):
    if not os.path.exists(json_path):
        return 0

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    user = db.query(User).filter_by(spotify_id=user_id).first()
    if not user:
        return 0

    existing = {
        r[0]
        for r in db.query(Track.spotify_id)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    }

    added = 0

    for t in data:
        sid = t.get("id")
        if not sid or sid in existing:
            continue

        track = db.query(Track).filter_by(spotify_id=sid).first()

        if not track:
            track = Track(
                spotify_id=sid,
                name=t.get("name"),
                artist=t.get("artist"),
                album=t.get("album"),
                energy=t.get("energy"),
                valence=t.get("valence"),
                tempo=t.get("tempo"),
                danceability=t.get("danceability"),
                acousticness=t.get("acousticness"),
                speechiness=t.get("speechiness"),
                instrumentalness=t.get("instrumentalness"),
            )
            db.add(track)
            db.flush()

        db.add(UserTrack(user_id=user.id, track_id=track.id))
        existing.add(sid)
        added += 1

    if added:
        user.last_sync_at = datetime.datetime.utcnow()
        user.sync_status = "done"
        db.commit()

    return added
