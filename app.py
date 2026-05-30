import os
from flask import Flask, render_template, request, jsonify, session, redirect

from auth import spotify_oauth, get_spotify_client
from cache import start_sync_if_needed, get_sync_status, load_user_tracks
from database import get_db, init_db
from dj_engine import generate_ai_playlist
from spotify_service import create_playlist, add_tracks_to_playlist

app = Flask(__name__)

# --- Configuration ---
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER'))
app.secret_key = r"my-super-secret-123454ffsda\zc2345251.,/'5215136dfdsdfs"

# ADD THIS: A simple hardcoded key for your script
API_KEY = "my-secure-api-key-123" 

init_db()

# ─────────────────────────────
# GENERATE
# ─────────────────────────────
@app.route("/generate", methods=["POST"])
def generate():
    # 1. Allow API Key override
    provided_key = request.headers.get("X-API-KEY")
    is_authorized = "token_info" in session or (provided_key == API_KEY)
    
    if not is_authorized:
        return jsonify({"error": "not_authorized"}), 401

    data = request.get_json(force=True, silent=True)
    if not data:
        data = request.form.to_dict()
    
    if not data:
        return jsonify({"error": "no_input_received"}), 400

    vibe = data.get("vibe") or data.get("mode") or "balanced"
    try:
        length = int(data.get("length", 25))
    except (ValueError, TypeError):
        length = 25

    # If using API key, we might need a specific user_id if multiple users exist
    # For now, we assume standard usage:
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "spotify_client_failed"}), 401

    user_id = sp.me()["id"]
    db = get_db()

    try:
        raw_tracks = load_user_tracks(user_id, db)
        if not raw_tracks:
            return jsonify({"error": "no_tracks_available"}), 400

        tracks = [{"id": t.spotify_id, "name": t.name, "artist": t.artist} for t in raw_tracks]

        ranked = generate_ai_playlist(sp, tracks, vibe=vibe, limit=length)
        if not ranked:
            return jsonify({"error": "no_tracks_matched"}), 400

        uris = [f"spotify:track:{t['id']}" for t in ranked if t.get("id")]
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
    except Exception as e:
        return jsonify({"error": "internal_server_error", "details": str(e)}), 500
    finally:
        db.close()

# ... (Keep all other routes the same as before) ...

if __name__ == "__main__":
    app.run(debug=True)
