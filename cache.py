import threading
from log import log
from database import get_db
from models import User, Track, UserTrack
from sync_service import run_incremental_sync

_sync_lock = threading.Lock()
_running = set()


def load_user_tracks(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return []

    return (
        db.query(Track)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    )


def get_sync_status(spotify_user_id, db):
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()

    if not user:
        return {"status": "no_user", "track_count": 0}

    track_count = db.query(UserTrack).filter_by(user_id=user.id).count()

    return {
        "status": user.sync_status,
        "track_count": track_count,
        "sync_done": user.sync_done,
        "sync_total": user.sync_total,
        "last_sync_at": user.last_sync_at
    }


def _run_in_thread(spotify_user_id, sp):
    with _sync_lock:
        if spotify_user_id in _running:
            return
        _running.add(spotify_user_id)

    def worker():
        db = get_db()
        try:
            run_incremental_sync(spotify_user_id, sp, db)
        except Exception as e:
            log("ERROR", "sync", str(e))
        finally:
            db.close()
            with _sync_lock:
                _running.discard(spotify_user_id)

    threading.Thread(target=worker, daemon=True).start()


def start_sync_if_needed(spotify_user_id, sp=None):
    if not sp:
        return False

    db = get_db()
    try:
        user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
        if not user:
            return False
    finally:
        db.close()

    _run_in_thread(spotify_user_id, sp)
    return True


def is_syncing(user_id):
    with _sync_lock:
        return user_id in _running
