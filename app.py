from flask import Flask, render_template, request, jsonify, session, redirect
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db, init_db

from dj_engine import generate_ai_playlist
from spotify_service import create_playlist, add_tracks_to_playlist

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

# ensure DB exists
init_db()


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
        return "Missing code", 400

    sp_oauth = spotify_oauth()
    token_info = sp_oauth.get_access_token(code)

    if not token_info:
        return "Token exchange failed", 400

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
# 🔥 AI DJ PIPELINE (STABLE + FRONTEND SAFE)
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({
            "error": "missing_json",
            "message": "Frontend did not send JSON body"
        }), 400

    vibe = (data.get("vibe") or "balanced").strip()
    length = int(data.get("length") or 25)
    mode = data.get("mode") or "balanced"

    sp = get_spotify_client()
    if not sp:
        return jsonify({
            "error": "not_logged_in"
        }), 401

    user_id = sp.me()["id"]
    db = get_db()

    try:
        # 1. LOAD TRACKS
        raw_tracks = load_user_tracks(user_id, db)

        if not raw_tracks:
            return jsonify({
                "error": "no_tracks_available"
            }), 400

        # 2. FORMAT
        tracks = [
            {
                "id": t.spotify_id,
                "name": t.name,
                "artist": t.artist
            }
            for t in raw_tracks
        ]

        # 3. AI ENGINE
        ranked = generate_ai_playlist(
            sp,
            tracks,
            vibe=vibe,
            limit=length
        )

        if not ranked:
            return jsonify({
                "error": "no_tracks_matched"
            }), 400

        # 4. BUILD SPOTIFY URIS + PREVIEW DATA
        uris = []
        preview_tracks = []

        for t in ranked:
            if t.get("id"):
                uris.append(f"spotify:track:{t['id']}")

            preview_tracks.append({
                "id": t.get("id"),
                "name": t.get("name", "Unknown"),
                "artist": t.get("artist", "Unknown")
            })

        if not uris:
            return jsonify({
                "error": "no_valid_tracks_after_ai"
            }), 400

        # 5. CREATE PLAYLIST
        playlist = create_playlist(sp, f"{vibe} • AI DJ Session")

        # 6. ADD TRACKS
        add_tracks_to_playlist(sp, playlist["id"], uris)

        # 7. RESPONSE (MATCHES YOUR FRONTEND EXACTLY)
        return jsonify({
            "url": playlist["external_urls"]["spotify"],
            "name": playlist["name"],
            "count": len(uris),
            "vibe": vibe,
            "mode": mode,

            # frontend expects this structure
            "tracks": preview_tracks[:10],

            # optional UI extras
            "confidence": 0.72,
            "status": "AI_DJ_ACTIVE"
        })

    except Exception as e:
        return jsonify({
            "error": "server_error",
            "message": str(e)
        }), 500

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


# ─────────────────────────────
# RUN
# ─────────────────────────────
if __name__ == "__main__":
    app.run(debug=True)
