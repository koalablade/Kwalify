from flask import Flask, render_template, request, jsonify, session, redirect
import os

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db, init_db
from dj_engine import generate_ai_playlist
from spotify_service import create_playlist, add_tracks_to_playlist

app = Flask(__name__)

# 🔥 MUST be stable across deploys
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

init_db()


# ─────────────────────────────
# HOME
# ─────────────────────────────
@app.route("/")
def index():
    return render_template(
        "index.html",
        logged_in="token_info" in session
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

    session.clear()
    session["token_info"] = token_info
    session["logged_in"] = True
    session.modified = True

    sp = get_spotify_client()

    if not sp:
        return "Spotify auth failed", 400

    user_id = sp.me()["id"]

    db = get_db()
    try:
        from models import User

        user = db.query(User).filter_by(spotify_id=user_id).first()

        if not user:
            user = User(
                spotify_id=user_id,
                sync_status="pending"
            )
            db.add(user)
            db.commit()

        start_sync_if_needed(user_id, sp)

    finally:
        db.close()

    return redirect("/")


# ─────────────────────────────
# LOGOUT
# ─────────────────────────────
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ─────────────────────────────
# 🔥 FIXED GENERATE (ROBUST JSON HANDLING)
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():

    # ✅ ACCEPT JSON OR FORM DATA (THIS FIXES YOUR 400 ERROR)
    data = request.get_json(silent=True)

    if data is None:
        data = request.form.to_dict()

    if not data:
        return jsonify({
            "error": "no_input_received",
            "hint": "Send JSON or form-data with vibe + length"
        }), 400

    vibe = data.get("vibe") or data.get("mode") or "balanced"

    try:
        length = int(data.get("length", 25))
    except:
        length = 25

    # 🔥 AUTH CHECK
    if "token_info" not in session:
        return jsonify({"error": "not_logged_in"}), 401

    sp = get_spotify_client()

    if not sp:
        return jsonify({"error": "spotify_client_failed"}), 401

    user_id = sp.me()["id"]
    db = get_db()

    try:
        raw_tracks = load_user_tracks(user_id, db)

        if not raw_tracks:
            return jsonify({
                "error": "no_tracks_available",
                "hint": "Sync not finished yet"
            }), 400

        tracks = [
            {
                "id": t.spotify_id,
                "name": t.name,
                "artist": t.artist
            }
            for t in raw_tracks
        ]

        ranked = generate_ai_playlist(
            sp,
            tracks,
            vibe=vibe,
            limit=length
        )

        if not ranked:
            return jsonify({"error": "no_tracks_matched"}), 400

        uris = [
            f"spotify:track:{t['id']}"
            for t in ranked
            if t.get("id")
        ]

        if not uris:
            return jsonify({"error": "no_valid_tracks"}), 400

        playlist = create_playlist(sp, f"{vibe} • AI DJ Session")

        add_tracks_to_playlist(sp, playlist["id"], uris)

        return jsonify({
            "url": playlist["external_urls"]["spotify"],
            "name": playlist["name"],
            "count": len(uris),
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

    if "token_info" not in session:
        return jsonify({
            "status": "no_user",
            "track_count": 0
        })

    sp = get_spotify_client()

    if not sp:
        return jsonify({
            "status": "no_spotify_client",
            "track_count": 0
        })

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
