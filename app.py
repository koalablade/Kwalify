from flask import Flask, render_template, request, jsonify, session, redirect
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status
from database import get_db
from sync_service import run_incremental_sync
from dj_engine import generate_ai_playlist

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
# CALLBACK (LOGIN + SYNC START)
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

    # start background sync
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
# GENERATE (REAL AI DJ ENGINE)
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
        # STEP 1 — GET USER TRACKS
        results = sp.current_user_saved_tracks(limit=50)
        items = results.get("items", [])

        if not items:
            return jsonify({"error": "no_tracks_available"}), 400

        raw_tracks = []

        for item in items:
            t = item.get("track")
            if not t:
                continue

            raw_tracks.append({
                "id": t["id"],
                "name": t["name"],
                "artist": t["artists"][0]["name"] if t["artists"] else "Unknown"
            })

        # STEP 2 — AI DJ ENGINE (THIS IS THE IMPORTANT PART)
        ranked = generate_ai_playlist(
            sp=sp,
            tracks=raw_tracks,
            vibe=vibe,
            limit=length
        )

        # STEP 3 — FORMAT RESPONSE
        selected = [
            {
                "name": t.name,
                "artist": t.artist
            }
            for t in ranked
        ]

        return jsonify({
            "tracks": selected,
            "count": len(selected),
            "mode": vibe,
            "confidence": 0.85
        })

    except Exception as e:
        return jsonify({
            "error": "generation_failed",
            "details": str(e)
        }), 500


# ─────────────────────────────
# CACHE STATUS (REAL)
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


# ─────────────────────────────
# RUN APP
# ─────────────────────────────
if __name__ == "__main__":
    app.run(debug=True)
