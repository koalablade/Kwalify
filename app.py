"""
app.py — Flask entry point. Routes only.

Business logic lives in:
  auth.py          — OAuth + token management
  spotify_service.py — playlist creation calls (no sync)
  sync_service.py  — incremental sync logic
  vibe_engine.py   — vibe parsing + track scoring
  cache.py         — DB-backed cache + sync orchestration
  models.py        — SQLAlchemy schema
  database.py      — engine + session factory
"""

import datetime
import os
import secrets
import time

from flask import Flask, jsonify, redirect, render_template, request, session
from sqlalchemy import text as sa_text
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyOauthError

from auth import REDIRECT_URI, SCOPE, get_spotify_client, spotify_oauth
from cache import (
    get_active_syncs,
    get_or_create_user,
    get_sync_status,
    load_user_tracks,
    migrate_json_cache,
    start_full_reset_sync,
    start_manual_sync,
    start_sync_if_needed,
)
from database import get_db, init_db
from log import log
from models import Playlist as PlaylistModel, User
from spotify_service import add_tracks_to_playlist, create_playlist
from vibe_engine import diverse_select, interpret_vibe, score_track

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_key_change_me")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE= os.getenv("ENV") == "production"
)

CACHE_FILE = "song_index.json"

init_db()


# ---------------------------------------------------------------------------
# Per-user /generate throttle  (in-memory, keyed by token suffix)
# ---------------------------------------------------------------------------

_user_last_generate: dict = {}
_GENERATE_MIN_GAP = 3.0


def _check_generate_throttle(token_suffix: str) -> tuple:
    now = time.time()
    last = _user_last_generate.get(token_suffix, 0.0)
    elapsed = now - last
    if elapsed < _GENERATE_MIN_GAP:
        return False, round(_GENERATE_MIN_GAP - elapsed, 1)
    _user_last_generate[token_suffix] = now
    stale = [k for k, v in _user_last_generate.items() if now - v > 300]
    for k in stale:
        _user_last_generate.pop(k, None)
    return True, 0.0


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    logged_in = "token_info" in session
    return render_template("index.html", logged_in=logged_in)


@app.route("/login")
def login():
    log("INFO", "auth", "OAuth flow started")

    auth = spotify_oauth()
    state = secrets.token_urlsafe(16)

    session["oauth_state"] = state
    session.modified = True

    url = auth.get_authorize_url(state=state)
    return redirect(url)


@app.route("/callback")
def callback():
    log("INFO", "auth", "OAuth callback hit")

    error = request.args.get("error")
    if error:
        return f"Spotify auth error: {error}", 400

    code = request.args.get("code")
    if not code:
        return "No code returned from Spotify", 400

    returned_state = request.args.get("state")
    expected_state = session.pop("oauth_state", None)

    if not expected_state or not returned_state or returned_state != expected_state:
        session.clear()
        return "OAuth state mismatch", 400

    auth = spotify_oauth()

    try:
        token_info = auth.get_access_token(code=code, check_cache=False)

        session["token_info"] = token_info
        session.modified = True

        log("INFO", "auth", "Token stored in session")

    except SpotifyOauthError as exc:
        return f"Token exchange failed: {exc}", 400

    # optional: fetch user immediately (safe + clean)
    try:
        sp = get_spotify_client()
        if sp:
            me = sp.me()
            session["spotify_user_id"] = me["id"]
            session.modified = True
    except Exception:
        pass
except Exception:
    pass
        session["spotify_user_id"] = me["id"]
        session.modified = True

    return redirect("/")

@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ---------------------------------------------------------------------------
# /generate — DB query + vibe engine + playlist creation
# ---------------------------------------------------------------------------

