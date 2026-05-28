"""
app.py — Flask entry point. Routes only.

Business logic lives in:
  auth.py
  spotify_service.py
  sync_service.py
  vibe_engine.py
  cache.py
  models.py
  database.py
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
    SESSION_COOKIE_SECURE=os.getenv("ENV") == "production",
)

init_db()

# ---------------------------------------------------------------------------
# throttle
# ---------------------------------------------------------------------------

_user_last_generate = {}
_GENERATE_MIN_GAP = 3.0


def _check_generate_throttle(token_suffix: str):
    now = time.time()
    last = _user_last_generate.get(token_suffix, 0.0)

    if now - last < _GENERATE_MIN_GAP:
        return False, round(_GENERATE_MIN_GAP - (now - last), 1)

    _user_last_generate[token_suffix] = now
    return True, 0.0


# ---------------------------------------------------------------------------
# HOME
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html", logged_in="token_info" in session)


# ---------------------------------------------------------------------------
# LOGIN
# ---------------------------------------------------------------------------

@app.route("/login")
def login():
    auth = spotify_oauth()
    state = secrets.token_urlsafe(16)

    session["oauth_state"] = state
    session.modified = True

    return redirect(auth.get_authorize_url(state=state))


# ---------------------------------------------------------------------------
# CALLBACK (FIXED CLEAN VERSION)
# ---------------------------------------------------------------------------

@app.route("/callback")
def callback():
    error = request.args.get("error")
    if error:
        return f"Spotify auth error: {error}", 400

    code = request.args.get("code")
    if not code:
        return "No code returned from Spotify", 400

    returned_state = request.args.get("state")
    expected_state = session.pop("oauth_state", None)

    if not expected_state or returned_state != expected_state:
        session.clear()
        return "OAuth state mismatch", 400

    auth = spotify_oauth()

    try:
        token_info = auth.get_access_token(code=code, check_cache=False)
    except SpotifyOauthError as exc:
        return f"Token exchange failed: {exc}", 400

    session["token_info"] = token_info
    session.modified = True

    spotify_user_id = None

    try:
        sp = get_spotify_client()
        if sp:
            me = sp.me()
            spotify_user_id = me["id"]
            session["spotify_user_id"] = spotify_user_id
    except Exception:
        pass

    # ---------------- CLEAN USER BOOTSTRAP ----------------
    if spotify_user_id:
        db = get_db()
        try:
            display_name = None

            try:
                sp = get_spotify_client()
                if sp:
                    display_name = sp.me().get("display_name")
            except Exception:
                pass

            get_or_create_user(
                spotify_user_id,
                db,
                display_name=display_name,
                token_info=token_info
            )

            db.commit()

            start_sync_if_needed(
                spotify_user_id,
                get_spotify_client(),
                get_db
            )

        except Exception as exc:
            log("WARN", "auth", "DB bootstrap failed", exc=str(exc))
        finally:
            db.close()

    return redirect("/")


# ---------------------------------------------------------------------------
# GENERATE
# ---------------------------------------------------------------------------

@app.route("/generate", methods=["POST"])
def generate():
    token_info = session.get("token_info")
    if not token_info:
        return jsonify({"error": "not_logged_in"}), 401

    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "spotify_client_failed"}), 401

    spotify_user_id = session.get("spotify_user_id")
    if not spotify_user_id:
        me = sp.me()
        spotify_user_id = me["id"]
        session["spotify_user_id"] = spotify_user_id

    token_suffix = token_info.get("access_token", "")[-12:]
    ok, wait = _check_generate_throttle(token_suffix)

    if not ok:
        return jsonify({"error": "rate_limited", "retry_after": wait}), 429

    data = request.get_json(silent=True) or {}
    vibe_text = data.get("vibe", "chill")
    length = int(max(10, min(100, data.get("length", 25))))

    db = get_db()

    try:
        cache = load_user_tracks(spotify_user_id, db)
    except Exception:
        return jsonify({"error": "cache_failed"}), 500

    if not cache:
        return jsonify({"error": "no_tracks"}), 202

    profile, confidence, _ = interpret_vibe(vibe_text)

    scored = sorted(
        [(t["id"], score_track(t, profile)) for t in cache if t.get("id")],
        key=lambda x: x[1],
        reverse=True,
    )

    selected = diverse_select(scored, {t["id"]: t for t in cache}, length, "balanced", None)

    if not selected:
        return jsonify({"error": "no_match"}), 400

    uris = [f"spotify:track:{t['id']}" for t in selected]

    try:
        playlist = create_playlist(sp, vibe_text)
        add_tracks_to_playlist(sp, playlist["id"], uris)

        return jsonify({
            "url": playlist["external_urls"]["spotify"],
            "count": len(selected),
            "vibe": vibe_text,
            "confidence": confidence
        })

    except SpotifyException as exc:
        return jsonify({"error": "spotify_error", "details": str(exc)}), 500


# ---------------------------------------------------------------------------
# SYNC
# ---------------------------------------------------------------------------

@app.route("/sync/trigger", methods=["POST"])
def sync_trigger():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    user = session.get("spotify_user_id")
    if not user:
        return jsonify({"error": "no_user"}), 400

    started = start_manual_sync(user, sp, get_db)

    return jsonify({"started": started})


@app.route("/sync/reset", methods=["POST"])
def sync_reset():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    user = session.get("spotify_user_id")
    if not user:
        return jsonify({"error": "no_user"}), 400

    started = start_full_reset_sync(user, sp, get_db)

    return jsonify({"started": started})


# ---------------------------------------------------------------------------
# CACHE STATUS
# ---------------------------------------------------------------------------

@app.route("/cache-status")
def cache_status():
    user = session.get("spotify_user_id")
    if not user:
        return jsonify({"status": "not_logged_in"})

    db = get_db()
    try:
        return jsonify(get_sync_status(user, db))
    finally:
        db.close()


# ---------------------------------------------------------------------------
# HEALTH
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    try:
        db = get_db()
        db.execute(sa_text("SELECT 1"))
        db.close()
        return jsonify({"status": "ok", "db": "connected"})
    except Exception:
        return jsonify({"status": "ok", "db": "error"})


# ---------------------------------------------------------------------------
# RUN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
