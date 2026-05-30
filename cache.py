import threading
from log import log
from database import get_db
from models import User, Track, UserTrack
from sync_service import run_incremental_sync

def load_user_tracks(spotify_user_id, db):
    """Fetches tracks using a joined query for efficiency."""
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
    """Returns the current state from the DB."""
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return {"status": "no_user", "track_count": 0}

    # Optimization: Aggregate count from DB directly
    track_count = db.query(UserTrack).filter_by(user_id=user.id).count()

    return {
        "status": user.sync_status,
        "track_count": track_count,
        "sync_done": getattr(user, 'sync_done', 0),
        "sync_total": getattr(user, 'sync_total', 0),
        "last_sync_at": getattr(user, 'last_sync_at', None)
    }

def start_sync_if_needed(spotify_user_id, sp):
    """
    Checks DB 'sync_status' instead of in-memory locks.
    """
    db = get_db()
    try:
        user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
        if not user or user.sync_status == "syncing":
            return False
        
        # Mark as syncing immediately to prevent race conditions
        user.sync_status = "syncing"
        db.commit()
    finally:
        db.close()

    # Trigger background thread
    threading.Thread(target=_worker_thread, args=(spotify_user_id, sp), daemon=True).start()
    return True

def _worker_thread(spotify_user_id, sp):
    """Handles the sync logic and ensures status is updated after completion."""
    db = get_db()
    try:
        run_incremental_sync(spotify_user_id, sp, db)
        # Update user status to complete
        user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
        if user:
            user.sync_status = "completed"
            db.commit()
    except Exception as e:
        log("ERROR", "sync", str(e))
        # Update user status to error
        user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
        if user:
            user.sync_status = "error"
            db.commit()
    finally:
        db.close()

def is_syncing(user_id, db):
    """Checks the database for the current sync status."""
    user = db.query(User).filter_by(spotify_id=user_id).first()
    return user is not None and user.sync_status == "syncing"
