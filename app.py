"""
app.py — K_WALAH main Flask app (SEMANTIC VIBE VERSION)
"""

import os
import time
from flask import Flask, jsonify, redirect, render_template, request, session

from sqlalchemy import text as sa_text

from auth import spotify_oauth, get_spotify_client
from cache import (
    get_or_create_user,
    load_user_tracks,
    get_sync_status,
    start_sync_if_needed
)

from spotify_service import create_playlist_on_spotify

from vibe_engine import interpret_vibe, score_track, apply_repeat_penalty


# =========================================================
# APP SETUP
# =========================================================

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret")


# =========================================================
# HOME
# =========================================================

@app.route("/")
def home():
    return render_template("index.html", logged_in=("user_id" in session))


# =========================================================
# LOGIN (Spotify OAuth)
# =========================================================

@app.route("/login")
def login():
    return redirect(spotify_oauth.get_authorize_url())


@app.route("/callback")
def callback():
    token_info = spotify_oauth.get_access_token(request.args["code"])
    sp = get_spotify_client(token_info["access_token"])

    user = sp.current_user()

    db_user = get_or_create_user(
        spotify_id=user["id"],
        display_name=user.get("display_name"),
        token_json=token_info
    )

    session["user_id"] = db_user.id

    start_sync_if_needed(db_user.id)

    return redirect("/")


# =========================================================
# LOGOUT (FIXED)
# =========================================================

@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# =========================================================
# CACHE STATUS
# =========================================================

@app.route("/cache-status")
def cache_status():
    if "user_id" not in session:
        return redirect("/login")

    status = get_sync_status(session["user_id"])
    return jsonify(status)


# =========================================================
# SEMANTIC GENERATOR (CORE FEATURE)
# =========================================================

@app.route("/generate", methods=["POST"])
def generate():
    if "user_id" not in session:
        return {"error": "not logged in"}, 401

    data = request.get_json(force=True)

    vibe_text = data.get("vibe", "").strip()
    user_id = session["user_id"]

    if not vibe_text:
        return {"error": "missing vibe"}, 400

    # ----------------------------------------
    # 1. LOAD USER TRACKS
    # ----------------------------------------
    tracks = load_user_tracks(user_id)

    if not tracks:
        return {"error": "no tracks found"}, 404

    # ----------------------------------------
    # 2. SEMANTIC VIBE EMBEDDING
    # ----------------------------------------
    vibe_embedding = interpret_vibe(vibe_text)

    # ----------------------------------------
    # 3. SCORE TRACKS SEMANTICALLY
    # ----------------------------------------
    scored_tracks = []
    used = set()

    for t in tracks:
        score = score_track(vibe_embedding, t)

        score = apply_repeat_penalty(score, used, t.spotify_id)

        scored_tracks.append((score, t))

    # ----------------------------------------
    # 4. SORT + PICK TOP TRACKS
    # ----------------------------------------
    scored_tracks.sort(key=lambda x: x[0], reverse=True)

    playlist_tracks = [t for _, t in scored_tracks[:30]]

    # ----------------------------------------
    # 5. OPTIONAL: CREATE SPOTIFY PLAYLIST
    # ----------------------------------------
    try:
        sp = get_spotify_client_from_session(session)

        playlist_url = create_playlist_on_spotify(
            sp,
            user_id,
            vibe_text,
            playlist_tracks
        )
    except Exception:
        playlist_url = None

    # ----------------------------------------
    # 6. RESPONSE
    # ----------------------------------------
    return jsonify({
        "vibe": vibe_text,
        "playlist_url": playlist_url,
        "tracks": [
            {
                "name": t.name,
                "artist": t.artist,
                "album": t.album,
                "spotify_id": t.spotify_id
            }
            for t in playlist_tracks
        ]
    })


# =========================================================
# OPTIONAL: SYNC TRIGGER
# =========================================================

@app.route("/sync")
def sync():
    if "user_id" not in session:
        return redirect("/login")

    start_sync_if_needed(session["user_id"])
    return redirect("/cache-status")


# =========================================================
# HELPER: GET SPOTIFY CLIENT
# =========================================================

def get_spotify_client_from_session(session):
    token_info = session.get("token_info")

    if not token_info:
        raise Exception("No token in session")

    return get_spotify_client(token_info["access_token"])


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
