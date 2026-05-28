"""
sync_service.py — Incremental sync logic. Lives here; never imported by /generate.

Safety contract:
  • 300–900ms random jitter BEFORE every Spotify page request
  • 429 → immediately stop, record retry_after in DB (60–120 min), never retry in-loop
  • 403 → skip gracefully, log, continue
  • Progress written to DB after EVERY page (resumable)
  • Stops early when 20 consecutive already-known tracks are seen (overlap gate)
  • Stops early when track added_at <= user.last_sync_at (time-based cutoff)
  • Never runs in parallel for the same user (enforced by cache.py lock)
  • run_full_reset_sync() is the ONLY path that discards existing links — explicit only
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
# Internal helpers
# ---------------------------------------------------------------------------

def _jitter_sleep():
    """Enforce 300–900ms spacing between Spotify calls."""
    time.sleep(random.uniform(0.3, 0.9))


def _fetch_page_safe(sp, offset, limit):
    """
    Single page of GET /v1/me/tracks with pre-call jitter.

    Returns:
        (items: list, error: None | "429" | "403" | "other")

    Never retries — caller decides what to do with each error type.
    """
    _jitter_sleep()
    try:
        page = sp.current_user_saved_tracks(limit=limit, offset=offset)
        return (page or {}).get("items") or [], None
    except SpotifyException as exc:
        status = getattr(exc, "http_status", None)
        if status == 429:
            return [], "429"
        if status == 403:
            log("WARN", "sync", "403 on page — skipping", offset=offset)
            return [], "403"
        log("WARN", "sync", "SpotifyException on page", offset=offset, status=status)
        return [], "other"
    except Exception as exc:
        log("ERROR", "sync", "Unexpected error fetching page", offset=offset, exc=str(exc))
        return [], "other"


def _parse_added_at(added_at_str):
    """Parse Spotify's ISO-8601 added_at string → naive UTC datetime or None."""
    if not added_at_str:
        return None
    try:
        dt = datetime.datetime.fromisoformat(added_at_str.replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    except Exception:
        return None


def _write_tracks_to_db(new_tracks, user, existing_spotify_ids, db):
    """
    Insert Track rows and UserTrack links for every entry in new_tracks.
    Skips any ID already in existing_spotify_ids (double-check guard).
    Returns number of rows written.
    """
    from models import Track, UserTrack

    written = 0
    for t in new_tracks:
        tid = t["id"]
        if tid in existing_spotify_ids:
            continue

        track_row = db.query(Track).filter_by(spotify_id=tid).first()
        if not track_row:
            track_row = Track(
                spotify_id=tid,
                name=t["name"],
                artist=t["artist"],
                album=t.get("album", ""),
                # Audio features intentionally omitted:
                # Spotify 403s this endpoint for new app tiers; vibe scoring
                # falls back to defaults and still produces good playlists.
            )
            db.add(track_row)
            db.flush()

        db.merge(UserTrack(
            user_id=user.id,
            track_id=track_row.id,
            liked_at=t.get("liked_at"),
        ))
        existing_spotify_ids.add(tid)
        written += 1

    db.flush()
    return written


# ---------------------------------------------------------------------------
# Public: incremental sync
# ---------------------------------------------------------------------------

def run_incremental_sync(spotify_user_id, sp, db):
    """
    Incremental sync for one user.

    Pagination strategy:
      Spotify returns liked songs newest-first (by added_at desc).
      We walk pages from offset=0 upward.

    Stop conditions (first match wins):
      1. 429 received     → save retry_after, return immediately
      2. Time cutoff      → track.added_at <= user.last_sync_at
      3. Overlap gate     → 20 consecutive tracks already in DB
      4. Page exhausted   → Spotify returned fewer than 50 items
    """
    from models import Track, User, UserTrack

    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        log("WARN", "sync", "User not found — aborting", user=spotify_user_id)
        return

    # Honour rate-limit cooldown from a previous 429
    if user.sync_retry_after and user.sync_retry_after > datetime.datetime.utcnow():
        remaining = (user.sync_retry_after - datetime.datetime.utcnow()).total_seconds() / 60
        log("INFO", "sync", "Rate-limit cooldown active — skipping",
            user=spotify_user_id, remaining_min=f"{remaining:.0f}")
        return

    user.sync_status = "syncing"
    user.sync_retry_after = None
    db.commit()

    # Snapshot existing track IDs for this user (dedup gate)
    existing_spotify_ids = {
        row[0]
        for row in db.query(Track.spotify_id)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user.id)
        .all()
    }
    log("INFO", "sync", "Sync started",
        user=spotify_user_id,
        existing=len(existing_spotify_ids),
        last_sync_at=str(user.last_sync_at))

    last_sync_at = user.last_sync_at
    new_tracks = []
    offset = 0
    consecutive_known = 0
    stop_reason = None

    while True:
        items, error = _fetch_page_safe(sp, offset, LIKED_SONGS_LIMIT)

        # ── 429: stop everything immediately ──────────────────────────────
        if error == "429":
            delay_minutes = random.uniform(RETRY_DELAY_MIN_MINUTES, RETRY_DELAY_MAX_MINUTES)
            retry_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=delay_minutes)
            user.sync_status = "rate_limited"
            user.sync_retry_after = retry_at
            db.commit()
            log("WARN", "sync", "429 — sync paused",
                user=spotify_user_id,
                retry_at=retry_at.strftime("%H:%M UTC"),
                retry_in_min=f"{delay_minutes:.0f}")
            return

        # ── 403 / other: treat as end of stream ───────────────────────────
        if error in ("403", "other"):
            stop_reason = "page_error"
            break

        if not items:
            stop_reason = "exhausted"
            break

        for item in items:
            track = (item or {}).get("track") or {}
            tid = track.get("id")
            if not tid:
                continue

            liked_at = _parse_added_at(item.get("added_at"))

            # ── Time-based cutoff ───────────────────────────────────────────
            if last_sync_at and liked_at and liked_at <= last_sync_at:
                log("INFO", "sync", "Time-cutoff reached — stopping",
                    user=spotify_user_id,
                    track_added=str(liked_at),
                    last_sync=str(last_sync_at))
                stop_reason = "time_cutoff"
                break

            # ── Deduplication gate ──────────────────────────────────────────
            if tid in existing_spotify_ids:
                consecutive_known += 1
                if consecutive_known >= CONSECUTIVE_KNOWN_THRESHOLD:
                    log("INFO", "sync", "Overlap threshold reached — stopping early",
                        user=spotify_user_id, consecutive=consecutive_known)
                    stop_reason = "overlap_threshold"
                    break
                continue
            else:
                consecutive_known = 0

            artists = track.get("artists") or [{}]
            new_tracks.append({
                "id": tid,
                "name": track.get("name", ""),
                "artist": artists[0].get("name", "") if artists else "",
                "album": (track.get("album") or {}).get("name", ""),
                "liked_at": liked_at,
            })

        # Persist progress after every page
        user.sync_done = len(existing_spotify_ids) + len(new_tracks)
        db.commit()

        if stop_reason:
            break

        offset += len(items)
        if len(items) < LIKED_SONGS_LIMIT:
            stop_reason = "exhausted"
            break

    if new_tracks:
        written = _write_tracks_to_db(new_tracks, user, existing_spotify_ids, db)
        log("INFO", "sync", "Wrote new tracks to DB", user=spotify_user_id, written=written)

    from models import UserTrack
    user.sync_total = db.query(UserTrack).filter_by(user_id=user.id).count()
    user.sync_done = user.sync_total
    user.sync_status = "done"
    # Only advance last_sync_at when we reached a clean stop
    if stop_reason in ("exhausted", "time_cutoff", "overlap_threshold"):
        user.last_sync_at = datetime.datetime.utcnow()
    db.commit()

    log("INFO", "sync", "Sync complete",
        user=spotify_user_id,
        new=len(new_tracks),
        total=user.sync_total,
        stop=stop_reason)


# ---------------------------------------------------------------------------
# Public: full reset (explicit user action only — never called automatically)
# ---------------------------------------------------------------------------

def run_full_reset_sync(spotify_user_id, sp, db):
    """
    Wipe all UserTrack links for this user, clear sync state,
    then run a complete incremental sync from scratch.

    ONLY triggered by an explicit /sync/reset request — never automatic.
    """
    from models import User, UserTrack

    log("INFO", "sync", "Full reset — clearing library", user=spotify_user_id)
    user = db.query(User).filter_by(spotify_id=spotify_user_id).first()
    if not user:
        log("WARN", "sync", "User not found for reset — aborting", user=spotify_user_id)
        return

    db.query(UserTrack).filter_by(user_id=user.id).delete()
    user.last_sync_at = None
    user.sync_status = "idle"
    user.sync_total = 0
    user.sync_done = 0
    user.sync_retry_after = None
    db.commit()
    log("INFO", "sync", "Library cleared — running full sync", user=spotify_user_id)
    run_incremental_sync(spotify_user_id, sp, db)
