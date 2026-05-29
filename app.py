from flask import Flask, render_template, request, jsonify, session, redirect
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db

from dj_engine import generate_ai_playlist
from spotify_service import create_playlist, add_tracks_to_playlist

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")


# ─────────────────────────────
# HOME
# ─────────────────────────────
@app.route("/")
def index():
    return render_template(
        "index.html",
        logged_in=session.get("logged_in", False)
    )


# ─────────────────────────────
# LOGIN
# ─────────────────────────────
@app.route("/login")
def login():
    sp_oauth = spotify_oauth()
    return redirect(sp_oauth.get_authorize_url())


# ─────────────────────────────
# CALLBACK
# ─────────────────────────────
@app.route("/callback")
def callback():
    code = request.args.get("code")
    if not code:
        return "Missing code"

    sp_oauth = spotify_oauth()
    token_info = sp_oauth.get_access_token(code)

    if not token_info:
        return "Token exchange failed"

    session["logged_in"] = True
    session["token_info"] = token_info

    sp = get_spotify_client()
    if sp:
        user_id = sp.me()["id"]
        start_sync_if_needed(user_id, sp)

    return redirect("/")


# ─────────────────────────────
# LOGOUT
# ─────────────────────────────
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ─────────────────────────────
# 🔥 FULL AI DJ PIPELINE (FIXED)
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json()

    vibe = data.get("vibe", "balanced")
    length = int(data.get("length", 25))

    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    user_id = sp.me()["id"]
    db = get_db()

    try:
        # 1. LOAD USER TRACKS FROM DB
        raw_tracks = load_user_tracks(user_id, db)

        if not raw_tracks:
            return jsonify({"error": "no_tracks"}), 400

        # 2. FORMAT FOR AI ENGINE
        tracks = [
            {
                "id": t.spotify_id,
                "name": t.name,
                "artist": t.artist
            }
            for t in raw_tracks
        ]

        # 3. AI DJ RANKING ENGINE
        ranked = generate_ai_playlist(
            sp,
            tracks,
            vibe=vibe,
            limit=length
        )

        # 4. CONVERT RANKED → URIS (🔥 FIXED)
        uris = [
            f"spotify:track:{t.spotify_id if hasattr(t, 'spotify_id') else t.get('id')}"
            for t in ranked
        ]

        # fallback safety (if objects missing ids)
        uris = [
            f"spotify:track:{t.get('id')}"
            if isinstance(t, dict) else f"spotify:track:{t.spotify_id}"
            for t in ranked
        ]

        # 5. CREATE PLAYLIST
        playlist = create_playlist(sp, f"{vibe} • AI DJ Session")

        # 6. UPLOAD TRACKS
        add_tracks_to_playlist(sp, playlist["id"], uris)

        return jsonify({
            "playlist_url": playlist["external_urls"]["spotify"],
            "name": playlist["name"],
            "tracks": len(uris),
            "vibe": vibe,
            "status": "AI_DJ_ACTIVE"
        })

    finally:
        db.close()


# ─────────────────────────────
# CACHE STATUS
# ─────────────────────────────
@app.route("/cache-status")
def cache_status():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"status": "no_user", "track_count": 0})

    user_id = sp.me()["id"]
    db = get_db()

    try:
        return jsonify(get_sync_status(user_id, db))
    finally:
        db.close()


if __name__ == "__main__":
    app.run(debug=True)