@app.route("/generate", methods=["POST"])
def generate():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    token_suffix = (session.get("token_info") or {}).get("access_token", "")[-12:]
    allowed, retry_after = _check_generate_throttle(token_suffix)
    if not allowed:
        return jsonify({"error": "rate_limited", "retry_after": retry_after}), 429

    data = request.get_json(silent=True) or {}
    vibe_text = (data.get("vibe") or "chill").strip()
    length = int(max(10, min(100, data.get("length", 25) or 25)))
    mode = data.get("mode", "balanced") or "balanced"
    rng_seed = data.get("seed")
    if mode not in ("strict", "balanced", "chaotic"):
        mode = "balanced"

    log("INFO", "gen", "Generate called", vibe=vibe_text, length=length, mode=mode)

    # Step 1: load tracks from DB — zero Spotify calls
    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        try:
            me = sp.me()
            spotify_user_id = me["id"]
            session["spotify_user_id"] = spotify_user_id
            session.modified = True
        except Exception as exc:
            log("WARN", "gen", "Could not resolve user ID", exc=str(exc))
            return jsonify({"error": "not_logged_in"}), 401

    # Single DB session covers both track loading and playlist logging below.
    db = get_db()
    try:
        cache = load_user_tracks(spotify_user_id, db)
    except Exception as exc:
        db.close()
        log("ERROR", "gen", "DB load failed", exc=str(exc))
        return jsonify({"error": "cache_build_failed"}), 500

    if not cache:
        try:
            sync_info = get_sync_status(spotify_user_id, db)
        except Exception:
            sync_info = {}
        finally:
            db.close()
        status = sync_info.get("status", "idle")
        log("WARN", "gen", "Empty cache", sync_status=status)
        if status == "syncing":
            return jsonify({
                "error": "no_tracks_available",
                "detail": "Your library is still syncing — check back in a moment.",
            }), 400
        if status == "rate_limited":
            return jsonify({
                "error": "no_tracks_available",
                "detail": (
                    "Sync is paused due to Spotify rate limiting. "
                    "Your library will update automatically soon."
                ),
            }), 400
        return jsonify({"error": "no_tracks_available"}), 400

    # Step 2: score tracks (pure local computation — no Spotify calls)
    # db is still open; reused for playlist logging after Step 3.
    profile, vibe_confidence, vibe_signals = interpret_vibe(vibe_text)

    track_lookup = {t["id"]: t for t in cache if t.get("id")}
    scored = sorted(
        [(t["id"], score_track(t, profile)) for t in cache if t.get("id")],
        key=lambda x: x[1],
        reverse=True,
    )
    selected_tracks = diverse_select(scored, track_lookup, length, mode, rng_seed)

    if not selected_tracks:
        db.close()
        log("WARN", "gen", "No tracks matched vibe", vibe=vibe_text)
        return jsonify({"error": "no_tracks_matched"}), 400

    top_uris = [f"spotify:track:{t['id']}" for t in selected_tracks]

    # Step 3: create Spotify playlist (only API calls in /generate)
    try:
        playlist = create_playlist(sp, vibe_text)
        playlist_id = playlist["id"]
        add_tracks_to_playlist(sp, playlist_id, top_uris)
        url = playlist["external_urls"]["spotify"]

        preview_tracks = [
            {"name": t.get("name", "Unknown"), "artist": t.get("artist", "")}
            for t in selected_tracks[:5]
        ]

        # Log playlist to DB — reuse the session opened in Step 1.
        try:
            user_row = db.query(User).filter_by(spotify_id=spotify_user_id).first()
            if user_row:
                db.add(PlaylistModel(
                    user_id=user_row.id,
                    spotify_playlist_id=playlist_id,
                    vibe_text=vibe_text,
                    track_count=len(selected_tracks),
                    created_at=datetime.datetime.utcnow(),
                ))
                db.commit()
        except Exception as exc:
            log("WARN", "gen", "Playlist DB log failed (non-fatal)", exc=str(exc))
        finally:
            db.close()

        log("INFO", "gen", "Playlist created",
            user=spotify_user_id,
            tracks=len(selected_tracks),
            mode=mode,
            confidence=vibe_confidence)

        return jsonify({
            "url": url,
            "tracks": preview_tracks,
            "vibe": vibe_text,
            "count": len(selected_tracks),
            "mode": mode,
            "confidence": vibe_confidence,
        })

    except SpotifyException as exc:
        db.close()
        status_code = getattr(exc, "http_status", None)
        msg = getattr(exc, "msg", None) or str(exc)
        log("ERROR", "gen", "SpotifyException during playlist creation",
            status=status_code, msg=msg)
        if status_code == 401:
            session.pop("token_info", None)
            session.modified = True
            return jsonify({"error": "session_expired"}), 401
        if status_code == 403:
            session.pop("token_info", None)
            session.modified = True
            return jsonify({"error": "scope_mismatch", "spotify_msg": msg}), 401
        return jsonify({"error": "playlist_creation_failed", "details": str(exc)}), 500
    except Exception as exc:
        db.close()
        log("ERROR", "gen", "Unexpected error during playlist creation", exc=str(exc))
        return jsonify({"error": f"unexpected_error: {exc}"}), 500


# ---------------------------------------------------------------------------
# /sync — manual sync controls
# ---------------------------------------------------------------------------

