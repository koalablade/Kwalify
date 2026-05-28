"""
cache.py — DB-backed cache helpers and background sync orchestration.

Public API:
  load_user_tracks(spotify_user_id, db)                 → [track_dict, ...]
  get_or_create_user(spotify_user_id, name, token, db)  → User
  needs_sync(spotify_user_id, db)                       → bool
  get_sync_status(spotify_user_id, db)                  → dict
  get_active_syncs()                                    → {user_id: elapsed_seconds}
  start_sync_if_needed(spotify_user_id, sp, db_factory) → None  (background)
  start_manual_sync(spotify_user_id, sp, db_factory)    → bool  (background)
  start_full_reset_sync(spotify_user_id, sp, db_factory)→ bool  (background)
  migrate_json_cache(json_path, spotify_user_id, db)    → int
"""

import datetime
import json
import os
import threading
import time
import traceback

from log import log
from models import Track, User, UserTrack


# ---------------------------------------------------------------------------
# Core DB helpers
# ---------------------------------------------------------------------------

def load_user_tracks(spotify_user_id, db):
    """
    Return all tracks for a user as plain dicts for vibe_engine.score_track.
    Pure DB query — zero Spotify API calls.
    """
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


def get_or_create_user(spotify_user_id, display_name, token_info, db):
    """Upsert a User row and return the ORM object."""
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        user = User(spotify_id=spotify_user_id, sync_status="idle")
        db.add(user)
    user.display_name = display_name
    user.token_json = json.dumps(token_info)
    db.commit()
    return user


def needs_sync(spotify_user_id, db):
    """
    Return True when a background sync should be launched:
      • No user row yet
      • User has zero tracks in DB
      • No last_sync_at recorded
      • Rate-limit cooldown has expired

    Returns False when sync_retry_after is still in the future.
    """
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
    """Return a status dict for /cache-status."""
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

    retry_after_iso = None
    if user.sync_retry_after:
        retry_after_iso = user.sync_retry_after.isoformat()

    return {
        "status": user.sync_status or "idle",
        "track_count": track_count,
        "tracks_with_features": tracks_with_features,
        "sync_total": user.sync_total or 0,
        "sync_done": user.sync_done or 0,
        "last_sync_at": user.last_sync_at.isoformat() if user.last_sync_at else None,
        "sync_retry_after": retry_after_iso,
    }


# ---------------------------------------------------------------------------
# Background sync orchestration
# ---------------------------------------------------------------------------

_sync_lock = threading.Lock()
_syncing_users: set = set()
_sync_start_times: dict = {}     # user_id → time.time() when thread was launched

_STALE_LOCK_TIMEOUT = 7200       # 2 hours — max any sync should ever take


def get_active_syncs() -> dict:
    """Return {user_id: elapsed_seconds} for all currently tracked syncs."""
    now = time.time()
    with _sync_lock:
        return {uid: round(now - started, 0) for uid, started in _sync_start_times.items()}


def _launch_sync_thread(spotify_user_id, target_fn):
    """
    Launch target_fn in a daemon thread, guarded by _syncing_users.
    target_fn() must accept no arguments — use a closure to capture context.

    Safety:
      • Stale locks (> 2 h) are pruned before each launch.
      • Thread-start failure is caught and the lock is released.
      • Uncaught exceptions in target_fn are logged with full traceback.
    """
    with _sync_lock:
        # Prune stale locks — safety net for any edge-case crash
        now = time.time()
        stale = [uid for uid, t in _sync_start_times.items() if now - t > _STALE_LOCK_TIMEOUT]
        for uid in stale:
            _syncing_users.discard(uid)
            _sync_start_times.pop(uid, None)
            log("WARN", "cache", "Pruned stale sync lock", user=uid)

        if spotify_user_id in _syncing_users:
            log("INFO", "cache", "Sync already running — skipping duplicate", user=spotify_user_id)
            return False

        _syncing_users.add(spotify_user_id)
        _sync_start_times[spotify_user_id] = time.time()

    def _run():
        try:
            target_fn()
        except Exception as exc:
            log("ERROR", "cache", "Uncaught exception in sync thread",
                user=spotify_user_id, exc=str(exc))
            traceback.print_exc()
        finally:
            with _sync_lock:
                _syncing_users.discard(spotify_user_id)
                _sync_start_times.pop(spotify_user_id, None)

    try:
        t = threading.Thread(target=_run, daemon=True)
        t.start()
    except Exception as exc:
        log("ERROR", "cache", "Failed to start sync thread", user=spotify_user_id, exc=str(exc))
        with _sync_lock:
            _syncing_users.discard(spotify_user_id)
            _sync_start_times.pop(spotify_user_id, None)
        return False

    log("INFO", "cache", "Sync thread launched", user=spotify_user_id)
    return True


