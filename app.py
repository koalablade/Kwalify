"""
app.py — Flask entry point (FIXED)
"""

import os
import secrets
import time

from flask import Flask, jsonify, redirect, render_template, request, session
from sqlalchemy import text as sa_text
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyOauthError

from auth import get_spotify_client, spotify_oauth
from cache import (
    get_or_create_user,
    get_sync_status,
    load_user_tracks,
    start_sync_if_needed,
    start_manual_sync,
    start_full_reset_sync,
)

from database import get_db, init_db
from log import log
from spotify_service import add_tracks_to_playlist, create_playlist
from vibe_engine import diverse_select, interpret_vibe, score_track

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_key")

init_db()


# ---------------------------------------------------------
# throttle
# ---------------------------------------------------------

_last = {}
_MIN = 3.0

def throttle(key):
    now = time.time()
    last = _last.get(key, 0)
    if now - last < _MIN:
        return False, _MIN - (now - last)
    _last[key] = now
    return True, 0


# ---------------------------------------------------------
# ROUTES
# ---------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html", logged_in="token_info" in session)


@app.route("/login")
def login():
    auth = spotify_oauth()
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    return redirect(auth.get_authorize_url(state=state))


@app.route("/callback")
def callback():
    code = request.args.get("code")
    state = request.args.get("state")

    if state != session.pop("oauth_state", None):
        return "OAuth error", 400

    auth = spotify_oauth()

    try:
        token_info = auth.get_access_token(code=code, check_cache=False)
    except SpotifyOauthError as e:
        return str(e), 400

    session["token_info"] = token_info

    sp = get_spotify_client()
    me = sp.me()
    session["spotify_user_id"] = me["id"]

    db = get_db()
    try:
        get_or_create_user(me["id"], db, token_info=token_info)
        db.commit()

        start_sync_if_needed(me["id"], sp, get_db)

    finally:
        db.close()

    return redirect("/")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ---------------------------------------------------------
# GENERATE PLAYLIST
# ---------------------------------------------------------

@app.route("/generate", methods=["POST"])
def generate():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    user = session.get("spotify_user_id")
    db = get_db()

    cache = load_user_tracks(user, db)
    if not cache:
        return jsonify({"error": "no_tracks"}), 400

    vibe = request.json.get("vibe", "chill")
    length = int(request.json.get("length", 25))

    profile, confidence, _ = interpret_vibe(vibe)

    scored = sorted(
        [(t["id"], score_track(t, profile)) for t in cache],
        key=lambda x: x[1],
        reverse=True,
    )

    selected = diverse_select(scored, {t["id"]: t for t in cache}, length, "balanced", None)

    uris = [f"spotify:track:{t['id']}" for t in selected]

    playlist = create_playlist(sp, vibe)
    add_tracks_to_playlist(sp, playlist["id"], uris)

    return jsonify({"url": playlist["external_urls"]["spotify"]})


# ---------------------------------------------------------
# SYNC
# ---------------------------------------------------------

@app.route("/sync/trigger", methods=["POST"])
def sync_trigger():
    sp = get_spotify_client()
    user = session.get("spotify_user_id")

    if not user:
        return jsonify({"error": "no_user"}), 400

    start_sync_if_needed(user, sp, get_db)
    return jsonify({"ok": True})


@app.route("/sync/reset", methods=["POST"])
def sync_reset():
    sp = get_spotify_client()
    user = session.get("spotify_user_id")

    start_full_reset_sync(user, sp, get_db)
    return jsonify({"ok": True})


@app.route("/cache-status")
def cache_status():
    user = session.get("spotify_user_id")
    db = get_db()
    try:
        return jsonify(get_sync_status(user, db))
    finally:
        db.close()


@app.route("/health")
def health():
    db = get_db()
    db.execute(sa_text("SELECT 1"))
    db.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------
# RUN
# ---------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