@app.route("/sync/trigger", methods=["POST"])
def sync_trigger():
    """
    Manually trigger an incremental sync for the logged-in user.
    Safe to call any time — respects rate-limit cooldown.
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        return jsonify({"error": "no_user_id"}), 400

    tmp_db = get_db()
    try:
        status = get_sync_status(spotify_user_id, tmp_db)
    finally:
        tmp_db.close()

    if status.get("sync_retry_after"):
        return jsonify({
            "started": False,
            "reason": "rate_limited",
            "retry_after": status["sync_retry_after"],
        }), 429

    launched = start_manual_sync(spotify_user_id, sp, get_db)
    log("INFO", "sync", "Manual sync trigger", user=spotify_user_id, launched=launched)
    return jsonify({
        "started": launched,
        "reason": "already_running" if not launched else None,
    })


@app.route("/sync/reset", methods=["POST"])
def sync_reset():
    """
    Full reset: wipe all UserTrack links and re-sync from scratch.
    This is destructive (re-downloads the full library) — user-explicit only.
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        return jsonify({"error": "no_user_id"}), 400

    launched = start_full_reset_sync(spotify_user_id, sp, get_db)
    log("INFO", "sync", "Full reset trigger", user=spotify_user_id, launched=launched)
    return jsonify({
        "started": launched,
        "reason": "already_running" if not launched else None,
    })


# ---------------------------------------------------------------------------
# /cache-status
# ---------------------------------------------------------------------------

@app.route("/cache-status")
def cache_status():
    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        return jsonify({
            "status": "not_logged_in",
            "message": "Log in with Spotify to see your library status.",
            "track_count": 0,
        })

    db = get_db()
    try:
        info = get_sync_status(spotify_user_id, db)
    finally:
        db.close()

    label_map = {
        "idle":         "Library not yet synced.",
        "syncing":      "Syncing your library — this may take a few minutes.",
        "done":         "Library loaded and ready.",
        "error":        "Sync encountered an error. Try logging out and back in.",
        "rate_limited": "Sync paused — Spotify rate limit hit. Will resume automatically.",
        "no_user":      "User record not found. Try logging out and back in.",
    }

    return jsonify({
        "status": info["status"],
        "message": label_map.get(info["status"], ""),
        "track_count": info["track_count"],
        "tracks_with_features": info.get("tracks_with_features", 0),
        "sync_total": info.get("sync_total", 0),
        "sync_done": info.get("sync_done", 0),
        "last_sync_at": info.get("last_sync_at"),
        "sync_retry_after": info.get("sync_retry_after"),
        "rebuild_needed": info["track_count"] == 0,
    })


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    """
    Lightweight diagnostics endpoint. JSON-only.

    Returns:
      status:               "ok"
      db:                   "connected" | "error"
      active_sync_threads:  int
      syncing_users:        [user_id, ...]
      syncing_elapsed_sec:  {user_id: seconds_since_start}
      cooldown_users:       int  (users currently in rate-limit hold)
    """
    db_ok = True
    try:
        db = get_db()
        db.execute(sa_text("SELECT 1"))
        db.close()
    except Exception as exc:
        db_ok = False
        log("ERROR", "health", "DB connectivity check failed", exc=str(exc))

    active = get_active_syncs()

    cooldown_count = 0
    try:
        db = get_db()
        cooldown_count = (
            db.query(User)
            .filter(User.sync_retry_after > datetime.datetime.utcnow())
            .count()
        )
        db.close()
    except Exception:
        pass

    return jsonify({
        "status": "ok",
        "db": "connected" if db_ok else "error",
        "active_sync_threads": len(active),
        "syncing_users": list(active.keys()),
        "syncing_elapsed_sec": active,
        "cooldown_users": cooldown_count,
    })


# ---------------------------------------------------------------------------
# /debug-token
# ---------------------------------------------------------------------------

@app.route("/debug-token")
def debug_token():
    token_info = session.get("token_info")
    if not token_info:
        return jsonify({"status": "no_token", "logged_in": False}), 200

    granted_scopes = set((token_info.get("scope") or "").split())
    required_scopes = set(SCOPE.split())
    missing_scopes = required_scopes - granted_scopes
    expires_at = token_info.get("expires_at")
    now_ts = time.time()

    return jsonify({
        "status": "ok",
        "logged_in": True,
        "spotify_user_id": session.get("spotify_user_id"),
        "scope_in_token": token_info.get("scope"),
        "granted_scopes": sorted(granted_scopes),
        "required_scopes": sorted(required_scopes),
        "missing_scopes": sorted(missing_scopes),
        "all_required_scopes_present": not missing_scopes,
        "token_type": token_info.get("token_type"),
        "expires_at": expires_at,
        "expires_at_utc": (
            datetime.datetime.utcfromtimestamp(expires_at).isoformat() + "Z"
            if expires_at else None
        ),
        "is_expired": bool(expires_at and now_ts > expires_at),
        "has_refresh_token": bool(token_info.get("refresh_token")),
        "access_token_suffix": (token_info.get("access_token") or "")[-8:],
    }), 200


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    log("INFO", "app", "Starting K_WALAH", port=port, redirect_uri=REDIRECT_URI)
    app.run(
        debug=False,
        host="0.0.0.0",
        port=port,
        use_reloader=False,
        threaded=True,
    )
