import threading

from log import log
from database import get_session
from models import User, Track, UserTrack
from sync_service import run_incremental_sync


_sync_lock = threading.Lock()
_running = set()


# =========================
# LOAD TRACKS
# =========================
def load_user_tracks(user_id, db):
    user = db.query(User).filter_by(spotify_id=user_id).first()
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
            "name": t.name,
            "artist": t.artist,
            "energy": t.energy,
            "valence": t.valence,
        }
        for t in rows
    ]


# =========================
# SYNC STATUS
# =========================
def get_sync_status(user_id, db):
    user = db.query(User).filter_by(spotify_id=user_id).first()

    if not user:
        return {"status": "no_user", "track_count": 0}

    track_count = db.query(UserTrack).filter_by(user_id=user.id).count()

    return {
        "status": user.sync_status,
        "track_count": track_count,
        "sync_done": user.sync_done,
        "sync_total": user.sync_total
    }


# =========================
# SAFE SYNC RUNNER
# =========================
def _run(user_id, sp):
    with _sync_lock:
        if user_id in _running:
            return False
        _running.add(user_id)

    try:
        with get_session() as db:
            run_incremental_sync(user_id, sp, db)
        return True

    except Exception as e:
        log("ERROR", "sync", str(e))
        return False

    finally:
        with _sync_lock:
            _running.discard(user_id)


def start_sync_if_needed(user_id, sp=None):
    with get_session() as db:
        user = db.query(User).filter_by(spotify_id=user_id).first()
        if not user:
            return False

    return _run(user_id, sp)
