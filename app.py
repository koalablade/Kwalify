from flask import Flask, render_template, request, jsonify, session, redirect
import random
import os

# Spotify OAuth helper
from auth import spotify_oauth

app = Flask(__name__)

# secure secret key (Render + fallback)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

# ─────────────────────────────────────────────
# HOME PAGE
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return render_template(
        "index.html",
        logged_in=session.get("logged_in", False)
    )

# ─────────────────────────────────────────────
# LOGIN (REAL SPOTIFY REDIRECT)
# ─────────────────────────────────────────────
@app.route("/login")
def login():
    try:
        sp_oauth = spotify_oauth()
        auth_url = sp_oauth.get_authorize_url()
        return redirect(auth_url)
    except Exception as e:
        return f"Login error: {str(e)}"

# ─────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")

# ─────────────────────────────────────────────
# GENERATE PLAYLIST (still placeholder for now)
# ─────────────────────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json()

    vibe = data.get("vibe", "Unknown vibe")
    mode = data.get("mode", "balanced")
    length = data.get("length", 25)

    fake_tracks = [
        {"name": "Midnight City", "artist": "M83"},
        {"name": "After Dark", "artist": "Mr.Kitty"},
        {"name": "Borderline", "artist": "Tame Impala"},
        {"name": "Nights", "artist": "Frank Ocean"},
        {"name": "Intro", "artist": "The xx"},
    ]

    return jsonify({
        "url": "https://open.spotify.com/",
        "tracks": fake_tracks,
        "count": length,
        "mode": mode,
        "confidence": round(random.uniform(0.4, 0.95), 2)
    })

# ─────────────────────────────────────────────
# CACHE STATUS (placeholder for now)
# ─────────────────────────────────────────────
@app.route("/cache-status")
def cache_status():
    return jsonify({
        "status": "done",
        "track_count": 523,
        "last_sync_at": "2026-05-29T18:00:00"
    })

# ─────────────────────────────────────────────
# RUN APP
# ─────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=True)