def start_sync_if_needed(spotify_user_id, sp, db_factory):
    """
    Launch an incremental sync in the background if the user's library
    is missing or no last_sync_at is recorded.
    Respects active rate-limit cooldowns — will not launch during cooldown.
    """
    from sync_service import run_incremental_sync

    with _sync_lock:
        if spotify_user_id in _syncing_users:
            return

    tmp_db = db_factory()
    try:
        needed = needs_sync(spotify_user_id, tmp_db)
    finally:
        tmp_db.close()

    if not needed:
        log("INFO", "cache", "Library up to date — no sync needed", user=spotify_user_id)
        return

    def _target():
        db = db_factory()
        try:
            run_incremental_sync(spotify_user_id, sp, db)
        except Exception as exc:
            log("ERROR", "cache", "Sync crashed — marking error", user=spotify_user_id, exc=str(exc))
            traceback.print_exc()
            try:
                user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
                if user and user.sync_status not in ("rate_limited",):
                    user.sync_status = "error"
                    db.commit()
            except Exception:
                pass
            raise
        finally:
            db.close()

    _launch_sync_thread(spotify_user_id, _target)


def start_manual_sync(spotify_user_id, sp, db_factory):
    """
    Explicitly triggered incremental sync (e.g. /sync/trigger).
    Runs regardless of last_sync_at — but still respects active rate-limit cooldown.
    Returns True if launched, False if already running or in cooldown.
    """
    from sync_service import run_incremental_sync

    tmp_db = db_factory()
    try:
        user = tmp_db.query(User).filter_by(spotify_id=spotify_user_id).first()
        if user and user.sync_retry_after and user.sync_retry_after > datetime.datetime.utcnow():
            remaining = (user.sync_retry_after - datetime.datetime.utcnow()).total_seconds() / 60
            log("INFO", "cache", "Rate-limit cooldown active — not launching manual sync",
                user=spotify_user_id, remaining_min=f"{remaining:.0f}")
            return False
    finally:
        tmp_db.close()

    def _target():
        db = db_factory()
        try:
            run_incremental_sync(spotify_user_id, sp, db)
        except Exception as exc:
            log("ERROR", "cache", "Manual sync crashed — marking error",
                user=spotify_user_id, exc=str(exc))
            traceback.print_exc()
            try:
                user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
                if user and user.sync_status not in ("rate_limited",):
                    user.sync_status = "error"
                    db.commit()
            except Exception:
                pass
            raise
        finally:
            db.close()

    return _launch_sync_thread(spotify_user_id, _target)


def start_full_reset_sync(spotify_user_id, sp, db_factory):
    """
    Full reset: wipe UserTrack links and re-sync everything from scratch.
    ONLY called by explicit /sync/reset user action — never automatic.
    Returns True if launched, False if already running.
    """
    from sync_service import run_full_reset_sync

    def _target():
        db = db_factory()
        try:
            run_full_reset_sync(spotify_user_id, sp, db)
        except Exception as exc:
            log("ERROR", "cache", "Full reset sync crashed", user=spotify_user_id, exc=str(exc))
            traceback.print_exc()
            raise
        finally:
            db.close()

    return _launch_sync_thread(spotify_user_id, _target)


# ---------------------------------------------------------------------------
# One-time JSON → SQLite migration (legacy)
# ---------------------------------------------------------------------------

def migrate_json_cache(json_path, spotify_user_id, db):
    """
    Import tracks from the old song_index.json into SQLite.
    Idempotent — skips tracks already linked to this user.
    Returns the number of newly added tracks.
    """
    if not os.path.exists(json_path):
        return 0

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        log("WARN", "cache", "Could not read legacy JSON cache", path=json_path, exc=str(exc))
        return 0

    if not isinstance(data, list) or not data:
        return 0

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        return 0

    existing_ids = {
        row[0]
        for row in db.query(Track.spotify_id)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    }

    added = 0
    for t in data:
        sid = t.get("id")
        if not sid or sid in existing_ids:
            continue

        track_row = db.query(Track).filter_by(spotify_id=sid).first()
        if not track_row:
            track_row = Track(
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
            db.add(track_row)
            db.flush()

        db.add(UserTrack(user_id=user.id, track_id=track_row.id))
        existing_ids.add(sid)
        added += 1

    if added:
        user.last_sync_at = datetime.datetime.utcnow()
        user.sync_status = "done"
        user.sync_total = len(data)
        user.sync_done = len(data)
        db.commit()
        log("INFO", "cache", "Migrated legacy JSON cache", path=json_path, added=added)

    return added
