"""
app.py — K_WALAH semantic vibe engine (FAST + EMOTION + HYBRID)
Render-safe production version
"""

import os
from flask import Flask, jsonify, redirect, render_template, request, session

from auth import spotify_oauth, get_spotify_client
from cache import (
    get_or_create_user,
    load_user_tracks,
    get_sync_status,
    start_sync_if_needed
)

from spotify_service import create_playlist  # FIXED IMPORT

from vibe_engine import (
    interpret_vibe,
    score_tracks_fast,
    track_vector,
    update_memory
)

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
# LOGIN
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
    session["token_info"] = token_info

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

    return jsonify(get_sync_status(session["user_id"]))


# =========================================================
# CORE GENERATE (FAST SEMANTIC ENGINE)
# =========================================================

@app.route("/generate", methods=["POST"])
def generate():
    if "user_id" not in session:
        return {"error": "not logged in"}, 401

    data = request.get_json(force=True)
    vibe_text = data.get("vibe", "").strip()

    if not vibe_text:
        return {"error": "missing vibe"}, 400

    user_id = session["user_id"]

    # -----------------------------------------------------
    # LOAD TRACKS
    # -----------------------------------------------------
    tracks = load_user_tracks(user_id)

    if not tracks:
        return {"error": "no tracks found"}, 404

    # -----------------------------------------------------
    # SEMANTIC VIBE EMBEDDING
    # -----------------------------------------------------
    vibe_vec = interpret_vibe(vibe_text)

    # -----------------------------------------------------
    # FAST HYBRID SCORING
    # -----------------------------------------------------
    scored_tracks = score_tracks_fast(
        user_id,
        vibe_vec,
        tracks
    )

    # -----------------------------------------------------
    # SELECT TOP TRACKS
    # -----------------------------------------------------
    playlist_tracks = [t for _, t in scored_tracks[:30]]

    # -----------------------------------------------------
    # UPDATE MEMORY (IMPORTANT FOR REPETITION CONTROL)
    # -----------------------------------------------------
    for t in playlist_tracks:
        vec = track_vector(t)
        update_memory(user_id, t.spotify_id, vec)

    # -----------------------------------------------------
    # CREATE SPOTIFY PLAYLIST
    # -----------------------------------------------------
    playlist_url = None

    try:
        token_info = session.get("token_info")

        if token_info:
            sp = get_spotify_client(token_info["access_token"])

            playlist = create_playlist(sp, vibe_text)

            # add tracks
            sp.playlist_add_items(
                playlist["id"],
                [t.spotify_id for t in playlist_tracks]
            )

            playlist_url = playlist["external_urls"]["spotify"]

    except Exception:
        playlist_url = None

    # -----------------------------------------------------
    # RESPONSE
    # -----------------------------------------------------
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
# SYNC
# =========================================================

@app.route("/sync")
def sync():
    if "user_id" not in session:
        return redirect("/login")

    start_sync_if_needed(session["user_id"])
    return redirect("/cache-status")


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
