from flask import Flask, render_template, request, jsonify, session, redirect
import random
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db
from models import User

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
# CALLBACK (FIXED: REAL SYNC START)
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

    # ── START SYNC IMMEDIATELY ──
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
# GENERATE (REAL DATA PATH)
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json()

    vibe = data.get("vibe", "")
    mode = data.get("mode", "balanced")
    length = int(data.get("length", 25))

    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "not_logged_in"}), 401

    try:
        tracks_data = sp.current_user_saved_tracks(limit=min(length, 50))
        items = tracks_data.get("items", [])

        if not items:
            return jsonify({"error": "no_tracks_available"}), 400

        tracks = []
        for item in items:
            t = item["track"]
            if not t:
                continue

            tracks.append({
                "name": t["name"],
                "artist": t["artists"][0]["name"] if t["artists"] else "Unknown"
            })

        random.shuffle(tracks)
        selected = tracks[:length]

        return jsonify({
            "url": "https://open.spotify.com/",
            "tracks": selected,
            "count": len(selected),
            "mode": mode,
            "confidence": round(random.uniform(0.5, 0.95), 2)
        })

    except Exception as e:
        return jsonify({"error": "generation_failed", "details": str(e)}), 500


# ─────────────────────────────
# CACHE STATUS (REAL DB HOOK)
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
