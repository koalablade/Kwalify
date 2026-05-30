import threading
import traceback
from database import get_db
from sync_service import run_incremental_sync
from log import log

def load_user_tracks(spotify_user_id, db):
    from models import User, Track, UserTrack
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user: return []
    return db.query(Track).join(UserTrack).filter(UserTrack.user_id == user.id).all()

def get_sync_status(spotify_user_id, db):
    from models import User, UserTrack
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user: return {"status": "no_user", "track_count": 0}
    
    count = db.query(UserTrack).filter_by(user_id=user.id).count()
    return {
        "status": user.sync_status,
        "track_count": count,
        "sync_done": getattr(user, 'sync_done', 0),
        "sync_total": getattr(user, 'sync_total', 0)
    }

def start_sync_if_needed(spotify_user_id, sp):
    db = get_db()
    from models import User
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    
    # Only allow sync if current status is NOT syncing
    if user and user.sync_status != "syncing":
        user.sync_status = "syncing"
        db.commit()
        db.close()
        
        # Fire and forget thread
        threading.Thread(target=_worker_thread, args=(spotify_user_id, sp), daemon=True).start()
        return True
    
    db.close()
    return False

def _worker_thread(user_id, sp):
    db = get_db()
    from models import User
    try:
        run_incremental_sync(user_id, sp, db)
        log("INFO", "sync", f"Sync finished for {user_id}")
    except Exception:
        log("ERROR", "sync_crash", traceback.format_exc())
    finally:
        # GUARANTEE: Reset status so the system never deadlocks
        user = db.query(User).filter_by(spotify_id=user_id).first()
        if user:
            user.sync_status = "idle" 
            db.commit()
        db.close()
