from flask import Flask, render_template, request, jsonify, session, redirect
import random

app = Flask(__name__)
app.secret_key = "change-this-secret"

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
# LOGIN
# ─────────────────────────────────────────────
@app.route("/login")
def login():
    session["logged_in"] = True
    return redirect("/")

# ─────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")

# ─────────────────────────────────────────────
# GENERATE PLAYLIST
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
# CACHE STATUS
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
