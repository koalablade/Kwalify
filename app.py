from flask import Flask, render_template, request, jsonify, session, redirect
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db
from models import User
from dj_scoring import rank_tracks

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
# CALLBACK (START SYNC)
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
# GENERATE (🔥 REAL AI DJ ENGINE)
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json()

    vibe = data.get("vibe", "balanced")
    length = int(data.get("length", 25))

    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    try:
        user_id = sp.me()["id"]

        db = get_db()
        try:
            # LOAD FULL USER LIBRARY FROM DB (NOT SPOTIFY API)
            tracks = load_user_tracks(user_id, db)

            if not tracks:
                return jsonify({"error": "no_tracks_available"}), 400

            # 🔥 AI DJ CORE
            ranked = rank_tracks(tracks, vibe=vibe, limit=length)

            # FORMAT RESPONSE
            output = []
            for t in ranked:
                output.append({
                    "name": t.name,
                    "artist": t.artist,
                    "energy": t.energy,
                    "valence": t.valence,
                    "danceability": t.danceability
                })

            return jsonify({
                "tracks": output,
                "count": len(output),
                "mode": vibe,
                "confidence": 0.85
            })

        finally:
            db.close()

    except Exception as e:
        return jsonify({"error": "generation_failed", "details": str(e)}), 500


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
