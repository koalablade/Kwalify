"""
app.py — K_WALAH stable semantic vibe engine (emotion + memory upgraded)
"""

import os
from flask import Flask, jsonify, redirect, render_template, request, session

from database import init_db

from auth import spotify_oauth, get_spotify_client

from cache import (
    get_or_create_user,
    load_user_tracks,
    get_sync_status,
    start_sync_if_needed
)

from spotify_service import create_playlist_on_spotify

from vibe_engine import (
    interpret_vibe,
    track_vector,
    hybrid_score,
    get_emotion,
    apply_repeat_penalty
)

from memory import log_track_interaction, get_user_history


# =========================================================
# APP SETUP
# =========================================================

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret")

init_db()


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
# LOGOUT
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
# EMOTION WEIGHTS (NEW)
# =========================================================

EMOTION_BOOST = {
    "nostalgic": 1.25,
    "melancholy": 1.10,
    "warm": 1.15,
    "euphoric": 1.10,
    "intense": 1.00,
    "neutral": 1.00
}


# =========================================================
# GENERATE (IMPROVED CORE ENGINE)
# =========================================================

@app.route("/generate", methods=["POST"])
def generate():
    if "user_id" not in session:
        return {"error": "not logged in"}, 401

    user_id = session["user_id"]

    data = request.get_json(force=True)
    vibe_text = data.get("vibe", "").strip()

    if not vibe_text:
        return {"error": "missing vibe"}, 400

    tracks = load_user_tracks(user_id)

    if not tracks:
        return {"error": "no tracks found"}, 404

    vibe_vec = interpret_vibe(vibe_text)

    history = get_user_history(user_id)

    scored = []

    # track recent emotions to prevent loops
    recent_emotions = [h.emotion for h in history[-10:]]

    for t in tracks:

        t_vec = track_vector(t)

        # base semantic score
        score = hybrid_score(vibe_vec, t_vec, t)

        # emotion detection
        emotion = get_emotion(t_vec)

        # -----------------------------
        # 🎭 EMOTION BOOST (NOSTALGIA FIX)
        # -----------------------------
        score *= EMOTION_BOOST.get(emotion, 1.0)

        # nostalgia gets stronger if user vibe implies memory/softness
        if "nostalgia" in vibe_text.lower() or "remember" in vibe_text.lower():
            if emotion == "nostalgic":
                score *= 1.35

        # -----------------------------
        # 🔁 REPETITION AVOIDANCE (FIXED LOOP ISSUE)
        # -----------------------------
        score = apply_repeat_penalty(history, t.spotify_id, score)

        if len(recent_emotions) >= 3:
            if recent_emotions[-1] == emotion and recent_emotions[-2] == emotion:
                score *= 0.65  # breaks emotional loop

        # -----------------------------
        # 🧠 MEMORY LOGGING (LONG TERM PERSONALIZATION)
        # -----------------------------
        log_track_interaction(
            user_id=user_id,
            track_id=t.spotify_id,
            emotion=emotion,
            score=score
        )

        scored.append((score, t))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_tracks = [t for _, t in scored[:30]]

    return jsonify({
        "vibe": vibe_text,
        "tracks": [
            {
                "name": t.name,
                "artist": t.artist,
                "album": t.album,
                "spotify_id": t.spotify_id
            }
            for t in top_tracks
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
